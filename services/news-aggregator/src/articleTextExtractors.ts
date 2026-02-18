export interface ArticleTextQualityMetrics {
  readonly charCount: number;
  readonly wordCount: number;
  readonly sentenceCount: number;
  readonly score: number;
}

export const BACKOFF_BASE_MS = 250;

export function normalizeWhitespace(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeWhitespace(match?.[1] ?? '').slice(0, 300);
}

export function stripNonContentTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ');
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function countSentences(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

export function assessQuality(
  text: string,
  minCharCount: number,
  minWordCount: number,
  minSentenceCount: number,
): ArticleTextQualityMetrics {
  const charCount = text.length;
  const wordCount = countWords(text);
  const sentenceCount = countSentences(text);

  const charScore = Math.min(1, charCount / minCharCount);
  const wordScore = Math.min(1, wordCount / minWordCount);
  const sentenceScore = Math.min(1, sentenceCount / minSentenceCount);

  return {
    charCount,
    wordCount,
    sentenceCount,
    score: Number(((charScore + wordScore + sentenceScore) / 3).toFixed(3)),
  };
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function backoffForAttempt(attempt: number): number {
  return BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);
}

export async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function defaultPrimaryExtractor(
  url: string,
  html: string,
): Promise<{ title: string; text: string } | null> {
  const { extract } = await import('@extractus/article-extractor');
  const parsed = await extract(url, { html } as never);
  const content = typeof parsed?.content === 'string' ? parsed.content : '';
  const text = normalizeWhitespace(stripNonContentTags(content).replace(/<[^>]+>/g, ' '));

  if (!text) {
    return null;
  }

  return {
    title: normalizeWhitespace(parsed?.title ?? extractTitle(html)),
    text,
  };
}

export function defaultFallbackExtractor(
  _url: string,
  html: string,
): { title: string; text: string } | null {
  const cleaned = stripNonContentTags(html);
  const sectionChunks = Array.from(
    cleaned.matchAll(
      /<(?:article|main|p|h1|h2|h3|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:article|main|p|h1|h2|h3|li|blockquote)>/gi,
    ),
    (match) => normalizeWhitespace((match[1] as string).replace(/<[^>]+>/g, ' ')),
  ).filter((chunk) => chunk.length > 0);

  const text =
    sectionChunks.length > 0
      ? normalizeWhitespace(sectionChunks.join(' '))
      : normalizeWhitespace(cleaned.replace(/<[^>]+>/g, ' '));

  if (!text) {
    return null;
  }

  return {
    title: extractTitle(html),
    text,
  };
}
