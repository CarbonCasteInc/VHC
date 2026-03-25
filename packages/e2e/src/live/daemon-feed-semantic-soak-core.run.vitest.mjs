import { describe, expect, it, vi } from 'vitest';
import {
  resolvePublicSemanticSoakSourceIds,
  resolvePublicSemanticSoakSpawnEnv,
  runDaemonFeedSemanticSoak,
} from './daemon-feed-semantic-soak-core.mjs';

function makeAttachment(name, body) {
  return { name, body: Buffer.from(JSON.stringify(body)).toString('base64') };
}

function makePrimaryResult(attachments = []) {
  return { attachments };
}

function makeReport(overrides = {}) {
  return {
    requested_sample_count: 2,
    sampled_story_count: 2,
    visible_story_ids: ['story-1', 'story-2'],
    bundles: [{
      story_id: 'story-1',
      topic_id: 'topic-1',
      headline: 'Headline',
      canonical_source_count: 1,
      canonical_sources: [{ source_id: 'guardian-us' }],
      pairs: [{ label: 'related_topic_only' }],
      has_related_topic_only_pair: true,
    }],
    overall: {
      audited_pair_count: 1,
      related_topic_only_pair_count: 1,
      sample_fill_rate: 1,
      sample_shortfall: 0,
      pass: false,
    },
    ...overrides,
  };
}

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function makeVirtualArtifactFs(writes) {
  const renameCalls = [];
  return {
    exists: (filePath) => writes.has(filePath),
    readdir: (dirPath) => {
      const prefix = `${dirPath}/`;
      return [...writes.keys()]
        .filter((filePath) => filePath.startsWith(prefix))
        .map((filePath) => filePath.slice(prefix.length))
        .filter((name) => name.length > 0 && !name.includes('/'))
        .map((name) => ({
          name,
          isFile: () => true,
        }));
    },
    stat: () => ({ mtimeMs: Date.now() }),
    rename: (fromPath, toPath) => {
      renameCalls.push({ fromPath, toPath });
      const content = writes.get(fromPath);
      writes.delete(fromPath);
      writes.set(toPath, content);
    },
    renameCalls,
  };
}

const TEST_PORT_PLAN = {
  gunPort: 8777,
  storyclusterPort: 4310,
  fixturePort: 8788,
  qdrantPort: 6333,
  analysisStubPort: 9100,
  webPort: 2148,
};

function resolveTestPortPlan() {
  return TEST_PORT_PLAN;
}

function makeSpawnMock(...pnpmResults) {
  let pnpmCallIndex = 0;
  return vi.fn((command, args, options) => {
    if (command === 'sh') {
      return {
        status: 0,
        stdout: '[vh:daemon-soak] preflight completed\n',
        stderr: '',
      };
    }
    if (command !== 'pnpm') {
      throw new Error(`unexpected spawn command: ${command}`);
    }

    const result = pnpmResults[pnpmCallIndex];
    pnpmCallIndex += 1;
    if (!result) {
      throw new Error(`unexpected pnpm spawn #${pnpmCallIndex}: ${String(args?.join?.(' ') ?? args)}`);
    }
    return result;
  });
}

