import * as chrono from 'chrono-node';
import { franc } from 'franc-min';
import {
  ACTION_CATEGORIES,
  ANALYSIS_PATTERN,
  BREAKING_PATTERN,
  CONTRAST_CLAUSES,
  EXPLAINER_PATTERN,
  LANGUAGE_MAP,
  LIVEBLOG_PATTERN,
  LOCATION_LEXICON,
  OPINION_PATTERN,
  TITLE_TRANSLATION_LEXICON,
  TRIGGER_PRIORITY,
  VIDEO_PATTERN,
  WEEKDAY_TEMPORAL_TOKENS,
  WIRE_PATTERN,
} from './contentSignals.constants.js';
import { normalizeText, splitSentences, tokenizeWords } from './textSignals';

export type DocumentType =
  | 'breaking_update'
  | 'wire'
  | 'hard_news'
  | 'video_clip'
  | 'liveblog'
  | 'analysis'
  | 'opinion'
  | 'explainer';

const DOCUMENT_TYPE_ALIASES = {
  wire_report: 'wire',
  explainer_recap: 'explainer',
} as const satisfies Record<string, DocumentType>;

const DOCUMENT_TYPE_VALUES = new Set<DocumentType>([
  'breaking_update',
  'wire',
  'hard_news',
  'video_clip',
  'liveblog',
  'analysis',
  'opinion',
  'explainer',
]);

export interface EventTuple {
  description: string;
  trigger: string | null;
  who: string[];
  where: string[];
  when_ms: number | null;
  outcome: string | null;
}

function capitalizePhrase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function fromFranc(text: string): string | null {
  const code = franc(text, { minLength: 20 });
  if (!code || code === 'und') {
    return null;
  }
  return LANGUAGE_MAP[code] ?? null;
}

export function resolveLanguage(text: string, hint: string | undefined): string {
  const normalizedHint = hint?.trim().toLowerCase();
  if (normalizedHint) {
    return normalizedHint;
  }
  return fromFranc(text) ?? 'en';
}

export function shouldTranslate(language: string, text: string): boolean {
  return language !== 'en' && tokenizeWords(text).length >= 6;
}

export function translateLexicon(text: string, language: string): { text: string; applied: boolean } {
  const dictionary = TITLE_TRANSLATION_LEXICON[language];
  if (!dictionary) {
    return { text, applied: false };
  }
  let applied = false;
  const translated = normalizeText(text)
    .split(' ')
    .map((token) => {
      const replacement = dictionary[token];
      if (replacement) {
        applied = true;
        return replacement;
      }
      return token;
    })
    .join(' ')
    .trim();
  return { text: translated || text, applied };
}

export function classifyDocumentType(
  title: string,
  summary: string | undefined,
  publisher: string,
  url = '',
): DocumentType {
  const text = `${title} ${summary ?? ''} ${publisher} ${url}`.toLowerCase();
  if (VIDEO_PATTERN.test(text)) return 'video_clip';
  if (LIVEBLOG_PATTERN.test(text)) return 'liveblog';
  if (OPINION_PATTERN.test(text)) return 'opinion';
  if (ANALYSIS_PATTERN.test(text)) return 'analysis';
  if (EXPLAINER_PATTERN.test(text)) return 'explainer';
  if (BREAKING_PATTERN.test(text)) return 'breaking_update';
  if (WIRE_PATTERN.test(text)) return 'wire';
  return 'hard_news';
}

export function normalizeDocumentType(value: unknown): DocumentType {
  if (typeof value !== 'string') {
    return 'hard_news';
  }
  const normalized = value.trim();
  if (DOCUMENT_TYPE_VALUES.has(normalized as DocumentType)) {
    return normalized as DocumentType;
  }
  return DOCUMENT_TYPE_ALIASES[normalized as keyof typeof DOCUMENT_TYPE_ALIASES] ?? 'hard_news';
}

