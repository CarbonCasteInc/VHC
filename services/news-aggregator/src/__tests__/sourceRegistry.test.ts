import { describe, expect, it } from 'vitest';
import {
  STARTER_FEED_URLS,
  STARTER_SOURCE_DOMAINS,
  getStarterSourceDomainAllowlist,
  isSourceDomainAllowed,
  sourceRegistryInternal,
} from '../sourceRegistry';

describe('sourceRegistry', () => {
  it('exposes starter feed URLs', () => {
    expect(STARTER_FEED_URLS).toHaveLength(9);
    expect(STARTER_FEED_URLS[0]).toContain('foxnews');
  });

  it('collects feed hosts and known publication aliases', () => {
    expect(STARTER_SOURCE_DOMAINS).toContain('moxie.foxnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('foxnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('washingtonpost.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('feeds.bbci.co.uk');
    expect(STARTER_SOURCE_DOMAINS).toContain('bbc.com');
  });

  it('returns the shared allowlist set', () => {
    const allowlist = getStarterSourceDomainAllowlist();
    expect(allowlist.has('theguardian.com')).toBe(true);
    expect(allowlist.has('huffpost.com')).toBe(true);
  });

  it('allows matching domains and URL hosts', () => {
    expect(isSourceDomainAllowed('https://www.foxnews.com/politics/story')).toBe(true);
    expect(isSourceDomainAllowed('subdomain.washingtonpost.com')).toBe(true);
    expect(isSourceDomainAllowed('https://www.theguardian.com/us-news/article')).toBe(true);
  });

  it('rejects unknown/malformed values', () => {
    expect(isSourceDomainAllowed('https://example.org/story')).toBe(false);
    expect(isSourceDomainAllowed('not a domain')).toBe(false);
    expect(isSourceDomainAllowed('')).toBe(false);
  });

  it('covers internal helper behavior', () => {
    expect(sourceRegistryInternal.toBaseDomain('feeds.bbci.co.uk')).toBe('bbci.co.uk');
    expect(sourceRegistryInternal.toBaseDomain('news.yahoo.com')).toBe('yahoo.com');

    expect(sourceRegistryInternal.parseDomain('https://NEWS.YAHOO.com/a')).toBe('news.yahoo.com');
    expect(sourceRegistryInternal.parseDomain('www.huffpost.com')).toBe('www.huffpost.com');
    expect(sourceRegistryInternal.parseDomain('::bad::')).toBeNull();
    expect(sourceRegistryInternal.parseDomain('http://%zz')).toBeNull();
  });
});
