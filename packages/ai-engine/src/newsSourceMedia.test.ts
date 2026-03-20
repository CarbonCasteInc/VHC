import { describe, expect, it } from 'vitest';
import {
  isLikelyVideoSourceEntry,
  isLikelyVideoTitle,
  isLikelyVideoUrl,
} from './newsSourceMedia';

describe('newsSourceMedia', () => {
  it('detects likely video URLs by host and path', () => {
    expect(isLikelyVideoUrl('https://www.today.com/video/netanyahu-speaks-out-123')).toBe(true);
    expect(isLikelyVideoUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
    expect(isLikelyVideoUrl('https://example.com/news/article-a')).toBe(false);
  });

  it('detects likely video titles', () => {
    expect(isLikelyVideoTitle('Video: nightly briefing')).toBe(true);
    expect(isLikelyVideoTitle('Watch live: election results')).toBe(true);
    expect(isLikelyVideoTitle('White House releases AI legislation framework')).toBe(false);
  });

  it('classifies source entries from either URL or title', () => {
    expect(
      isLikelyVideoSourceEntry({
        url: 'https://example.com/story',
        title: 'Video: press conference',
      }),
    ).toBe(true);

    expect(
      isLikelyVideoSourceEntry({
        url: 'https://www.today.com/video/source-clip-1',
        title: 'Daily briefing',
      }),
    ).toBe(true);

    expect(
      isLikelyVideoSourceEntry({
        url: 'https://example.com/story',
        title: 'City council approves transit plan',
      }),
    ).toBe(false);
  });
});