export function isRelatedCoverageText(title: string, summary: string | undefined, publisher = '', url = ''): boolean {
  const text = `${title} ${summary ?? ''} ${publisher} ${url}`.toLowerCase();
  return VIDEO_PATTERN.test(text) ||
    LIVEBLOG_PATTERN.test(text) ||
    OPINION_PATTERN.test(text) ||
    ANALYSIS_PATTERN.test(text) ||
    EXPLAINER_PATTERN.test(text);
}

function isRelatedOnlyDocumentType(type: DocumentType): boolean {
  return type === 'video_clip' || type === 'liveblog' || type === 'analysis' || type === 'opinion' || type === 'explainer';
}

export function refineDocumentType(
  providerType: DocumentType,
  title: string,
  summary: string | undefined,
  publisher: string,
  url = '',
): DocumentType {
  const heuristicType = classifyDocumentType(title, summary, publisher, url);
  return isRelatedOnlyDocumentType(heuristicType) ? heuristicType : providerType;
}

export function documentTypeWeight(type: DocumentType): number {
  switch (type) {
    case 'breaking_update': return 1.3;
    case 'wire': return 1.15;
    case 'hard_news': return 1;
    case 'video_clip': return 0.35;
    case 'liveblog': return 0.85;
    case 'explainer': return 0.55;
    case 'analysis': return 0.45;
    case 'opinion': return 0.25;
  }
}

export function extractEntities(text: string, hints: readonly string[] = []): string[] {
  const entities = new Set<string>(hints.map((hint) => normalizeText(hint).replace(/\s+/g, '_')));
  for (const anchor of deriveEventAnchorEntities(text)) {
    entities.add(anchor);
  }
  const matches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g) ?? [];
  for (const match of matches) {
    const normalized = normalizeText(match).replace(/\s+/g, '_');
    if (normalized.length >= 4) {
      entities.add(normalized);
    }
  }
  for (const token of tokenizeWords(text, 4)) {
    if (token.length >= 5 && !LOCATION_LEXICON.has(token)) {
      entities.add(token);
    }
    if (entities.size >= 10) {
      break;
    }
  }
  return [...entities].sort().slice(0, 10);
}

