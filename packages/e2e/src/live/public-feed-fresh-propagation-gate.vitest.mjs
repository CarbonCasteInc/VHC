import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyFreshPropagationFailure,
  parsePublisherStageEvidence,
  runPublicFeedFreshPropagationGate,
  validateFreshPropagationEvidence,
} from './public-feed-fresh-propagation-gate.mjs';

function publisherLogs() {
  return {
    records: [
      { message: '[vh:news-runtime] tick_started {"feed_source_count":12}' },
      { message: '[vh:news-orchestrator] pipeline_started {"feed_source_count":12}' },
      { message: '[vh:news-orchestrator] ingest_completed {"raw_item_count":17}' },
      { message: '[vh:news-orchestrator] normalize_completed {"normalized_item_count":15}' },
      { message: '[vh:news-orchestrator] topic_cluster_started {"topic_id":"topic-news","item_count":15}' },
      { message: '[vh:storycluster-remote] request_started {"topic_id":"topic-news","item_count":15}' },
      { message: '[vh:storycluster-remote] request_completed {"topic_id":"topic-news","bundle_count":6}' },
      { message: '[vh:news-runtime] tick_completed {"published_story_count":6}' },
    ],
  };
}

function publisherSummary() {
  return {
    schemaVersion: 'daemon-feed-publisher-canary-summary-v1',
    pass: true,
    outcome: 'pass',
    observed: {
      tickStarted: true,
      pipelineStarted: true,
      ingestCompleted: true,
      normalizeCompleted: true,
      topicClusterStarted: true,
      clusterRequestReceived: true,
      clusterRequestCompleted: true,
      tickCompleted: true,
      tickFailed: false,
    },
    sourceHealth: {
      reportSource: 'current-admitted-sources',
      summary: {
        readinessStatus: 'ready',
        feedContribution: {
          totalIngestedItemCount: 17,
          totalNormalizedItemCount: 15,
          totalBundleCount: 6,
          totalCorroboratedBundleCount: 1,
        },
      },
    },
    storyCount: 2,
    latestIndexCount: 2,
    hotIndexCount: 2,
    openAIProvenance: {
      storycluster: {
        providerId: 'openai-storycluster',
        textModelId: 'gpt-4o-mini',
        embeddingModelId: 'text-embedding-3-small',
        baseUrl: null,
        timeoutMs: 120000,
      },
    },
    openAIPreflight: {
      storycluster: {
        status: 'pass',
        code: null,
        provider: {
          providerId: 'openai-storycluster',
          textModelId: 'gpt-4o-mini',
          embeddingModelId: 'text-embedding-3-small',
          baseUrl: null,
          effectiveBaseUrl: 'https://api.openai.com/v1',
          timeoutMs: 120000,
        },
        checks: {
          apiKeyPresent: true,
          textModelAuth: 'pass',
          embeddingModelAuth: 'pass',
        },
      },
    },
  };
}

function publisherSnapshot(now) {
  return {
    schemaVersion: 'daemon-feed-publisher-canary-store-snapshot-v1',
    runId: 'fresh-propagation-test',
    latestIndex: {
      'story-singleton': now - 1_000,
      'story-bundle': now - 2_000,
    },
    hotIndex: {
      'story-singleton': now - 1_000,
      'story-bundle': now - 2_000,
    },
    stories: [
      {
        story_id: 'story-singleton',
        topic_id: 'topic-singleton',
        headline: 'Fresh singleton from live RSS',
        sources: [{ source_id: 'source-a', url: 'https://source-a.example/story' }],
      },
      {
        story_id: 'story-bundle',
        topic_id: 'topic-bundle',
        headline: 'Fresh corroborated bundle from live RSS',
        sources: [
          { source_id: 'source-a', url: 'https://source-a.example/bundle' },
          { source_id: 'source-b', url: 'https://source-b.example/bundle' },
        ],
      },
    ],
    storylines: [],
  };
}