describe('runDaemonFeedSemanticSoak', () => {
  it('injects the ranked keep-source profile and scaled limits when unset', () => {
    const env = resolvePublicSemanticSoakSpawnEnv({}, 'run-1', 4, 180000, {
      repoRoot: '/repo',
      exists: (filePath) => filePath === '/repo/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json',
      stat: () => ({ mtimeMs: Date.now() - 60 * 60 * 1000 }),
      readFile: () => JSON.stringify({
        keepSourceIds: [
          'fox-latest',
          'guardian-us',
          'cbs-politics',
          'bbc-us-canada',
        ],
        feedContribution: {
          sources: [
            { sourceId: 'guardian-us', corroboratedBundleCount: 7, bundleAppearanceCount: 12, ingestedItemCount: 33 },
            { sourceId: 'bbc-us-canada', corroboratedBundleCount: 10, bundleAppearanceCount: 18, ingestedItemCount: 23 },
            { sourceId: 'fox-latest', corroboratedBundleCount: 2, bundleAppearanceCount: 7, ingestedItemCount: 25 },
            { sourceId: 'cbs-politics', corroboratedBundleCount: 6, bundleAppearanceCount: 9, ingestedItemCount: 30 },
          ],
        },
      }),
    });

    expect(env.VH_RUN_DAEMON_FIRST_FEED).toBe('true');
    expect(env.VH_DAEMON_FEED_RUN_ID).toBe('run-1');
    expect(env.VH_DAEMON_FEED_ARTIFACT_ROOT).toBe('/repo/.tmp/e2e-daemon-feed');
    expect(env.VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT).toBe('4');
    expect(env.VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS).toBe('180000');
    expect(env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBe(
      'bbc-us-canada,guardian-us,cbs-politics,fox-latest',
    );
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE).toBe('4');
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL).toBe('16');
    expect(env.VH_DAEMON_FEED_MIN_AUDITABLE_STORIES).toBe('1');
  });

  it('ranks the public smoke source slice by contribution signals before preferred-order tie breaks', () => {
    expect(resolvePublicSemanticSoakSourceIds({}, {
      repoRoot: '/repo',
      exists: () => true,
      readFile: () => JSON.stringify({
        keepSourceIds: [
          'fox-latest',
          'nypost-politics',
          'federalist',
          'guardian-us',
          'huffpost-us',
          'cbs-politics',
          'abc-politics',
          'nbc-politics',
          'npr-politics',
          'pbs-politics',
          'bbc-general',
          'bbc-us-canada',
        ],
        feedContribution: {
          sources: [
            { sourceId: 'bbc-us-canada', corroboratedBundleCount: 8, bundleAppearanceCount: 17, ingestedItemCount: 24 },
            { sourceId: 'nbc-politics', corroboratedBundleCount: 8, bundleAppearanceCount: 15, ingestedItemCount: 25 },
            { sourceId: 'huffpost-us', corroboratedBundleCount: 7, bundleAppearanceCount: 30, ingestedItemCount: 48 },
            { sourceId: 'federalist', corroboratedBundleCount: 7, bundleAppearanceCount: 14, ingestedItemCount: 20 },
            { sourceId: 'cbs-politics', corroboratedBundleCount: 6, bundleAppearanceCount: 13, ingestedItemCount: 30 },
            { sourceId: 'guardian-us', corroboratedBundleCount: 6, bundleAppearanceCount: 10, ingestedItemCount: 33 },
            { sourceId: 'nypost-politics', corroboratedBundleCount: 5, bundleAppearanceCount: 7, ingestedItemCount: 19 },
            { sourceId: 'abc-politics', corroboratedBundleCount: 5, bundleAppearanceCount: 5, ingestedItemCount: 25 },
            { sourceId: 'bbc-general', corroboratedBundleCount: 4, bundleAppearanceCount: 15, ingestedItemCount: 37 },
            { sourceId: 'pbs-politics', corroboratedBundleCount: 4, bundleAppearanceCount: 6, ingestedItemCount: 20 },
            { sourceId: 'npr-politics', corroboratedBundleCount: 3, bundleAppearanceCount: 3, ingestedItemCount: 10 },
            { sourceId: 'fox-latest', corroboratedBundleCount: 2, bundleAppearanceCount: 8, ingestedItemCount: 25 },
          ],
        },
      }),
      stat: () => ({ mtimeMs: Date.now() }),
      now: () => Date.now(),
    })).toEqual([
      'bbc-us-canada',
      'nbc-politics',
      'huffpost-us',
      'federalist',
      'cbs-politics',
      'guardian-us',
      'nypost-politics',
      'abc-politics',
      'bbc-general',
      'pbs-politics',
      'npr-politics',
      'fox-latest',
    ]);
  });

  it('preserves explicit feed source and limit overrides', () => {
    const env = resolvePublicSemanticSoakSpawnEnv({
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,fox-latest',
      VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE: '2',
      VH_DAEMON_FEED_MAX_ITEMS_TOTAL: '8',
    }, 'run-2', 2, 1000);

    expect(env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBe('guardian-us,fox-latest');
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE).toBe('2');
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL).toBe('8');
    expect(env.VH_DAEMON_FEED_MIN_AUDITABLE_STORIES).toBe('1');
  });

  it('does not inject smoke-only source defaults for fixture runs', () => {
    const env = resolvePublicSemanticSoakSpawnEnv({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
    }, 'run-3', 2, 1000);

    expect(env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBeUndefined();
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE).toBeUndefined();
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL).toBeUndefined();
  });

  it('falls back to the full admitted default source surface when no health artifact exists', () => {
    expect(resolvePublicSemanticSoakSourceIds({}, {
      repoRoot: '/repo',
      exists: () => false,
      readFile: () => '',
    })).toEqual([
      'bbc-us-canada',
      'nbc-politics',
      'huffpost-us',
      'guardian-us',
      'cbs-politics',
      'bbc-general',
      'abc-politics',
      'federalist',
      'washingtonexaminer-politics',
      'npr-news',
      'npr-politics',
      'pbs-politics',
    ]);
  });

  it('falls back to the default source surface when the health artifact is stale', () => {
    expect(resolvePublicSemanticSoakSourceIds({
      VH_DAEMON_FEED_SOURCE_HEALTH_MAX_AGE_HOURS: '24',
    }, {
      repoRoot: '/repo',
      exists: () => true,
      readFile: () => JSON.stringify({
        generatedAt: isoHoursAgo(48),
        keepSourceIds: ['guardian-us', 'cbs-politics'],
        feedContribution: {
          sources: [
            { sourceId: 'guardian-us', corroboratedBundleCount: 10, bundleAppearanceCount: 15, ingestedItemCount: 20 },
            { sourceId: 'cbs-politics', corroboratedBundleCount: 8, bundleAppearanceCount: 12, ingestedItemCount: 18 },
          ],
        },
      }),
      stat: () => ({ mtimeMs: Date.now() }),
      now: () => Date.now(),
    })).toEqual([
      'bbc-us-canada',
      'nbc-politics',
      'huffpost-us',
      'guardian-us',
      'cbs-politics',
      'bbc-general',
      'abc-politics',
      'federalist',
      'washingtonexaminer-politics',
      'npr-news',
      'npr-politics',
      'pbs-politics',
    ]);
  });

  it('falls back to file mtime when generatedAt is absent on the source-health artifact', () => {
    expect(resolvePublicSemanticSoakSourceIds({
      VH_DAEMON_FEED_SOURCE_HEALTH_MAX_AGE_HOURS: '24',
    }, {
      repoRoot: '/repo',
      exists: () => true,
      readFile: () => JSON.stringify({
        keepSourceIds: ['guardian-us', 'cbs-politics', 'bbc-us-canada'],
        feedContribution: {
          sources: [
            { sourceId: 'guardian-us', corroboratedBundleCount: 7, bundleAppearanceCount: 12, ingestedItemCount: 33 },
            { sourceId: 'bbc-us-canada', corroboratedBundleCount: 10, bundleAppearanceCount: 18, ingestedItemCount: 23 },
            { sourceId: 'cbs-politics', corroboratedBundleCount: 6, bundleAppearanceCount: 9, ingestedItemCount: 30 },
          ],
        },
      }),
      stat: () => ({ mtimeMs: Date.now() - 2 * 60 * 60 * 1000 }),
      now: () => Date.now(),
    })).toEqual([
      'bbc-us-canada',
      'guardian-us',
      'cbs-politics',
    ]);
  });

  it('injects the run id and persists summary, trend, and artifact index', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const logs = [];
    const stderrWrites = [];
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const runAudit = {
      requested_sample_count: 2,
      sampled_story_count: 1,
      visible_story_ids: ['story-1'],
      supply: {
        story_count: 3,
        auditable_count: 1,
        visible_story_ids: ['story-1'],
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
        sample_fill_rate: 0.5,
        sample_shortfall: 1,
      },
      bundles: [{
        story_id: 'story-1',
        topic_id: 'topic-1',
        headline: 'Headline',
        canonical_source_count: 2,
        canonical_sources: [{ source_id: 'guardian-us' }, { source_id: 'cbs-politics' }],
        pairs: [],
        has_related_topic_only_pair: false,
      }],
      overall: {
        audited_pair_count: 0,
        related_topic_only_pair_count: 0,
        sample_fill_rate: 0.5,
        sample_shortfall: 1,
        pass: false,
      },
    };
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', runAudit),
      makeAttachment('daemon-first-feed-retained-source-evidence', {
        schemaVersion: 'daemon-feed-retained-source-evidence-v1',
        generatedAt: '2026-03-22T00:00:00.000Z',
        story_count: 3,
        auditable_count: 1,
        visible_story_ids: ['story-1'],
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
        source_count: 2,
        sources: [{
          source_id: 'guardian-us',
          publisher: 'Guardian',
          url: 'https://example.com/guardian-us',
          url_hash: 'guardian-us-1',
          title: 'Guardian headline',
          observations: [{
            story_id: 'story-1',
            topic_id: 'topic-1',
            headline: 'Headline',
            source_count: 2,
            primary_source_count: 2,
            secondary_asset_count: 0,
            is_auditable: true,
            is_dom_visible: true,
            source_roles: ['primary_source', 'source'],
          }],
        }],
      }),
      makeAttachment('daemon-first-feed-cluster-capture', {
        schemaVersion: 'daemon-feed-cluster-capture-v1',
        generatedAt: '2026-03-24T00:00:00.000Z',
        runId: 'semantic-soak-1-1',
        ticks: [{
          tickSequence: 1,
          schemaVersion: 'news-orchestrator-cluster-artifacts-v1',
          generatedAt: '2026-03-24T00:00:00.000Z',
          normalizedItems: [{
            sourceId: 'guardian-us',
            publisher: 'guardian-us',
            url: 'https://example.com/guardian-us',
            canonicalUrl: 'https://example.com/guardian-us',
            title: 'Guardian headline',
            publishedAt: 1,
            url_hash: 'guardian-us-1',
            entity_keys: ['guardian'],
            cluster_text: 'Guardian headline',
          }],
          topicCaptures: [{
            topicId: 'topic-news',
            items: [{
              sourceId: 'guardian-us',
              publisher: 'guardian-us',
              url: 'https://example.com/guardian-us',
              canonicalUrl: 'https://example.com/guardian-us',
              title: 'Guardian headline',
              publishedAt: 1,
              url_hash: 'guardian-us-1',
              entity_keys: ['guardian'],
              cluster_text: 'Guardian headline',
            }],
            result: {
              bundles: [{
                schemaVersion: 'story-bundle-v0',
                story_id: 'story-1',
                topic_id: 'topic-news',
                headline: 'Guardian headline',
                cluster_window_start: 1,
                cluster_window_end: 1,
                sources: [{
                  source_id: 'guardian-us',
                  publisher: 'guardian-us',
                  url: 'https://example.com/guardian-us',
                  url_hash: 'guardian-us-1',
                  title: 'Guardian headline',
                }],
                cluster_features: {
                  entity_keys: ['guardian'],
                  time_bucket: '2026-03-24T00',
                  semantic_signature: 'sig-1',
                },
                provenance_hash: 'guardian-us-prov',
                created_at: 1,
              }],
              storylines: [],
            },
          }],
        }],
      }),
      makeAttachment('daemon-first-feed-runtime-logs', { browserLogs: ['log-1'] }),
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };

    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 1, stdout: JSON.stringify(playwrightReport), stderr: 'warn' },
    );

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        repoRoot: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '2',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_DAEMON_FEED_SOAK_SUMMARY_PATH: '/repo/.tmp/out/custom-summary.json',
        },
        spawn,
        mkdir: vi.fn(),
        rename: virtualFs.rename,
        exists: virtualFs.exists,
        stat: virtualFs.stat,
        readdir: virtualFs.readdir,
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        resolvePortPlan: resolveTestPortPlan,
        clusterItemsImpl: async (items, topicId) => [{
          schemaVersion: 'story-bundle-v0',
          story_id: `offline-${topicId}-${items.length}`,
          topic_id: topicId,
          headline: 'Offline headline',
          cluster_window_start: 1,
          cluster_window_end: 1,
          sources: items.map((item) => ({
            source_id: item.sourceId,
            publisher: item.publisher,
            url: item.canonicalUrl,
            url_hash: item.url_hash,
            title: item.title,
          })),
          cluster_features: {
            entity_keys: ['guardian'],
            time_bucket: '2026-03-24T00',
            semantic_signature: 'offline-sig',
          },
          provenance_hash: 'guardian-us-prov',
          created_at: 1,
        }],
        log: (message) => logs.push(message),
        sleepImpl: vi.fn(),
      })).rejects.toThrow();
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    const playwrightSpawnCall = spawn.mock.calls.find(([command, args]) => (
      command === 'pnpm'
      && Array.isArray(args)
      && args.includes('playwright')
      && args.includes('test')
    ));
    expect(playwrightSpawnCall).toBeDefined();
    expect(playwrightSpawnCall[2]).toEqual(expect.objectContaining({
      env: expect.objectContaining({
        VH_RUN_DAEMON_FIRST_FEED: 'true',
        VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT: '2',
        VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS: '10',
      }),
    }));
    expect(playwrightSpawnCall[2].env.VH_DAEMON_FEED_RUN_ID).toMatch(/^semantic-soak-/);
    expect(stderrWrites).toContain('warn');
    expect(writes.get('/repo/.tmp/out/custom-summary.json')).toContain('"sampleFillRate": 0.5');
    expect(writes.get('/repo/.tmp/out/custom-summary.json')).toContain('"readinessStatus": "not_ready"');
    expect(writes.get('/repo/.tmp/out/custom-summary.json')).toContain('"promotionBlockingReasons"');
    expect(writes.get('/repo/.tmp/out/custom-summary.json')).toContain('"authoritativeCorrectnessGate"');
    expect(writes.get('/repo/.tmp/out/custom-summary.json')).toContain('"secondaryDistributionTelemetry"');
    expect(writes.get('/repo/.tmp/out/semantic-soak-trend.json')).toContain('"sampleFillRate": 0.5');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"promotionAssessment"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"combinedGateCommand": "pnpm test:storycluster:correctness"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('/repo/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"headlineSoakTrendIndexPath": "/repo/.tmp/out/headline-soak-trend-index.json"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"continuityAnalysisPath": "/repo/.tmp/out/continuity-analysis.json"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"retainedSourceEvidencePath": "/repo/.tmp/out/run-1.retained-source-evidence.json"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"continuityTrendIndexPath": "/repo/.tmp/out/continuity-trend-index.json"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"ghostRetainedMeshReportPath": "/repo/.tmp/out/ghost-retained-mesh-report.json"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"ghostRetainedMeshTrendIndexPath": "/repo/.tmp/out/ghost-retained-mesh-trend-index.json"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"offlineClusterReplayReportPath": "/repo/.tmp/out/offline-cluster-replay-report.json"');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"offlineClusterReplayTrendIndexPath": "/repo/.tmp/out/offline-cluster-replay-trend-index.json"');
    expect(writes.get('/repo/.tmp/out/headline-soak-trend-index.json')).toContain('"executionCount": 1');
    expect(writes.get('/repo/.tmp/headline-soak-trend-index.json')).toContain('"latestArtifactDir": "/repo/.tmp/out"');
    expect(writes.get('/repo/.tmp/out/continuity-analysis.json')).toContain('"schemaVersion": "daemon-feed-headline-soak-continuity-analysis-v1"');
    expect(writes.get('/repo/.tmp/out/continuity-analysis.json')).toContain('"topicRetentionRate":');
    expect(writes.get('/repo/.tmp/out/continuity-trend-index.json')).toContain('"schemaVersion": "daemon-feed-headline-soak-continuity-trend-index-v1"');
    expect(writes.get('/repo/.tmp/continuity-trend-index.json')).toContain('"latestArtifactDir": "/repo/.tmp/out"');
    expect(writes.get('/repo/.tmp/out/ghost-retained-mesh-report.json')).toContain('"schemaVersion": "daemon-feed-ghost-retained-mesh-report-v1"');
    expect(writes.get('/repo/.tmp/out/ghost-retained-mesh-trend-index.json')).toContain('"schemaVersion": "daemon-feed-ghost-retained-mesh-trend-index-v1"');
    expect(writes.get('/repo/.tmp/ghost-retained-mesh-trend-index.json')).toContain('"latestArtifactDir": "/repo/.tmp/out"');
    expect(writes.get('/repo/.tmp/out/offline-cluster-replay-report.json')).toContain('"schemaVersion": "daemon-feed-offline-cluster-replay-report-v1"');
    expect(writes.get('/repo/.tmp/out/offline-cluster-replay-trend-index.json')).toContain('"schemaVersion": "daemon-feed-offline-cluster-replay-trend-index-v1"');
    expect(writes.get('/repo/.tmp/offline-cluster-replay-trend-index.json')).toContain('"latestArtifactDir": "/repo/.tmp/out"');
    expect(virtualFs.renameCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ toPath: '/repo/.tmp/headline-soak-trend-index.json' }),
      expect.objectContaining({ toPath: '/repo/.tmp/continuity-trend-index.json' }),
      expect.objectContaining({ toPath: '/repo/.tmp/ghost-retained-mesh-trend-index.json' }),
      expect.objectContaining({ toPath: '/repo/.tmp/offline-cluster-replay-trend-index.json' }),
    ]));
    expect(virtualFs.renameCalls.every(({ fromPath }) => fromPath.includes('.tmp-'))).toBe(true);
    expect(logs.some((message) => message.includes('artifact-index'))).toBe(true);
    expect(logs.some((message) => message.includes('headline-soak-trend-index'))).toBe(true);
    expect(logs.some((message) => message.includes('continuity-analysis'))).toBe(true);
    expect(logs.some((message) => message.includes('continuity-trend-index'))).toBe(true);
    expect(logs.some((message) => message.includes('ghost-retained-mesh-report'))).toBe(true);
    expect(logs.some((message) => message.includes('ghost-retained-mesh-trend-index'))).toBe(true);
    expect(logs.some((message) => message.includes('offline-cluster-replay-report'))).toBe(true);
    expect(logs.some((message) => message.includes('offline-cluster-replay-trend-index'))).toBe(true);
  });

  it('fails fast when the build step fails', async () => {
    const spawn = vi.fn().mockReturnValueOnce({ status: 2, stdout: '', stderr: 'boom' });
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = (() => true);

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        repoRoot: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        },
        spawn,
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        resolvePortPlan: resolveTestPortPlan,
      })).rejects.toThrow('daemon-feed-build-failed:2');
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });

  it('returns a passing summary, persists attachments, and sleeps between successful runs', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const sleepImpl = vi.fn();
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', makeReport({
        requested_sample_count: 1,
        sampled_story_count: 1,
        overall: {
          audited_pair_count: 1,
          related_topic_only_pair_count: 0,
          sample_fill_rate: 1,
          sample_shortfall: 0,
          pass: true,
        },
        supply: {
          story_count: 4,
          auditable_count: 2,
          visible_story_ids: ['story-1'],
          top_story_ids: ['story-1'],
          top_auditable_story_ids: ['story-1'],
          sample_fill_rate: 1,
          sample_shortfall: 0,
        },
        bundles: [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'Headline',
          canonical_source_count: 2,
          canonical_sources: [{ source_id: 'guardian-us' }, { source_id: 'cbs-politics' }],
          pairs: [{ label: 'same_incident' }],
          has_related_topic_only_pair: false,
        }],
      })),
      makeAttachment('daemon-first-feed-semantic-audit-failure-snapshot', {
        story_count: 4,
        auditable_count: 2,
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
      }),
      makeAttachment('daemon-first-feed-retained-source-evidence', {
        schemaVersion: 'daemon-feed-retained-source-evidence-v1',
        generatedAt: '2026-03-22T00:00:00.000Z',
        story_count: 4,
        auditable_count: 2,
        visible_story_ids: ['story-1'],
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
        source_count: 2,
        sources: [{
          source_id: 'guardian-us',
          publisher: 'Guardian',
          url: 'https://example.com/guardian-us',
          url_hash: 'guardian-us-1',
          title: 'Guardian headline',
          observations: [{
            story_id: 'story-1',
            topic_id: 'topic-1',
            headline: 'Headline',
            source_count: 2,
            primary_source_count: 2,
            secondary_asset_count: 0,
            is_auditable: true,
            is_dom_visible: true,
            source_roles: ['primary_source', 'source'],
          }],
        }],
      }),
      makeAttachment('daemon-first-feed-runtime-logs', { browserLogs: ['browser-log'] }),
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 0, stdout: JSON.stringify(playwrightReport), stderr: '' },
      { status: 0, stdout: JSON.stringify(playwrightReport), stderr: '' },
    );

    const result = await runDaemonFeedSemanticSoak({
      cwd: '/repo',
      repoRoot: '/repo',
      env: {
        VH_DAEMON_FEED_SOAK_RUNS: '2',
        VH_DAEMON_FEED_SOAK_PAUSE_MS: '5',
        VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
      },
      spawn,
      mkdir: vi.fn(),
      rename: virtualFs.rename,
      exists: virtualFs.exists,
      stat: virtualFs.stat,
      readdir: virtualFs.readdir,
      readFile: (target) => writes.get(target),
      writeFile: (target, content) => writes.set(target, String(content)),
      resolvePortPlan: resolveTestPortPlan,
      log: vi.fn(),
      sleepImpl,
    });

    expect(result.summary.strictSoakPass).toBe(true);
    expect(result.summary.readinessStatus).toBe('not_ready');
    expect(result.summary.promotionAssessment.blockingReasons).toContain('insufficient_run_count');
    expect(result.summary.repeatedStoryCount).toBe(1);
    expect(result.summary.totalBundledStories).toBe(2);
    expect(result.summary.totalCorroboratedBundles).toBe(2);
    expect(result.summary.totalSingletonBundles).toBe(0);
    expect(result.headlineSoakTrendIndex.executionCount).toBe(1);
    expect(result.continuityAnalysis.schemaVersion).toBe('daemon-feed-headline-soak-continuity-analysis-v1');
    expect(result.continuityTrendIndex.schemaVersion).toBe('daemon-feed-headline-soak-continuity-trend-index-v1');
    expect(result.ghostRetainedMeshReport.schemaVersion).toBe('daemon-feed-ghost-retained-mesh-report-v1');
    expect(result.ghostRetainedMeshTrendIndex.schemaVersion).toBe('daemon-feed-ghost-retained-mesh-trend-index-v1');
    expect(result.results).toHaveLength(2);
    expect(sleepImpl).toHaveBeenCalledWith(5);
    expect(writes.get('/repo/.tmp/out/run-1.semantic-audit.json')).toContain('"requested_sample_count": 1');
    expect(writes.get('/repo/.tmp/out/run-1.semantic-audit-failure-snapshot.json')).toContain('"story_count": 4');
    expect(writes.get('/repo/.tmp/out/run-1.retained-source-evidence.json')).toContain('"schemaVersion": "daemon-feed-retained-source-evidence-v1"');
    expect(writes.get('/repo/.tmp/out/run-1.runtime-logs.json')).toContain('browser-log');
    expect(writes.get('/repo/.tmp/out/continuity-analysis.json')).toContain('"topic_id": "topic-1"');
    expect(writes.get('/repo/.tmp/out/continuity-trend-index.json')).toContain('"analysisCount": 1');
    expect(writes.get('/repo/.tmp/out/ghost-retained-mesh-report.json')).toContain('"currentTopicIdRegime": "post-entity-key-stability-tiebreak"');
    expect(writes.get('/repo/.tmp/out/ghost-retained-mesh-trend-index.json')).toContain('"reportCount": 1');
  });

  it('records parse and attachment failures before exiting the failing soak run', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 1, stdout: '{bad json', stderr: '' },
    );
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        repoRoot: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        },
        spawn,
        mkdir: vi.fn(),
        rename: virtualFs.rename,
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        resolvePortPlan: resolveTestPortPlan,
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    expect(writes.get('/repo/.tmp/out/semantic-soak-summary.json')).toContain('"reportParseError":');
    expect(writes.get('/repo/.tmp/out/semantic-soak-summary.json')).toContain('attachment missing');
  });

  it('records invalid failure/runtime attachments without overwriting an existing audit error', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const primaryResult = makePrimaryResult([
      { name: 'daemon-first-feed-semantic-audit', body: Buffer.from('not-json').toString('base64') },
      { name: 'daemon-first-feed-semantic-audit-failure-snapshot', body: Buffer.from('still-not-json').toString('base64') },
      { name: 'daemon-first-feed-runtime-logs', body: Buffer.from('also-not-json').toString('base64') },
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 1, stdout: JSON.stringify(playwrightReport), stderr: '' },
    );
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        repoRoot: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        },
        spawn,
        mkdir: vi.fn(),
        rename: virtualFs.rename,
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        resolvePortPlan: resolveTestPortPlan,
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    const summary = writes.get('/repo/.tmp/out/semantic-soak-summary.json');
    expect(summary).toContain('Unexpected token');
    expect(summary).not.toContain('also-not-json');
    expect(summary).not.toContain('still-not-json');
  });

  it('disambiguates missing audit artifacts when the playwright result has no attachments', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const primaryResult = makePrimaryResult([]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 1, stdout: JSON.stringify(playwrightReport), stderr: '' },
    );
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        repoRoot: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        },
        spawn,
        mkdir: vi.fn(),
        rename: virtualFs.rename,
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        resolvePortPlan: resolveTestPortPlan,
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    const summary = JSON.parse(writes.get('/repo/.tmp/out/semantic-soak-summary.json'));
    expect(summary.results[0]).toMatchObject({
      auditArtifactState: 'crash_before_attachment',
      playwrightPrimaryResultPresent: true,
      playwrightResultStatus: null,
      playwrightAttachmentCount: 0,
      auditError: 'daemon-first-feed-semantic-audit attachment missing',
    });
  });

  it('disambiguates missing audit artifacts when auxiliary attachments exist', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit-failure-snapshot', {
        story_count: 3,
        auditable_count: 1,
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
      }),
      makeAttachment('daemon-first-feed-runtime-logs', { browserLogs: ['log-1'] }),
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 1, stdout: JSON.stringify(playwrightReport), stderr: '' },
    );
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        repoRoot: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        },
        spawn,
        mkdir: vi.fn(),
        rename: virtualFs.rename,
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        resolvePortPlan: resolveTestPortPlan,
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    const summary = JSON.parse(writes.get('/repo/.tmp/out/semantic-soak-summary.json'));
    expect(summary.results[0]).toMatchObject({
      auditArtifactState: 'audit_attachment_missing_with_auxiliary_attachments',
      playwrightPrimaryResultPresent: true,
      playwrightAttachmentCount: 2,
      failureSnapshotPath: '/repo/.tmp/out/run-1.semantic-audit-failure-snapshot.json',
      runtimeLogsPath: '/repo/.tmp/out/run-1.runtime-logs.json',
    });
  });

  it('disambiguates path-only audit attachments as attachment_path_mismatch', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const primaryResult = {
      status: 'failed',
      attachments: [
        {
          name: 'daemon-first-feed-semantic-audit',
          path: '/tmp/missing-audit.json',
          contentType: 'application/json',
        },
      ],
    };
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 1, stdout: JSON.stringify(playwrightReport), stderr: '' },
    );
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        repoRoot: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        },
        spawn,
        mkdir: vi.fn(),
        rename: virtualFs.rename,
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        resolvePortPlan: resolveTestPortPlan,
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    const summary = JSON.parse(writes.get('/repo/.tmp/out/semantic-soak-summary.json'));
    expect(summary.results[0]).toMatchObject({
      auditArtifactState: 'attachment_path_mismatch',
      playwrightPrimaryResultPresent: true,
      playwrightResultStatus: 'failed',
      playwrightAttachmentCount: 1,
      auditError: 'daemon-first-feed-semantic-audit attachment missing',
    });
  });

  it('treats continuity telemetry failures as non-blocking and still writes the core soak artifacts', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const errorLog = vi.fn();
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', makeReport({
        requested_sample_count: 1,
        sampled_story_count: 1,
        overall: {
          audited_pair_count: 1,
          related_topic_only_pair_count: 0,
          sample_fill_rate: 1,
          sample_shortfall: 0,
          pass: true,
        },
        supply: {
          story_count: 4,
          auditable_count: 2,
          visible_story_ids: ['story-1'],
          top_story_ids: ['story-1'],
          top_auditable_story_ids: ['story-1'],
          sample_fill_rate: 1,
          sample_shortfall: 0,
        },
        bundles: [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'Headline',
          canonical_source_count: 2,
          canonical_sources: [{ source_id: 'guardian-us' }, { source_id: 'cbs-politics' }],
          pairs: [{ label: 'same_incident' }],
          has_related_topic_only_pair: false,
        }],
      })),
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 0, stdout: JSON.stringify(playwrightReport), stderr: '' },
    );

    const result = await runDaemonFeedSemanticSoak({
      cwd: '/repo',
      repoRoot: '/repo',
      env: {
        VH_DAEMON_FEED_SOAK_RUNS: '1',
        VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
        VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
      },
      spawn,
      mkdir: vi.fn(),
      rename: virtualFs.rename,
      exists: virtualFs.exists,
      stat: virtualFs.stat,
      readdir: virtualFs.readdir,
      readFile: (target) => writes.get(target),
      writeFile: (target, content) => {
        if (target.endsWith('/continuity-analysis.json')) {
          throw new Error('disk-full-on-continuity-write');
        }
        writes.set(target, String(content));
      },
      resolvePortPlan: resolveTestPortPlan,
      log: vi.fn(),
      errorLog,
      sleepImpl: vi.fn(),
    });

    expect(result.summary.strictSoakPass).toBe(true);
    expect(result.continuityAnalysis).toBeNull();
    expect(result.continuityTrendIndex).toBeNull();
    expect(writes.get('/repo/.tmp/out/semantic-soak-summary.json')).toContain('"strictSoakPass": true');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"continuityAnalysisPath": null');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"continuityTrendIndexPath": null');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"retainedSourceEvidencePath": null');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"ghostRetainedMeshReportPath": null');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"ghostRetainedMeshTrendIndexPath": null');
    expect(errorLog).toHaveBeenCalledWith('[vh:daemon-soak] continuity-telemetry-error: disk-full-on-continuity-write');
  });

  it('treats ghost retained-mesh telemetry failures as non-blocking and preserves the core soak artifacts', async () => {
    const writes = new Map();
    const virtualFs = makeVirtualArtifactFs(writes);
    const errorLog = vi.fn();
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', makeReport({
        requested_sample_count: 1,
        sampled_story_count: 1,
        overall: {
          audited_pair_count: 1,
          related_topic_only_pair_count: 0,
          sample_fill_rate: 1,
          sample_shortfall: 0,
          pass: true,
        },
        supply: {
          story_count: 2,
          auditable_count: 1,
          visible_story_ids: ['story-1'],
          top_story_ids: ['story-1'],
          top_auditable_story_ids: ['story-1'],
          sample_fill_rate: 1,
          sample_shortfall: 0,
        },
        bundles: [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'Headline',
          canonical_source_count: 1,
          canonical_sources: [{ source_id: 'guardian-us' }],
          pairs: [{ label: 'same_incident' }],
          has_related_topic_only_pair: false,
        }],
      })),
      makeAttachment('daemon-first-feed-retained-source-evidence', {
        schemaVersion: 'daemon-feed-retained-source-evidence-v1',
        generatedAt: '2026-03-22T00:00:00.000Z',
        story_count: 2,
        auditable_count: 1,
        visible_story_ids: ['story-1'],
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
        source_count: 1,
        sources: [{
          source_id: 'guardian-us',
          publisher: 'Guardian',
          url: 'https://example.com/guardian-us',
          url_hash: 'guardian-us-1',
          title: 'Guardian headline',
          observations: [{
            story_id: 'story-1',
            topic_id: 'topic-1',
            headline: 'Headline',
            source_count: 1,
            primary_source_count: 1,
            secondary_asset_count: 0,
            is_auditable: false,
            is_dom_visible: true,
            source_roles: ['source'],
          }],
        }],
      }),
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = makeSpawnMock(
      { status: 0, stdout: 'build ok', stderr: '' },
      { status: 0, stdout: JSON.stringify(playwrightReport), stderr: '' },
    );

    const result = await runDaemonFeedSemanticSoak({
      cwd: '/repo',
      repoRoot: '/repo',
      env: {
        VH_DAEMON_FEED_SOAK_RUNS: '1',
        VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
        VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
      },
      spawn,
      mkdir: vi.fn(),
      rename: virtualFs.rename,
      exists: virtualFs.exists,
      stat: virtualFs.stat,
      readdir: virtualFs.readdir,
      readFile: (target) => writes.get(target),
      writeFile: (target, content) => {
        if (target.endsWith('/ghost-retained-mesh-report.json')) {
          throw new Error('disk-full-on-ghost-retained-mesh');
        }
        writes.set(target, String(content));
      },
      resolvePortPlan: resolveTestPortPlan,
      log: vi.fn(),
      errorLog,
      sleepImpl: vi.fn(),
    });

    expect(result.summary.strictSoakPass).toBe(true);
    expect(result.ghostRetainedMeshReport).toBeNull();
    expect(result.ghostRetainedMeshTrendIndex).toBeNull();
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"ghostRetainedMeshReportPath": null');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"ghostRetainedMeshTrendIndexPath": null');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"continuityAnalysisPath": "/repo/.tmp/out/continuity-analysis.json"');
    expect(errorLog).toHaveBeenCalledWith('[vh:daemon-soak] ghost-retained-mesh-error: disk-full-on-ghost-retained-mesh');
  });

});