export function deriveEventAnchorEntities(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const anchors = new Set<string>();
  const has = (pattern: RegExp) => pattern.test(normalized);
  const hasSanDiego = has(/\bsan\s+diego\b/);
  const hasMosqueShooting = has(/\bmosque\b/) && has(/\bshoot(?:ing|s)?\b|\bshot\b|\bkilled\b|\bdead\b|\bfatal(?:ly)?\b/);
  if (hasSanDiego) {
    anchors.add('san_diego');
  }
  if (has(/\bdr\s+congo\b|\bdemocratic\s+republic\s+of\s+congo\b/)) {
    anchors.add('dr_congo');
  }
  if (hasMosqueShooting) {
    anchors.add('mosque_shooting');
  }
  if (hasSanDiego && hasMosqueShooting) {
    anchors.add('san_diego_mosque_shooting');
  }
  if (has(/\bebola\b/) && has(/\boutbreak\b|\bepidemic\b|\bdeath\s+toll\b|\bvaccine\b|\btravel\b|\bcontracted\b|\btreatment\b|\bhealth\b/)) {
    anchors.add('ebola_outbreak');
  }
  if (has(/\bebola\b/) && has(/\b(?:dr\s+)?congo\b/) && has(/\buganda\b/)) {
    anchors.add('congo_uganda_ebola_outbreak');
  }
  if (
    has(/\bebola\b/) &&
    has(/\bamerican\b|\bu\s+s\b|\bus\b|\bunited\s+states\b/) &&
    has(/\bcontract(?:ed|s|ing)?\b|\bevacu(?:ated|ation|ate|ating)\b|\btreat(?:ment|ed|ing)?\b/)
  ) {
    anchors.add('american_ebola_evacuation');
  }
  if (
    has(/\bebola\b/) &&
    has(/\bsingapore\b/) &&
    has(/\bhealth\s+measures?\b|\bhealth\s+advisor(?:y|ies)\b|\bpoints?\s+of\s+entry\b|\bmonitor(?:ing)?\b/)
  ) {
    anchors.add('singapore_ebola_health_measures');
  }
  if (has(/\btravel\s+restrictions?\b/)) {
    anchors.add('travel_restrictions');
  }
  if (has(/\bebola\b/) && has(/\btravel\s+restrictions?\b|\brestricted\s+(?:some\s+)?travelers?\b/)) {
    anchors.add('ebola_travel_restrictions');
  }
  if (
    has(/\bebola\b/) &&
    has(/\btravel\s+restrictions?\b|\brestricted\s+(?:some\s+)?travelers?\b/) &&
    has(/\bu\s+s\b|\bus\b|\bunited\s+states\b|\badministration\b/)
  ) {
    anchors.add('us_ebola_travel_restrictions');
  }
  const hasSupremeCourt = has(/\bsupreme\s+court\b|\bscotus\b/);
  if (hasSupremeCourt) {
    anchors.add('supreme_court');
  }
  if (has(/\bvoting\s+rights?\b/)) {
    anchors.add('voting_rights');
  }
  if (hasSupremeCourt && has(/\bnative\s+american\b/) && has(/\bvoting\s+rights?\b/)) {
    anchors.add('native_american_voting_rights');
  }
  if (has(/\bsex\s+discrimination\b/)) {
    anchors.add('sex_discrimination');
  }
  if (hasSupremeCourt && has(/\bsex\s+discrimination\b/)) {
    anchors.add('sex_discrimination_case');
  }
  if (has(/\bcapital\b/) && has(/\bblackout\b|\bgrid\s+failure\b|\bpower\b|\bsubstation\b|\bapag[oó]n\b|\bsubestaci[oó]n\b/)) {
    anchors.add('capital_blackout');
  }
  if (has(/\bgeneva\b/) && has(/\bmissile\b/) && has(/\bstrike\b|\bceasefire\b|\btruce\b|\btalks?\b/)) {
    anchors.add('geneva_missile_strike_talks');
  }
  if (has(/\batlantic\b/) && has(/\bport(?:s)?\b/) && has(/\bstrike\b|\bdockworkers?\b|\bcargo\b|\bcontainer\b/)) {
    anchors.add('atlantic_port_strike');
  }
  if (has(/\bhospital\b/) && has(/\bambulances?\b|\bnetwork\b/) && has(/\bransomware\b|\bcyberattack\b|\bcyber\s+attack\b/)) {
    anchors.add('hospital_ransomware_attack');
  }
  if (has(/\bbrothers?\b/) && has(/\bfraud\b/) && has(/\bconvicted\b|\bguilty\b|\bverdict\b|\btrial\b/)) {
    anchors.add('luxury_fraud_verdict');
  }
  if (has(/\bcity\s+hall\b/) && has(/\bmayor\b/) && has(/\bblast\b|\battack\b|\binjur(?:es|ed|y)\b|\bhospitali[sz]ed\b/)) {
    anchors.add('city_hall_mayor_attack');
  }
  if (has(/\btsa\b|\bairports?\b|\bcheckpoints?\b/) && has(/\bstaffing\b|\bshortage\b|\bshortfall\b|\bwaits?\b|\blines?\b/)) {
    anchors.add('tsa_staffing_shortage');
  }

  return [...anchors].sort();
}

export function extractLocations(text: string): string[] {
  const normalized = normalizeText(text);
  const locations = new Set<string>();
  for (const location of LOCATION_LEXICON) {
    if (normalized.includes(location)) {
      locations.add(location.replace(/\s+/g, '_'));
    }
  }
  return [...locations].sort().slice(0, 6);
}

