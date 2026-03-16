import { describe, expect, it, vi } from 'vitest';
import {
  readSurveyMinVisibleRunRate,
  readSurveyRunCount,
  readSurveySources,
  runSourceSurvey,
  summarizeSurveySource,
  surveyArtifactRoot,
} from './daemon-feed-semantic-soak-source-survey.mjs';

describe('daemon-feed-semantic-soak-source-survey', () => {
  it('reads survey sources from inline json or a file', () => {
    const sources = [
      {
        id: 'washington-examiner-politics',
        name: 'Washington Examiner Politics',
        displayName: 'Washington Examiner',
        rssUrl: 'https://www.washingtonexaminer.com/tag/politics/feed',
        perspectiveTag: 'conservative',
        iconKey: 'washington-examiner',
        enabled: true,
      },
    ];

    expect(readSurveySources({
      VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: JSON.stringify(sources),
    })).toEqual(sources);

    expect(readSurveySources({
      VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_FILE: '/tmp/sources.json',
    }, vi.fn(() => JSON.stringify(sources)))).toEqual(sources);
  });

  it('throws when survey sources are missing or invalid', () => {
    expect(() => readSurveySources({})).toThrow(/source-survey-sources-required/);
    expect(() => readSurveySources({
      VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: '{"id":"bad"}',
    })).toThrow(/must-be-an-array/);
    expect(() => readSurveySources({
      VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: 'not-json',
    })).toThrow();
    expect(() => readSurveySources({
      VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: JSON.stringify([{ id: 'bad' }]),
    })).toThrow(/sources-empty/);
    expect(() => readSurveySources({
      VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: JSON.stringify([null]),
    })).toThrow(/sources-empty/);
  });

  it('reads run count, visibility threshold, and artifact root defaults', () => {
    expect(readSurveyRunCount({})).toBe(3);
    expect(readSurveyRunCount({
      VH_PUBLIC_SEMANTIC_SOAK_SURVEY_RUNS: '5',
    })).toBe(5);
    expect(readSurveyMinVisibleRunRate({})).toBeCloseTo(0.67, 2);
    expect(readSurveyMinVisibleRunRate({
      VH_PUBLIC_SEMANTIC_SOAK_SURVEY_MIN_VISIBLE_RUN_RATE: '0.8',
    })).toBe(0.8);
    expect(surveyArtifactRoot({}, '/repo')).toMatch(/^\/repo\/\.tmp\/daemon-feed-semantic-soak\/source-survey-/);
  });

  it('summarizes repeated visibility across survey probes', () => {
    const summary = summarizeSurveySource({
      id: 'fox-politics',
      name: 'Fox Politics',
      displayName: 'Fox News',
      rssUrl: 'https://moxie.foxnews.com/google-publisher/politics.xml',
      perspectiveTag: 'conservative',
      iconKey: 'fox',
      enabled: true,
    }, [
      {
        visibleStoryCount: 3,
        auditableCount: 0,
        visibleStories: [
          { headline: 'Kennedy Center shakeup continues' },
          { headline: 'Kennedy Center shakeup continues' },
        ],
      },
      {
        visibleStoryCount: 0,
        auditableCount: 0,
        visibleStories: [],
      },
      {
        visibleStoryCount: 2,
        auditableCount: 1,
        visibleStories: [
          { headline: 'Kennedy Center shakeup continues' },
          { headline: 'Extortion case tied to pardon lobbyist moves forward' },
          { headline: '   ' },
        ],
      },
    ], 0.6);

    expect(summary.visibleRunCount).toBe(2);
    expect(summary.visibleRunRate).toBeCloseTo(2 / 3, 5);
    expect(summary.auditableRunCount).toBe(1);
    expect(summary.averageVisibleStoryCount).toBeCloseTo(5 / 3, 5);
    expect(summary.maxVisibleStoryCount).toBe(3);
    expect(summary.recommended).toBe(true);
    expect(summary.topVisibleHeadlines[0]).toEqual({
      headline: 'Kennedy Center shakeup continues',
      count: 3,
    });
  });

  it('handles an empty survey summary without dividing by zero', () => {
    const summary = summarizeSurveySource({
      id: 'source-a',
      name: 'Source A',
      displayName: 'Source A',
      rssUrl: 'https://example.com/a',
      perspectiveTag: 'wire',
      iconKey: 'a',
      enabled: true,
    }, []);

    expect(summary.visibleRunRate).toBe(0);
    expect(summary.averageVisibleStoryCount).toBe(0);
    expect(summary.recommended).toBe(false);
  });

  it('handles missing visible story arrays and alphabetical headline tie-breaks', () => {
    const summary = summarizeSurveySource({
      id: 'source-a',
      name: 'Source A',
      displayName: 'Source A',
      rssUrl: 'https://example.com/a',
      perspectiveTag: 'wire',
      iconKey: 'a',
      enabled: true,
    }, [
      {
        visibleStoryCount: 1,
        auditableCount: 0,
        visibleStories: undefined,
      },
      {
        visibleStoryCount: 2,
        auditableCount: 0,
        visibleStories: [
          undefined,
          { headline: 'Zulu headline' },
          { headline: 'Alpha headline' },
        ],
      },
      {
        visibleStoryCount: 2,
        auditableCount: 0,
        visibleStories: [
          { headline: 'Alpha headline' },
          { headline: 'Zulu headline' },
        ],
      },
    ]);

    expect(summary.topVisibleHeadlines).toEqual([
      { headline: 'Alpha headline', count: 2 },
      { headline: 'Zulu headline', count: 2 },
    ]);
  });

  it('runs the survey build once and probes every source for every run', () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: 'ok', stderr: '' }));
    const mkdir = vi.fn();
    const writeFile = vi.fn();
    const log = vi.fn();
    const runProbe = vi.fn(({ profile }) => ({
      profile,
      visibleStoryCount: profile === 'fox-politics' ? 2 : 0,
      auditableCount: 0,
      visibleStories: profile === 'fox-politics'
        ? [{ headline: 'Kennedy Center board fight expands' }]
        : [],
    }));

    const result = runSourceSurvey({
      cwd: '/repo',
      env: {
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: JSON.stringify([
          {
            id: 'fox-politics',
            name: 'Fox Politics',
            displayName: 'Fox News',
            rssUrl: 'https://moxie.foxnews.com/google-publisher/politics.xml',
            perspectiveTag: 'conservative',
            iconKey: 'fox',
            enabled: true,
          },
          {
            id: 'washington-examiner-politics',
            name: 'Washington Examiner Politics',
            displayName: 'Washington Examiner',
            rssUrl: 'https://www.washingtonexaminer.com/tag/politics/feed',
            perspectiveTag: 'conservative',
            iconKey: 'washington-examiner',
            enabled: true,
          },
        ]),
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_RUNS: '2',
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_ARTIFACT_DIR: '/tmp/source-survey',
      },
      spawn,
      mkdir,
      writeFile,
      log,
      runProbe,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(runProbe).toHaveBeenCalledTimes(4);
    expect(runProbe).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'fox-politics',
      probeEnvOverrides: expect.objectContaining({
        VH_LIVE_DEV_FEED_SOURCES_JSON: expect.stringContaining('fox-politics'),
      }),
    }));
    expect(result.report.recommendedSourceIds).toEqual(['fox-politics']);
    expect(result.report.sourceSummaries).toHaveLength(2);
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/source-survey/source-survey-report.json',
      expect.any(String),
      'utf8',
    );
  });

  it('sorts recommended sources by visibility rate, then average story count, then id', () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: 'ok', stderr: '' }));
    const runProbe = vi.fn(({ profile }) => ({
      profile,
      visibleStoryCount: profile === 'source-b' ? 2 : 1,
      auditableCount: 0,
      visibleStories: [{ headline: `${profile} headline` }],
    }));

    const result = runSourceSurvey({
      cwd: '/repo',
      env: {
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: JSON.stringify([
          {
            id: 'source-c',
            name: 'Source C',
            displayName: 'Source C',
            rssUrl: 'https://example.com/c',
            perspectiveTag: 'wire',
            iconKey: 'c',
            enabled: true,
          },
          {
            id: 'source-b',
            name: 'Source B',
            displayName: 'Source B',
            rssUrl: 'https://example.com/b',
            perspectiveTag: 'wire',
            iconKey: 'b',
            enabled: true,
          },
          {
            id: 'source-a',
            name: 'Source A',
            displayName: 'Source A',
            rssUrl: 'https://example.com/a',
            perspectiveTag: 'wire',
            iconKey: 'a',
            enabled: true,
          },
        ]),
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_RUNS: '1',
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_ARTIFACT_DIR: '/tmp/source-survey-sort',
      },
      spawn,
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      log: vi.fn(),
      runProbe,
    });

    expect(result.report.recommendedSourceIds).toEqual(['source-b', 'source-a', 'source-c']);
  });

  it('fails fast when the survey build fails', () => {
    expect(() => runSourceSurvey({
      cwd: '/repo',
      env: {
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: JSON.stringify([
          {
            id: 'source-a',
            name: 'Source A',
            displayName: 'Source A',
            rssUrl: 'https://example.com/a',
            perspectiveTag: 'wire',
            iconKey: 'a',
            enabled: true,
          },
        ]),
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_ARTIFACT_DIR: '/tmp/source-survey-fail',
      },
      spawn: vi.fn(() => ({ status: 2, stdout: '', stderr: 'fail' })),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      log: vi.fn(),
    })).toThrow(/source-survey-build-failed:2/);
  });

  it('passes a custom timeout through to probe runs and tolerates missing build output', () => {
    const runProbe = vi.fn(() => ({
      profile: 'source-a',
      visibleStoryCount: 1,
      auditableCount: 0,
      visibleStories: [{ headline: 'One visible headline' }],
    }));

    runSourceSurvey({
      cwd: '/repo',
      env: {
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON: JSON.stringify([
          {
            id: 'source-a',
            name: 'Source A',
            displayName: 'Source A',
            rssUrl: 'https://example.com/a',
            perspectiveTag: 'wire',
            iconKey: 'a',
            enabled: true,
          },
        ]),
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_RUNS: '1',
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_TIMEOUT_MS: '43210',
        VH_PUBLIC_SEMANTIC_SOAK_SURVEY_ARTIFACT_DIR: '/tmp/source-survey-timeout',
      },
      spawn: vi.fn(() => ({ status: 0 })),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      log: vi.fn(),
      runProbe,
    });

    expect(runProbe).toHaveBeenCalledWith(expect.objectContaining({
      probeTimeoutMs: '43210',
    }));
  });
});
