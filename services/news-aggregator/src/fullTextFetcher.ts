/**
 * Full-text article fetcher with source eligibility determination.
 * Only articles with retrievable full text are eligible for analysis.
 */

export interface ArticleContent {
  fullText: string;
  wordCount: number;
  extractionMethod: 'readability' | 'raw-html' | 'feed-content';
  fetchedAt: number;
  eligible: boolean;
  exclusionReason?: 'paywall' | 'truncated' | 'fetch-error' | 'empty' | 'robots-blocked';
}

export const MIN_WORD_COUNT = 200;
export const FETCH_TIMEOUT_MS = 10_000;
export const MIN_CHAR_COUNT = 100;

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function makeIneligible(
  reason: ArticleContent['exclusionReason'],
): ArticleContent {
  return {
    fullText: '',
    wordCount: 0,
    extractionMethod: 'raw-html',
    fetchedAt: Date.now(),
    eligible: false,
    exclusionReason: reason,
  };
}

export async function fetchFullText(url: string): Promise<ArticleContent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const finish = (result: ArticleContent): ArticleContent => {
    clearTimeout(timeout);
    return result;
  };

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (response.status === 402 || response.status === 403) {
      return finish(makeIneligible('paywall'));
    }

    if (!response.ok) {
      return finish(makeIneligible('fetch-error'));
    }

    const html = await response.text();
    const text = stripHtml(html);

    if (text.length < MIN_CHAR_COUNT) {
      return finish(makeIneligible('empty'));
    }

    const wordCount = countWords(text);
    if (wordCount < MIN_WORD_COUNT) {
      return finish(makeIneligible('truncated'));
    }

    return finish({
      fullText: text,
      wordCount,
      extractionMethod: 'raw-html',
      fetchedAt: Date.now(),
      eligible: true,
    });
  } catch (error: unknown) {
    return finish(makeIneligible('fetch-error'));
  }
}
