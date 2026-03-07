import * as chrono from 'chrono-node';
import { franc } from 'franc-min';
import { normalizeText, splitSentences, tokenizeWords } from './textSignals';

export type DocumentType =
  | 'breaking_update'
  | 'wire_report'
  | 'hard_news'
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

const LANGUAGE_MAP: Record<string, string> = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', nld: 'nl', rus: 'ru',
  ukr: 'uk', arb: 'ar', cmn: 'zh', jpn: 'ja', kor: 'ko', hin: 'hi', tur: 'tr',
};

const ACTION_CATEGORIES = new Map<string, string>([
  ['attack', 'conflict'], ['attacks', 'conflict'], ['strike', 'conflict'], ['strikes', 'conflict'],
  ['bombing', 'conflict'], ['raid', 'conflict'], ['clash', 'conflict'], ['invasion', 'conflict'],
  ['election', 'politics'], ['elections', 'politics'], ['vote', 'politics'], ['resigns', 'politics'],
  ['arrest', 'legal'], ['charged', 'legal'], ['trial', 'legal'], ['lawsuit', 'legal'],
  ['earthquake', 'disaster'], ['flood', 'disaster'], ['wildfire', 'disaster'], ['storm', 'disaster'],
  ['market', 'economic'], ['stocks', 'economic'], ['tariff', 'economic'], ['inflation', 'economic'],
  ['talks', 'diplomacy'], ['summit', 'diplomacy'], ['sanctions', 'diplomacy'], ['ceasefire', 'diplomacy'],
]);

const TRIGGER_PRIORITY = new Map<string, number>([
  ['conflict', 6],
  ['disaster', 5],
  ['legal', 4],
  ['economic', 3],
  ['politics', 2],
  ['diplomacy', 1],
]);

const LOCATION_LEXICON = new Set([
  'iran', 'israel', 'gaza', 'ukraine', 'russia', 'china', 'taiwan', 'tehran', 'jerusalem', 'kyiv',
  'washington', 'london', 'paris', 'berlin', 'tokyo', 'beijing', 'moscow', 'brussels', 'cairo',
  'mexico', 'canada', 'california', 'texas', 'new york', 'los angeles', 'europe', 'asia', 'africa',
]);

const TITLE_TRANSLATION_LEXICON: Record<string, Record<string, string>> = {
  es: {
    ataque: 'attack', ataques: 'attacks', puerto: 'port', mercado: 'market', guerra: 'war',
    elecciones: 'elections', incendio: 'fire', terremoto: 'earthquake', huelga: 'strike',
    rescate: 'rescue', gobierno: 'government', explosión: 'explosion', crisis: 'crisis',
  },
  fr: {
    attaque: 'attack', attaques: 'attacks', port: 'port', marche: 'market', guerre: 'war',
    elections: 'elections', incendie: 'fire', seisme: 'earthquake', greve: 'strike',
    secours: 'rescue', gouvernement: 'government', explosion: 'explosion', crise: 'crisis',
  },
};

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

export function classifyDocumentType(title: string, summary: string | undefined, publisher: string): DocumentType {
  const text = `${title} ${summary ?? ''} ${publisher}`.toLowerCase();
  if (/\blive\b|live updates|liveblog|minute by minute/.test(text)) return 'liveblog';
  if (/\bopinion\b|editorial|column|guest essay|analysis opinion/.test(text)) return 'opinion';
  if (/\banalysis\b|what it means|why it matters|takeaways|inside the/.test(text)) return 'analysis';
  if (/\bexplainer\b|what we know|timeline|recap|key moments/.test(text)) return 'explainer_recap';
  if (/\bbreaking\b|developing|alert|just in/.test(text)) return 'breaking_update';
  if (/reuters|associated press|ap\b|afp|upi|wire/.test(text)) return 'wire_report';
  return 'hard_news';
}

export function documentTypeWeight(type: DocumentType): number {
  switch (type) {
    case 'breaking_update': return 1.3;
    case 'wire_report': return 1.15;
    case 'hard_news': return 1;
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
  let bestToken: string | null = null;
  let bestPriority = -1;
  let bestIndex = -1;
  const tokens = tokenizeWords(text, 3);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const category = ACTION_CATEGORIES.get(token);
    if (!category) {
      continue;
    }
    const priority = TRIGGER_PRIORITY.get(category)!;
    if (priority > bestPriority || (priority === bestPriority && index > bestIndex)) {
      bestToken = token;
      bestPriority = priority;
      bestIndex = index;
    }
  }
  return bestToken;
}

export function triggerCategory(trigger: string | null): string | null {
  return trigger ? ACTION_CATEGORIES.get(trigger) ?? null : null;
}

export function extractTemporalMs(text: string, publishedAtMs: number): number | null {
  const parsed = chrono.parse(text, new Date(publishedAtMs));
  const candidate = parsed[0]?.start?.date();
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