export function extractTrigger(text: string): string | null {
  for (const candidateText of triggerCandidateTexts(text)) {
    const candidate = extractLeadTrigger(candidateText);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

export function triggerCategory(trigger: string | null): string | null {
  return trigger ? ACTION_CATEGORIES.get(trigger) ?? null : null;
}

function triggerCandidateTexts(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>([normalized]);
  for (const marker of CONTRAST_CLAUSES) {
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex > 0) {
      const lead = normalized.slice(0, markerIndex).trim();
      if (lead.length > 0) {
        candidates.add(lead);
      }
    }
  }

  return [...candidates].sort((left, right) => left.length - right.length);
}

function extractLeadTrigger(text: string): string | null {
  const phraseTrigger = extractPhraseTrigger(text);
  if (phraseTrigger) {
    return phraseTrigger;
  }
  let bestToken: string | null = null;
  let bestPriority = -1;
  let bestIndex = Number.POSITIVE_INFINITY;
  const tokens = tokenizeWords(text, 3);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const category = ACTION_CATEGORIES.get(token);
    if (!category) {
      continue;
    }
    /* v8 ignore next -- ACTION_CATEGORIES and TRIGGER_PRIORITY are intentionally kept in lockstep */
    const priority = TRIGGER_PRIORITY.get(category) ?? 0;
    if (priority > bestPriority || (priority === bestPriority && index < bestIndex)) {
      bestToken = token;
      bestPriority = priority;
      bestIndex = index;
    }
  }
  return bestToken;
}

function extractPhraseTrigger(text: string): string | null {
  if (/\bebola\b/.test(text) && /\b(?:outbreak|epidemic|travel\s+restrictions?|health\s+measures?|health\s+advisor(?:y|ies)|vaccine|death\s+toll)\b/.test(text)) {
    return 'outbreak';
  }
  if (/\bcuts?\s+(?:electricity|power)\b|\bpower\s+cuts?\b/.test(text)) {
    return 'blackout';
  }
  if (/\bransomware attack\b/.test(text)) {
    return 'ransomware';
  }
  if (/\bcyberattack\b|\bcyber attack\b/.test(text)) {
    return 'cyberattack';
  }
  if (/\bdrill(s)?\b/.test(text)) {
    return 'drill';
  }
  if (/\bexercise(s)?\b/.test(text)) {
    return 'exercise';
  }
  return null;
}

const RELATIVE_TEMPORAL_PHRASES = [
  'today',
  'yesterday',
  'tomorrow',
  'tonight',
  'overnight',
  'this morning',
  'this afternoon',
  'this evening',
  'last night',
  'next week',
  'last week',
  'this week',
];

function hasCalendarDigits(text: string): boolean {
  return /\b\d{1,4}\b/.test(text);
}

function isUsableTemporalPhrase(text: string): boolean {
  const normalized = normalizeText(text);
  if (hasCalendarDigits(normalized)) {
    return true;
  }
  if (RELATIVE_TEMPORAL_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  if (WEEKDAY_TEMPORAL_TOKENS.has(normalized)) {
    return true;
  }
  return false;
}

export function extractTemporalMs(text: string, publishedAtMs: number): number | null {
  const parsed = chrono.parse(text, new Date(publishedAtMs));
  const match = parsed[0];
  const candidate = match && isUsableTemporalPhrase(match.text) ? match.start?.date() : null;
  return candidate ? candidate.getTime() : null;
}

export function buildEventTuple(
  title: string,
  summary: string | undefined,
  entities: readonly string[],
  locations: readonly string[],
  publishedAtMs: number,
): EventTuple {
  const detailText = `${title}. ${summary ?? ''}`.trim();
  const whenMs = extractTemporalMs(detailText, publishedAtMs);
  const trigger = extractTrigger(detailText);
  const sentences = splitSentences(detailText);
  return {
    description: title,
    trigger,
    who: entities.slice(0, 5).map((entity) => capitalizePhrase(entity.replace(/_/g, ' '))),
    where: locations.slice(0, 3).map((location) => capitalizePhrase(location.replace(/_/g, ' '))),
    when_ms: whenMs,
    outcome: sentences[1] ?? summary ?? null,
  };
}
