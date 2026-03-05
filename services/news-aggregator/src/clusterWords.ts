import type { NormalizedFeedItem } from './normalize';

/* prettier-ignore */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','about','after',
  'before','between','through','during','above','below','and','but','or','nor',
  'not','so','yet','both','either','neither','each','every','all','any','few',
  'more','most','other','some','such','no','only','own','same','than','too',
  'very','just','also','now','then','here','there','when','where','how','what',
  'which','who','whom','this','that','these','those','it','its','he','she',
  'they','them','his','her','their','our','your','my','we','you','up','out',
]);

export function extractWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

export function topEntityKeys(items: NormalizedFeedItem[], max: number): string[] {
  const freq = new Map<string, number>();
  for (const item of items) {
    for (const word of extractWords(item.title)) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word]) => word)
    .sort();
}
