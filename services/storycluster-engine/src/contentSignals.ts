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
  | 'wire_report'
  | 'hard_news'
  | 'video_clip'
  | 'liveblog'
  | 'analysis'
  | 'opinion'
  | 'explainer_recap';

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
  if (EXPLAINER_PATTERN.test(text)) return 'explainer_recap';
  if (BREAKING_PATTERN.test(text)) return 'breaking_update';
  if (WIRE_PATTERN.test(text)) return 'wire_report';
  return 'hard_news';
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
  return type === 'video_clip' || type === 'liveblog' || type === 'analysis' || type === 'opinion' || type === 'explainer_recap';
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
    case 'wire_report': return 1.15;
    case 'hard_news': return 1;
    case 'video_clip': return 0.35;
    case 'liveblog': return 0.85;
    case 'explainer_recap': return 0.55;
    case 'analysis': return 0.45;
    case 'opinion': return 0.25;
  }
}

export function extractEntities(text: string, hints: readonly string[] = []): string[] {
  const entities = new Set<string>(hints.map((hint) => normalizeText(hint).replace(/\s+/g, '_')));
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
