import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STARTER_FEED_URLS,
  STARTER_SOURCE_DOMAINS,
  findLatestSourceHealthReportPath,
  getStarterSourceDomainAllowlist,
  isSourceDomainAllowed,
  resolveSourceHealthReport,
  resolveStarterFeedSources,
  sourceRegistryInternal,
} from '../sourceRegistry';

describe('sourceRegistry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes starter feed URLs', () => {
    expect(STARTER_FEED_URLS.length).toBeGreaterThanOrEqual(10);
    expect(STARTER_FEED_URLS[0]).toContain('foxnews');
    expect(STARTER_FEED_URLS).toContain('https://feeds.nbcnews.com/feeds/nbcpolitics');
  });

  it('collects feed hosts and known publication aliases', () => {
    expect(STARTER_SOURCE_DOMAINS).toContain('moxie.foxnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('foxnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('nypost.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('cbsnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('nbcnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('feeds.bbci.co.uk');
    expect(STARTER_SOURCE_DOMAINS).toContain('bbc.com');
  });

  it('returns the shared allowlist set', () => {
    vi.stubEnv('VH_NEWS_SOURCE_HEALTH_REPORT_AUTOLOAD', 'false');
    const allowlist = getStarterSourceDomainAllowlist();
    expect(allowlist.has('theguardian.com')).toBe(true);
    expect(allowlist.has('huffpost.com')).toBe(true);
    expect(allowlist.has('nbcnews.com')).toBe(true);
  });

  it('resolves and applies the latest source-health artifact to starter feed sources', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-registry-'));
    const latestDir = path.join(cwd, '.tmp', 'news-source-admission', 'latest');
    mkdirSync(latestDir, { recursive: true });
    const latestPath = path.join(latestDir, 'source-health-report.json');
    writeFileSync(
      latestPath,
      JSON.stringify({
        readinessStatus: 'review',
        recommendedAction: 'review_watchlist',
        runtimePolicy: {
          enabledSourceIds: ['fox-latest', 'guardian-us'],
          watchSourceIds: ['guardian-us'],
          removeSourceIds: ['cbs-politics'],
        },
      }),
      'utf8',
    );

    const report = resolveSourceHealthReport(cwd, {});
    expect(report.reportPath).toBe(latestPath);
    expect(report.reportSource).toBe(`artifact:${latestPath}`);

    const resolved = resolveStarterFeedSources({ cwd, env: {} });
    expect(resolved.feedSources.map((source) => source.id)).not.toContain('cbs-politics');
    expect(resolved.sourceHealth.summary?.watchSourceIds).toEqual(['guardian-us']);
    expect(resolved.sourceHealth.summary?.removedConfiguredSourceIds).toEqual(['cbs-politics']);
  });

  it('can disable source-health enforcement while still parsing the artifact', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-registry-disabled-'));
    const latestDir = path.join(cwd, '.tmp', 'news-source-admission', 'latest');
    mkdirSync(latestDir, { recursive: true });
    const latestPath = path.join(latestDir, 'source-health-report.json');
    writeFileSync(
      latestPath,
      JSON.stringify({
        runtimePolicy: {
          enabledSourceIds: ['fox-latest'],
          watchSourceIds: [],
          removeSourceIds: ['guardian-us'],
        },
      }),
      'utf8',
    );

    const resolved = resolveStarterFeedSources({
      cwd,
      env: {
        VH_NEWS_SOURCE_HEALTH_ENFORCEMENT: 'false',
      },
    });

    expect(findLatestSourceHealthReportPath(cwd, {})).toBe(latestPath);
    expect(resolved.feedSources.map((source) => source.id)).toContain('guardian-us');
    expect(resolved.sourceHealth.summary?.enforcement).toBe('disabled');
  });

  it('allows matching domains and URL hosts', () => {
    expect(isSourceDomainAllowed('https://www.foxnews.com/politics/story')).toBe(true);
    expect(isSourceDomainAllowed('https://nypost.com/2026/03/16/story')).toBe(true);
    expect(isSourceDomainAllowed('https://www.cbsnews.com/news/story')).toBe(true);
    expect(isSourceDomainAllowed('https://www.nbcnews.com/politics/story')).toBe(true);
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
    expect(sourceRegistryInternal.normalizeNonEmpty('  x  ')).toBe('x');
    expect(sourceRegistryInternal.parseBoolean('true', false)).toBe(true);
    expect(sourceRegistryInternal.readHealthEnv({ VH_TEST: 'a', VITE_TEST: 'b' }, 'TEST')).toBe('a');
  });
});
