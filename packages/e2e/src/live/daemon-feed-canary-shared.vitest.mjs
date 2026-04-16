import { describe, expect, it } from 'vitest';
import {
  classifyConsumerSmokeOutcome,
  classifyPublisherCanaryOutcome,
  formatConsoleArgs,
  observePublisherCanaryEvents,
  rankFeedSourcesByIds,
  resolveAutomationStackState,
  resolveLatestPassingCanaryArtifact,
  summarizePublishedStoreSnapshot,
} from './daemon-feed-canary-shared.mjs';

describe('daemon-feed-canary shared helpers', () => {
  it('orders feed sources by ranked ids and appends remaining sources once', () => {
    const feedSources = [
      { id: 'guardian-us' },
      { id: 'bbc-us-canada' },
      { id: 'ap-topnews' },
      { id: 'npr-news' },
    ];

    expect(rankFeedSourcesByIds(feedSources, ['ap-topnews', 'guardian-us', 'ap-topnews'])).toEqual([
      { id: 'ap-topnews' },
      { id: 'guardian-us' },
      { id: 'bbc-us-canada' },
      { id: 'npr-news' },
    ]);
  });

  it('summarizes published store state around auditable and unique-source counts', () => {
    const summary = summarizePublishedStoreSnapshot({
      stories: [
        {
          story_id: 'story-1',
          sources: [
            { source_id: 'guardian-us' },
            { source_id: 'ap-topnews' },
          ],
          primary_sources: [
            { source_id: 'guardian-us' },
            { source_id: 'ap-topnews' },
          ],
        },
        {
          story_id: 'story-2',
          sources: [{ source_id: 'bbc-us-canada' }],
        },
      ],
      storylines: [{ storyline_id: 'storyline-1' }],
      latestIndex: { 'story-1': 100, 'story-2': 50 },
      hotIndex: { 'story-1': 0.7 },
    });

    expect(summary).toMatchObject({
      storyCount: 2,
      storylineCount: 1,
      latestIndexCount: 2,
      hotIndexCount: 1,
      auditableStoryCount: 1,
      corroboratedBundleCount: 1,
      uniqueSourceCount: 3,
    });
    expect(summary.uniqueSourceIds).toEqual([
      'ap-topnews',
      'bbc-us-canada',
      'guardian-us',
    ]);
  });

  it('detects publisher canary events from recorded log lines', () => {
    const observed = observePublisherCanaryEvents([
      '[vh:news-runtime] tick_queued_immediate {"poll_interval_ms":3600000}',
      '[vh:news-runtime] tick_started {"feed_source_count":12}',
      '[vh:news-orchestrator] pipeline_started {"feed_source_count":12}',
      '[vh:news-orchestrator] ingest_completed {"raw_item_count":24}',
      '[vh:news-orchestrator] normalize_completed {"normalized_item_count":19}',
      '[vh:news-orchestrator] topic_cluster_started {"topic_id":"topic-news","item_count":19}',
      '[vh:storycluster] cluster_request_received {"topic_id":"topic-news","item_count":19}',
      '[vh:storycluster] cluster_request_completed {"topic_id":"topic-news","bundle_count":8}',
      '[vh:news-runtime] tick_completed {"published_story_count":8}',
    ]);

    expect(observed).toEqual({
      tickQueuedImmediate: true,
      tickStarted: true,
      pipelineStarted: true,
      ingestCompleted: true,
      normalizeCompleted: true,
      topicClusterStarted: true,
      clusterRequestReceived: true,
      clusterRequestCompleted: true,
      tickCompleted: true,
      tickFailed: false,
    });
  });

  it('treats remote storycluster client logs as valid cluster request evidence', () => {
    const observed = observePublisherCanaryEvents([
      '[vh:news-runtime] tick_started {"feed_source_count":12}',
      '[vh:news-orchestrator] topic_cluster_started {"topic_id":"topic-news","item_count":19}',
      '[vh:storycluster-remote] request_started {"endpoint_url":"http://127.0.0.1:4310/cluster","topic_id":"topic-news","item_count":19}',
      '[vh:storycluster-remote] request_completed {"endpoint_url":"http://127.0.0.1:4310/cluster","topic_id":"topic-news","bundle_count":8}',
      '[vh:news-runtime] tick_completed {"published_story_count":8}',
    ]);

    expect(observed).toMatchObject({
      tickStarted: true,
      topicClusterStarted: true,
      clusterRequestReceived: true,
      clusterRequestCompleted: true,
      tickCompleted: true,
      tickFailed: false,
    });
  });

  it('classifies publisher canary outcomes by observed event shape', () => {
    expect(classifyPublisherCanaryOutcome({
      observed: { tickCompleted: true, clusterRequestReceived: true, tickFailed: false },
      waitOutcome: 'completed',
      storyCount: 4,
      errorMessage: null,
    })).toBe('pass');

    expect(classifyPublisherCanaryOutcome({
      observed: { tickCompleted: false, clusterRequestReceived: true, tickFailed: true },
      waitOutcome: 'failed',
      storyCount: 0,
      errorMessage: null,
    })).toBe('runtime_failure');

    expect(classifyPublisherCanaryOutcome({
      observed: { tickCompleted: false, clusterRequestReceived: false, tickFailed: false },
      waitOutcome: 'timeout',
      storyCount: 0,
      errorMessage: null,
    })).toBe('runtime_timeout');

    expect(classifyPublisherCanaryOutcome({
      observed: { tickCompleted: true, clusterRequestReceived: true, tickFailed: false },
      waitOutcome: 'completed',
      storyCount: 0,
      errorMessage: null,
    })).toBe('publish_empty');
  });

  it('classifies blocked source-health reports as feed-stage outage before clustering starts', () => {
    expect(classifyPublisherCanaryOutcome({
      observed: { tickCompleted: false, clusterRequestReceived: false, tickFailed: false },
      waitOutcome: null,
      storyCount: 0,
      errorMessage: null,
      sourceHealthSummary: {
        readinessStatus: 'blocked',
        recommendedAction: 'investigate_feed_yield',
      },
      sourceHealthReport: {
        runAssessment: {
          globalFeedStageFailure: true,
          latestPublicationAction: 'preserve_previous_latest',
        },
        observability: {
          reasonCounts: {
            feed_fetch_error: 29,
            feed_links_unavailable: 29,
          },
        },
      },
    })).toBe('feed_stage_outage');
  });

  it('classifies consumer smoke outcomes by render and expand state', () => {
    expect(classifyConsumerSmokeOutcome({
      renderCount: 3,
      expanded: true,
      errorMessage: null,
    })).toBe('pass');

    expect(classifyConsumerSmokeOutcome({
      renderCount: 0,
      expanded: false,
      errorMessage: null,
    })).toBe('render_empty');

    expect(classifyConsumerSmokeOutcome({
      renderCount: 2,
      expanded: false,
      errorMessage: null,
    })).toBe('story_open_failed');

    expect(classifyConsumerSmokeOutcome({
      renderCount: 2,
      expanded: false,
      errorMessage: null,
      validationMode: 'http-contract',
    })).toBe('pass');
  });

  it('formats console args defensively', () => {
    expect(formatConsoleArgs([
      '[vh:test] line',
      { count: 2, topic_id: 'topic-news' },
      7,
    ])).toBe('[vh:test] line {"count":2,"topic_id":"topic-news"} 7');
  });

  it('resolves the latest passing canary artifact with required files', () => {
    const files = new Map([
      ['/artifacts/100/publisher-canary-summary.json', JSON.stringify({ pass: false })],
      ['/artifacts/100/published-store-snapshot.json', '{}'],
      ['/artifacts/200/publisher-canary-summary.json', JSON.stringify({ pass: true })],
      ['/artifacts/200/published-store-snapshot.json', '{}'],
      ['/artifacts/300/publisher-canary-summary.json', JSON.stringify({ pass: true })],
    ]);

    const resolved = resolveLatestPassingCanaryArtifact('/artifacts', {
      exists: (filePath) => filePath === '/artifacts' || files.has(filePath),
      readdir: () => [
        { name: '100', isDirectory: () => true },
        { name: '200', isDirectory: () => true },
        { name: '300', isDirectory: () => true },
      ],
      stat: (filePath) => ({
        mtimeMs:
          filePath === '/artifacts/300'
            ? 300
            : filePath === '/artifacts/200'
              ? 200
              : 100,
      }),
      readFile: (filePath) => files.get(filePath),
      summaryFileName: 'publisher-canary-summary.json',
      requiredArtifactNames: ['published-store-snapshot.json'],
      passPredicate: (summary) => summary.pass === true,
    });

    expect(resolved).toMatchObject({
      artifactDir: '/artifacts/200',
      summaryPath: '/artifacts/200/publisher-canary-summary.json',
      summary: { pass: true },
    });
  });

  it('reads healthy automation stack endpoints from state', () => {
    const statePath = '/repo/.tmp/automation-stack/state.json';
    const resolved = resolveAutomationStackState('/repo', {
      env: {},
      exists: (filePath) => filePath === statePath,
      readFile: () => JSON.stringify({
        healthStatus: 'healthy',
        services: {
          web: { healthy: true },
          relay: { healthy: true },
          storycluster: { healthy: true },
          snapshot: { healthy: true },
        },
        webBaseUrl: 'http://127.0.0.1:2099',
        relayUrl: 'http://127.0.0.1:7777/gun',
        storyclusterClusterUrl: 'http://127.0.0.1:4310/cluster',
        storyclusterReadyUrl: 'http://127.0.0.1:4310/ready',
        storyclusterAuthToken: 'stack-token',
        snapshotPath: '/repo/.tmp/daemon-feed-publisher-canary/123/published-store-snapshot.json',
        ports: {
          snapshot: 8790,
        },
      }),
    });

    expect(resolved).toMatchObject({
      statePath,
      webBaseUrl: 'http://127.0.0.1:2099',
      relayUrl: 'http://127.0.0.1:7777/gun',
      storyclusterClusterUrl: 'http://127.0.0.1:4310/cluster',
      storyclusterReadyUrl: 'http://127.0.0.1:4310/ready',
      storyclusterAuthToken: 'stack-token',
      snapshotPath: '/repo/.tmp/daemon-feed-publisher-canary/123/published-store-snapshot.json',
      snapshotUrl: 'http://127.0.0.1:8790/snapshot.json',
    });
  });

  it('drops unhealthy automation stack service endpoints', () => {
    const resolved = resolveAutomationStackState('/repo', {
      env: {},
      exists: () => true,
      readFile: () => JSON.stringify({
        healthStatus: 'degraded',
        services: {
          web: { healthy: false },
          relay: { healthy: true },
          storycluster: { healthy: false },
          snapshot: { healthy: true },
        },
        webBaseUrl: 'http://127.0.0.1:2099',
        relayUrl: 'http://127.0.0.1:7777/gun',
        storyclusterClusterUrl: 'http://127.0.0.1:4310/cluster',
        storyclusterReadyUrl: 'http://127.0.0.1:4310/ready',
        storyclusterAuthToken: 'stack-token',
        snapshotPath: '/repo/.tmp/snapshot.json',
        ports: {
          snapshot: 8790,
        },
      }),
    });

    expect(resolved).toMatchObject({
      webBaseUrl: null,
      relayUrl: 'http://127.0.0.1:7777/gun',
      storyclusterClusterUrl: null,
      storyclusterReadyUrl: null,
      storyclusterAuthToken: null,
      snapshotPath: '/repo/.tmp/snapshot.json',
      snapshotUrl: 'http://127.0.0.1:8790/snapshot.json',
    });
  });
});