function consumerSummary() {
  return {
    schemaVersion: 'daemon-feed-consumer-smoke-summary-v1',
    pass: true,
    outcome: 'pass',
    validationMode: 'browser',
    renderCount: 2,
    firstStoryId: 'story-singleton',
    sourceBadgeCount: 1,
    expanded: true,
    fixture: {},
  };
}

function browserSmokeSummary() {
  return {
    schemaVersion: 'public-feed-browser-smoke-summary-v1',
    status: 'pass',
    artifactPaths: {
      summaryPath: '/repo/.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json',
    },
    checks: {
      publicRelaySynthesisReadback: {
        latestIndexCount: 2,
        storyReadbackCount: 2,
      },
      currentPublicHeadlinesVisible: {
        count: 2,
      },
      refreshWorks: {
        count: 2,
      },
      publicRelayPaginationReadback: {
        status: 'pass',
      },
    },
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

describe('public feed fresh propagation gate', () => {
  it('parses live daemon stage counts from publisher runtime logs', () => {
    expect(parsePublisherStageEvidence(publisherLogs())).toEqual({
      rawItemCount: 17,
      normalizedItemCount: 15,
      topicClusterItemCount: 15,
      clusterBundleCount: 6,
      publishedStoryCount: 6,
    });
  });

  it('accepts a complete fresh RSS to consumer and public relay evidence chain', () => {
    const now = Date.now();
    expect(validateFreshPropagationEvidence({
      publisherSummary: publisherSummary(),
      publisherLogs: publisherLogs(),
      publisherSnapshot: publisherSnapshot(now),
      publisherSummaryPath: '/artifacts/publisher-canary-summary.json',
      publisherSnapshotPath: '/artifacts/published-store-snapshot.json',
      consumerSummary: {
        ...consumerSummary(),
        fixture: {
          summaryPath: '/artifacts/publisher-canary-summary.json',
          snapshotPath: '/artifacts/published-store-snapshot.json',
        },
      },
      browserSmokeSummary: browserSmokeSummary(),
      env: {
        VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_PUBLIC_BROWSER_SMOKE: 'true',
      },
      now,
    })).toMatchObject({
      status: 'pass',
      storyCounts: {
        rawStoryCount: 2,
        readableStoryBodyCount: 2,
        singletonCount: 1,
        multiSourceCount: 1,
      },
      latestActivityAgeMs: 1_000,
      publicBrowserSmoke: {
        status: 'pass',
        latestIndexCount: 2,
        refreshResultCount: 2,
      },
    });
  });

  it('keeps fresh singleton-only propagation valid unless multi-source proof is required', () => {
    const now = Date.now();
    const snapshot = publisherSnapshot(now);
    snapshot.stories = snapshot.stories.map((story) => ({
      ...story,
      sources: [story.sources[0]],
    }));

    expect(validateFreshPropagationEvidence({
      publisherSummary: publisherSummary(),
      publisherLogs: publisherLogs(),
      publisherSnapshot: snapshot,
      consumerSummary: consumerSummary(),
      env: {},
      now,
    })).toMatchObject({
      status: 'pass',
      storyCounts: {
        singletonCount: 2,
        multiSourceCount: 0,
      },
    });
  });

  it('rejects fresh singleton-only propagation when multi-source proof is required', () => {
    const now = Date.now();
    const snapshot = publisherSnapshot(now);
    snapshot.stories = snapshot.stories.map((story) => ({
      ...story,
      sources: [story.sources[0]],
    }));

    expect(() => validateFreshPropagationEvidence({
      publisherSummary: publisherSummary(),
      publisherLogs: publisherLogs(),
      publisherSnapshot: snapshot,
      consumerSummary: consumerSummary(),
      env: {
        VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_MULTI_SOURCE: 'true',
      },
      now,
    })).toThrow('fresh-propagation-multi-source-missing');
  });

  it('rejects fixture-only producer evidence when live RSS is required', () => {
    const summary = publisherSummary();
    summary.sourceHealth.reportSource = 'fixture';
    expect(() => validateFreshPropagationEvidence({
      publisherSummary: summary,
      publisherLogs: publisherLogs(),
      publisherSnapshot: publisherSnapshot(Date.now()),
      consumerSummary: consumerSummary(),
      env: {},
    })).toThrow('fresh-propagation-fixture-only');
  });

  it('rejects publisher evidence that lacks the StoryCluster OpenAI preflight', () => {
    const summary = publisherSummary();
    delete summary.openAIPreflight;
    expect(() => validateFreshPropagationEvidence({
      publisherSummary: summary,
      publisherLogs: publisherLogs(),
      publisherSnapshot: publisherSnapshot(Date.now()),
      consumerSummary: consumerSummary(),
      env: {},
    })).toThrow('fresh-propagation-openai-preflight-not-passing:missing');
  });

  it('classifies empty or stale propagation by source-health supply evidence', () => {
    expect(classifyFreshPropagationFailure('fresh-propagation-latest-activity-stale:90000000/86400000', {
      totalNormalizedItemCount: 12,
    })).toBe('fail');
    expect(classifyFreshPropagationFailure('fresh-propagation-published-story-empty', {
      totalNormalizedItemCount: 0,
      totalIngestedItemCount: 0,
    })).toBe('setup_scarcity');
    expect(classifyFreshPropagationFailure('fresh-propagation-feed-stage-outage')).toBe('setup_scarcity');
  });

  it('writes a release artifact after running publisher and consumer canary runners', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vh-fresh-propagation-'));
    const artifactDir = path.join(repoRoot, 'release-artifacts');
    const now = Date.now();
    const browserSummaryPath = path.join(
      repoRoot,
      '.tmp',
      'release-evidence',
      'public-feed-browser-smoke',
      'latest',
      'public-feed-browser-smoke-summary.json',
    );
    await writeJson(browserSummaryPath, browserSmokeSummary());

    const report = await runPublicFeedFreshPropagationGate({
      repoRoot,
      now,
      env: {
        VH_PUBLIC_FEED_FRESH_PROPAGATION_ARTIFACT_DIR: artifactDir,
        VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_PUBLIC_BROWSER_SMOKE: 'true',
      },
      runPublisherCanary: async ({ env }) => {
        await writeJson(
          path.join(env.VH_DAEMON_FEED_PUBLISHER_CANARY_ARTIFACT_DIR, 'publisher-canary-summary.json'),
          publisherSummary(),
        );
        await writeJson(
          path.join(env.VH_DAEMON_FEED_PUBLISHER_CANARY_ARTIFACT_DIR, 'published-store-snapshot.json'),
          publisherSnapshot(now),
        );
        await writeJson(
          path.join(env.VH_DAEMON_FEED_PUBLISHER_CANARY_ARTIFACT_DIR, 'publisher-canary-runtime-logs.json'),
          publisherLogs(),
        );
      },
      runConsumerSmoke: async ({ env }) => {
        await writeJson(
          path.join(env.VH_DAEMON_FEED_CONSUMER_SMOKE_ARTIFACT_DIR, 'consumer-smoke-summary.json'),
          {
            ...consumerSummary(),
            fixture: {
              snapshotPath: env.VH_DAEMON_FEED_CONSUMER_SMOKE_FIXTURE_PATH,
              summaryPath: path.join(path.dirname(env.VH_DAEMON_FEED_CONSUMER_SMOKE_FIXTURE_PATH), 'publisher-canary-summary.json'),
            },
          },
        );
      },
    });

    expect(report.status).toBe('pass');
    expect(report.validation.stageCounts.publishedStoryCount).toBe(6);
    const artifact = JSON.parse(await readFile(
      path.join(artifactDir, 'public-feed-fresh-propagation-summary.json'),
      'utf8',
    ));
    expect(artifact.status).toBe('pass');
    expect(artifact.artifactPaths.publisherSummaryPath)
      .toBe(path.join(artifactDir, 'publisher-canary', 'publisher-canary-summary.json'));
  });
});
