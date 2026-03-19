import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STARTER_FEED_URLS,
  STARTER_SOURCE_DOMAINS,
  buildSourceDomainAllowlist,
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
    vi.restoreAllMocks();
  });

  it('exposes starter feed URLs', () => {
    expect(STARTER_FEED_URLS.length).toBeGreaterThanOrEqual(12);
    expect(STARTER_FEED_URLS[0]).toContain('foxnews');
    expect(STARTER_FEED_URLS).toContain('https://abcnews.go.com/abcnews/politicsheadlines');
    expect(STARTER_FEED_URLS).toContain('https://feeds.nbcnews.com/feeds/nbcpolitics');
    expect(STARTER_FEED_URLS).toContain('https://www.pbs.org/newshour/feeds/rss/politics');
    expect(STARTER_FEED_URLS).toContain('https://feeds.npr.org/1014/rss.xml');
  });

  it('collects feed hosts and known publication aliases', () => {
    expect(STARTER_SOURCE_DOMAINS).toContain('moxie.foxnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('foxnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('nypost.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('cbsnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('abcnews.go.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('abcnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('nbcnews.com');
    expect(STARTER_SOURCE_DOMAINS).toContain('npr.org');
    expect(STARTER_SOURCE_DOMAINS).toContain('pbs.org');
    expect(STARTER_SOURCE_DOMAINS).toContain('feeds.bbci.co.uk');
    expect(STARTER_SOURCE_DOMAINS).toContain('bbc.com');
  });

  it('returns the shared allowlist set', () => {
    vi.stubEnv('VH_NEWS_SOURCE_HEALTH_REPORT_AUTOLOAD', 'false');
    const allowlist = getStarterSourceDomainAllowlist();
    expect(allowlist.has('theguardian.com')).toBe(true);
    expect(allowlist.has('huffpost.com')).toBe(true);
    expect(allowlist.has('abcnews.com')).toBe(true);
    expect(allowlist.has('nbcnews.com')).toBe(true);
    expect(allowlist.has('npr.org')).toBe(true);
    expect(allowlist.has('pbs.org')).toBe(true);
  });

  it('expands known publication aliases for explicit candidate feed sources', () => {
    const allowlist = buildSourceDomainAllowlist([
      'https://abcnews.go.com/abcnews/politicsheadlines',
    ]);
    expect(allowlist.has('abcnews.go.com')).toBe(true);
    expect(allowlist.has('abcnews.com')).toBe(true);
    expect(allowlist.has('www.abcnews.com')).toBe(true);
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

  it('drops stale autoloaded artifacts in warn mode and falls back to the base starter surface', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-registry-stale-warn-'));
    const latestDir = path.join(cwd, '.tmp', 'news-source-admission', 'latest');
    mkdirSync(latestDir, { recursive: true });
    const latestPath = path.join(latestDir, 'source-health-report.json');
    writeFileSync(
      latestPath,
      JSON.stringify({
        generatedAt: '2000-01-01T00:00:00.000Z',
        runtimePolicy: {
          enabledSourceIds: ['fox-latest'],
          watchSourceIds: [],
          removeSourceIds: ['guardian-us'],
        },
      }),
      'utf8',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      resolveSourceHealthReport(cwd, {
        VH_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS: '1',
      }),
    ).toEqual({
      reportSource: null,
      reportPath: null,
      report: null,
    });
    const resolved = resolveStarterFeedSources({
      cwd,
      env: {
        VH_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS: '1',
      },
    });
    expect(resolved.feedSources.map((source) => source.id)).toContain('guardian-us');
    expect(resolved.sourceHealth.summary).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale-source-health-report'));
  });

  it('rejects stale explicit path overrides in fail mode', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-registry-stale-fail-'));
    const explicitPath = path.join(cwd, 'tmp', 'explicit-source-health-report.json');
    mkdirSync(path.dirname(explicitPath), { recursive: true });
    writeFileSync(
      explicitPath,
      JSON.stringify({
        generatedAt: '2000-01-01T00:00:00.000Z',
        runtimePolicy: {
          enabledSourceIds: ['fox-latest'],
          watchSourceIds: [],
          removeSourceIds: [],
        },
      }),
      'utf8',
    );

    expect(() =>
      resolveSourceHealthReport(cwd, {
        VH_NEWS_SOURCE_HEALTH_REPORT_PATH: './tmp/explicit-source-health-report.json',
        VH_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS: '1',
        VH_NEWS_SOURCE_HEALTH_REPORT_STALE_ACTION: 'fail',
      }),
    ).toThrow(/stale-source-health-report/);
  });

  it('falls back to file mtime when generatedAt is missing or invalid', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-registry-mtime-'));
    const latestDir = path.join(cwd, '.tmp', 'news-source-admission', 'latest');
    mkdirSync(latestDir, { recursive: true });
    const latestPath = path.join(latestDir, 'source-health-report.json');
    writeFileSync(
      latestPath,
      JSON.stringify({
        generatedAt: 'not-a-date',
        runtimePolicy: {
          enabledSourceIds: ['fox-latest'],
          watchSourceIds: [],
          removeSourceIds: [],
        },
      }),
      'utf8',
    );

    expect(
      resolveSourceHealthReport(cwd, {
        VH_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS: '1',
        VH_NEWS_SOURCE_HEALTH_REPORT_STALE_ACTION: 'fail',
      }).report?.runtimePolicy.enabledSourceIds,
    ).toEqual(['fox-latest']);

    const oldDate = new Date('2000-01-01T00:00:00.000Z');
    utimesSync(latestPath, oldDate, oldDate);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveSourceHealthReport(cwd, {
        VH_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS: '1',
      }),
    ).toEqual({
      reportSource: null,
      reportPath: null,
      report: null,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timestamp_source=mtime'));
  });

  it('treats inline JSON overrides as authoritative even when they carry old timestamps', () => {
    const report = resolveSourceHealthReport('/tmp', {
      VH_NEWS_SOURCE_HEALTH_REPORT_JSON: JSON.stringify({
        generatedAt: '2000-01-01T00:00:00.000Z',
        runtimePolicy: {
          enabledSourceIds: ['fox-latest'],
          watchSourceIds: [],
          removeSourceIds: [],
        },
      }),
      VH_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS: '1',
      VH_NEWS_SOURCE_HEALTH_REPORT_STALE_ACTION: 'fail',
    });

    expect(report.reportSource).toBe('env:NEWS_SOURCE_HEALTH_REPORT_JSON');
    expect(report.report?.runtimePolicy.enabledSourceIds).toEqual(['fox-latest']);
  });

  it('allows matching domains and URL hosts', () => {
    expect(isSourceDomainAllowed('https://www.foxnews.com/politics/story')).toBe(true);
    expect(isSourceDomainAllowed('https://nypost.com/2026/03/16/story')).toBe(true);
    expect(isSourceDomainAllowed('https://www.cbsnews.com/news/story')).toBe(true);
    expect(isSourceDomainAllowed('https://abcnews.com/Politics/wireStory/example')).toBe(true);
    expect(isSourceDomainAllowed('https://www.nbcnews.com/politics/story')).toBe(true);
    expect(isSourceDomainAllowed('https://www.npr.org/2026/03/17/politics/story')).toBe(true);
    expect(isSourceDomainAllowed('https://www.pbs.org/newshour/politics/story')).toBe(true);
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
    expect(sourceRegistryInternal.parsePositiveNumber('12', 24)).toBe(12);
    expect(sourceRegistryInternal.parsePositiveNumber('bad', 24)).toBe(24);
    expect(sourceRegistryInternal.parseStaleAction('fail', 'warn')).toBe('fail');
    expect(sourceRegistryInternal.parseStaleAction('bad', 'warn')).toBe('warn');
    expect(sourceRegistryInternal.readHealthEnv({ VH_TEST: 'a', VITE_TEST: 'b' }, 'TEST')).toBe('a');
    expect(
      sourceRegistryInternal.resolveSourceHealthArtifactTimestamp(
        { generatedAt: '2026-03-18T00:00:00.000Z' },
        '/tmp/source-health-report.json',
      ),
    ).toEqual({
      timestampMs: Date.parse('2026-03-18T00:00:00.000Z'),
      timestampSource: 'generatedAt',
    });
  });
});
