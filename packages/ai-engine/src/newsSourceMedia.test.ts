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

  it('detects video file extension URLs', () => {
    expect(isLikelyVideoUrl('https://cdn.example.com/clip.mp4')).toBe(true);
    expect(isLikelyVideoUrl('https://cdn.example.com/stream.m3u8?token=abc')).toBe(true);
    expect(isLikelyVideoUrl('https://cdn.example.com/clip.webm#t=10')).toBe(true);
  });

  it('returns false for empty or unparseable URLs', () => {
    expect(isLikelyVideoUrl('')).toBe(false);
    expect(isLikelyVideoUrl('   ')).toBe(false);
    expect(isLikelyVideoUrl('not-a-url')).toBe(false);
  });

  it('detects likely video titles', () => {
    expect(isLikelyVideoTitle('Video: nightly briefing')).toBe(true);
    expect(isLikelyVideoTitle('Watch live: election results')).toBe(true);
    expect(isLikelyVideoTitle('White House releases AI legislation framework')).toBe(false);
  });

  it('returns false for empty or missing titles', () => {
    expect(isLikelyVideoTitle('')).toBe(false);
    expect(isLikelyVideoTitle('   ')).toBe(false);
    expect(isLikelyVideoTitle(null)).toBe(false);
    expect(isLikelyVideoTitle(undefined)).toBe(false);
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
