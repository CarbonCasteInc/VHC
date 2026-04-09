#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifyPublisherCanaryOutcome,
  formatConsoleArgs,
  observePublisherCanaryEvents,
  rankFeedSourcesByIds,
  resolveAutomationStackState,
  summarizePublishedStoreSnapshot,
} from './daemon-feed-canary-shared.mjs';
import {
  formatErrorMessage,
  readPositiveInt,
  resolvePublicSemanticSoakSourceIds,
  sleep,
} from './daemon-feed-semantic-soak-core.mjs';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const DEFAULT_TOPIC_MAPPING = {
  defaultTopicId: 'topic-news',
  sourceTopics: {},
};
const DEFAULT_REMOTE_TIMEOUT_MS = 240_000;
const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
const DEFAULT_SERVER_READY_TIMEOUT_MS = 15_000;
const DEFAULT_CANARY_LEASE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PUBLISHER_CANARY_MAX_ITEMS_TOTAL = '15';
/* c8 ignore start */

function resolvePublisherCanaryRequireSharedStack(env = process.env) {
  return env.VH_DAEMON_FEED_REQUIRE_SHARED_STACK === 'true';
}

function resolvePublisherCanaryMaxItemsTotal(env = process.env) {
  const configured = env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL?.trim();
  if (configured) {
    return configured;
  }
  return DEFAULT_PUBLISHER_CANARY_MAX_ITEMS_TOTAL;
}

function resolvePublisherCanaryOpenAITimeoutMs(env = process.env) {
  return readPositiveInt(
    'VH_DAEMON_FEED_STORYCLUSTER_OPENAI_TIMEOUT_MS',
    DEFAULT_OPENAI_TIMEOUT_MS,
    env,
  );
}

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function publisherCanaryArtifactDirFromEnv(env = process.env, repoRoot = DEFAULT_REPO_ROOT) {
  const explicit = env.VH_DAEMON_FEED_PUBLISHER_CANARY_ARTIFACT_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  return path.join(repoRoot, '.tmp', 'daemon-feed-publisher-canary', String(Date.now()));
}

function writeAtomicJson(
  targetPath,
  value,
  {
    mkdir = mkdirSync,
    writeFile = writeFileSync,
    rename = renameSync,
  } = {},
) {
  mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  rename(tempPath, targetPath);
}

function createCapturedConsole() {
  const records = [];
  const original = {
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const push = (level, args) => {
    const message = formatConsoleArgs(args);
    records.push({ level, message });
    original[level](...args);
  };

  console.info = (...args) => push('info', args);
  console.warn = (...args) => push('warn', args);
  console.error = (...args) => push('error', args);

  return {
    records,
    restore() {
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

async function waitForServerListening(server) {
  if (server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

async function waitForHealth(
  url,
  timeoutMs,
  fetchImpl = fetch,
  sleepImpl = sleep,
  headers = undefined,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(1_500),
        headers,
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await sleepImpl(250);
  }
  throw new Error(`publisher-canary-ready-timeout:${url}`);
}

async function waitForPublisherOutcome(records, timeoutMs, sleepImpl = sleep) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const observed = observePublisherCanaryEvents(records);
    if (observed.tickCompleted) {
      return 'completed';
    }
    if (observed.tickFailed) {
      return 'failed';
    }
    await sleepImpl(250);
  }
  return 'timeout';
}

async function closeServer(server) {
  if (!server || typeof server.close !== 'function') {
    return;
  }
  await new Promise((resolve) => server.close(() => resolve()));
}

function resolvePublisherCanaryRemoteConfig(
  repoRoot,
  env = process.env,
  {
    exists = existsSync,
    readFile = readFileSync,
  } = {},
) {
  const explicitClusterEndpoint = env.VH_DAEMON_FEED_STORYCLUSTER_ENDPOINT?.trim();
  const explicitReadyUrl = env.VH_DAEMON_FEED_STORYCLUSTER_READY_URL?.trim();
  const explicitAuthToken = env.VH_DAEMON_FEED_STORYCLUSTER_TOKEN?.trim();
  if (explicitClusterEndpoint) {
    return {
      mode: 'explicit',
      clusterEndpoint: explicitClusterEndpoint,
      readyUrl: explicitReadyUrl || explicitClusterEndpoint.replace(/\/cluster(?:\/)?$/, '/ready'),
      authToken: explicitAuthToken || null,
      statePath: null,
    };
  }

  const stackState = resolveAutomationStackState(repoRoot, {
    env,
    exists,
    readFile,
  });
  if (stackState?.storyclusterClusterUrl && stackState.storyclusterReadyUrl) {
    return {
      mode: 'automation-stack',
      clusterEndpoint: stackState.storyclusterClusterUrl,
      readyUrl: stackState.storyclusterReadyUrl,
      authToken: explicitAuthToken || stackState.storyclusterAuthToken || 'vh-local-storycluster-token',
      statePath: stackState.statePath,
    };
  }

  return {
    mode: 'ephemeral',
    clusterEndpoint: null,
    readyUrl: null,
    authToken: explicitAuthToken || 'vh-publisher-canary-token',
    statePath: stackState?.statePath || null,
  };
}

async function loadPublisherCanaryModules(repoRoot = DEFAULT_REPO_ROOT) {
  const load = async (relativePath) =>
    import(pathToFileURL(path.join(repoRoot, relativePath)).href);

  const [
    newsAggregator,
    aiEngine,
    nodeMeshClient,
    storyclusterServer,
    storyclusterOpenAI,
    vectorBackend,
    clusterStore,
  ] = await Promise.all([
    load('services/news-aggregator/dist/index.js'),
    load('packages/ai-engine/dist/index.js'),
    load('packages/gun-client/dist/index.js'),
    load('services/storycluster-engine/dist/server.js'),
    load('services/storycluster-engine/dist/openaiProvider.js'),
    load('services/storycluster-engine/dist/vectorBackend.js'),
    load('services/storycluster-engine/dist/clusterStore.js'),
  ]);

  return {
    createNewsAggregatorDaemon: newsAggregator.createNewsAggregatorDaemon,
    resolveStarterFeedSources: newsAggregator.resolveStarterFeedSources,
    startNewsRuntime: aiEngine.startNewsRuntime,
    createNodeMeshClient: nodeMeshClient.createNodeMeshClient,
    startStoryClusterServer: storyclusterServer.startStoryClusterServer,
    resolveOpenAIStoryClusterProviderProvenanceFromEnv:
      storyclusterOpenAI.resolveOpenAIStoryClusterProviderProvenanceFromEnv,
    MemoryVectorBackend: vectorBackend.MemoryVectorBackend,
    FileClusterStore: clusterStore.FileClusterStore,
  };
}

function selectFeedSources(feedSources, sourceIds) {
  const ranked = rankFeedSourcesByIds(feedSources, sourceIds);
  if (sourceIds.length === 0) {
    return ranked;
  }
  const allow = new Set(sourceIds);
  return ranked.filter((source) => allow.has(source.id));
}

function sortStoryIdsByLatestIndex(latestIndex) {
  return Object.entries(latestIndex ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([storyId]) => storyId);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortStorylines(storylines) {
  return [...storylines].sort((left, right) =>
    (left?.topic_id ?? '').localeCompare(right?.topic_id ?? '')
    || (left?.storyline_id ?? '').localeCompare(right?.storyline_id ?? ''),
  );
}

function buildPublishedStoreCapture() {
  const storiesById = new Map();
  const storylinesById = new Map();
  const latestIndex = {};
  const hotIndex = {};

  return {
    async writeStoryBundle(_client, bundle) {
      const normalized = cloneJson(bundle);
      storiesById.set(normalized.story_id, normalized);
      latestIndex[normalized.story_id] = Number.isFinite(normalized.cluster_window_end)
        ? Math.max(0, Math.floor(normalized.cluster_window_end))
        : 0;
      hotIndex[normalized.story_id] = Number.isFinite(normalized.cluster_window_end)
        ? Math.max(0, Math.floor(normalized.cluster_window_end))
        : 0;
      return normalized;
    },
    async removeStoryBundle(_client, storyId) {
      const normalizedId = typeof storyId === 'string' ? storyId.trim() : '';
      if (!normalizedId) {
        return;
      }
      storiesById.delete(normalizedId);
      delete latestIndex[normalizedId];
      delete hotIndex[normalizedId];
    },
    async writeStorylineGroup(_client, storyline) {
      const normalized = cloneJson(storyline);
      storylinesById.set(normalized.storyline_id, normalized);
      return normalized;
    },
    async removeStorylineGroup(_client, storylineId) {
      const normalizedId = typeof storylineId === 'string' ? storylineId.trim() : '';
      if (!normalizedId) {
        return;
      }
      storylinesById.delete(normalizedId);
    },
    snapshot(runId) {
      const storyIds = sortStoryIdsByLatestIndex(latestIndex);
      const stories = storyIds
        .map((storyId) => storiesById.get(storyId))
        .filter(Boolean);
      const storylineIds = new Set(
        stories
          .map((story) => story?.storyline_id)
          .filter((storylineId) => typeof storylineId === 'string' && storylineId.trim().length > 0),
      );
      const storylines = sortStorylines(
        [...storylineIds]
          .map((storylineId) => storylinesById.get(storylineId))
          .filter(Boolean),
      );

      return {
        schemaVersion: 'daemon-feed-publisher-canary-store-snapshot-v1',
        generatedAt: new Date().toISOString(),
        runId,
        latestIndex: { ...latestIndex },
        hotIndex: { ...hotIndex },
        stories,
        storylines,
      };
    },
  };
}

export async function runDaemonFeedPublisherCanary({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  exists = existsSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  rename = renameSync,
  writeFile = writeFileSync,
  fetchImpl = fetch,
  sleepImpl = sleep,
  loadModules = loadPublisherCanaryModules,
  log = console.log,
} = {}) {
  const artifactDir = publisherCanaryArtifactDirFromEnv(env, repoRoot);
  const summaryPath = path.join(artifactDir, 'publisher-canary-summary.json');
  const snapshotPath = path.join(artifactDir, 'published-store-snapshot.json');
  const logsPath = path.join(artifactDir, 'publisher-canary-runtime-logs.json');
  const runtimeArtifactRoot = path.join(artifactDir, 'runtime');
  const runId = env.VH_DAEMON_FEED_RUN_ID?.trim() || `publisher-canary-${Date.now()}`;
  const sourceIds = resolvePublicSemanticSoakSourceIds(env, {
    repoRoot,
    exists,
    readFile,
  });
  const requireSharedStack = resolvePublisherCanaryRequireSharedStack(env);
  const remoteConfig = resolvePublisherCanaryRemoteConfig(repoRoot, env, {
    exists,
    readFile,
  });
  const maxItemsPerSource = env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE?.trim() || '2';
  const maxItemsTotal = resolvePublisherCanaryMaxItemsTotal(env);
  const timeoutMs = readPositiveInt(
    'VH_DAEMON_FEED_PUBLISHER_CANARY_TIMEOUT_MS',
    DEFAULT_REMOTE_TIMEOUT_MS,
    env,
  );
  const storyClusterOpenAITimeoutMs = resolvePublisherCanaryOpenAITimeoutMs(env);
  const leaseTtlMs = readPositiveInt(
    'VH_DAEMON_FEED_PUBLISHER_CANARY_LEASE_TTL_MS',
    Math.max(DEFAULT_CANARY_LEASE_TTL_MS, timeoutMs + 120_000),
    env,
  );

  mkdir(artifactDir, { recursive: true });
  mkdir(runtimeArtifactRoot, { recursive: true });

  const captured = createCapturedConsole();
  const previousEnv = {
    VH_DAEMON_FEED_RUN_ID: process.env.VH_DAEMON_FEED_RUN_ID,
    VH_DAEMON_FEED_ARTIFACT_ROOT: process.env.VH_DAEMON_FEED_ARTIFACT_ROOT,
    VH_NEWS_RUNTIME_TRACE: process.env.VH_NEWS_RUNTIME_TRACE,
    VH_STORYCLUSTER_TRACE: process.env.VH_STORYCLUSTER_TRACE,
    VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE: process.env.VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE,
    VH_NEWS_FEED_MAX_ITEMS_TOTAL: process.env.VH_NEWS_FEED_MAX_ITEMS_TOTAL,
    VH_STORYCLUSTER_OPENAI_TIMEOUT_MS: process.env.VH_STORYCLUSTER_OPENAI_TIMEOUT_MS,
  };

  let summary;
  let server = null;
  let client = null;
  let daemon = null;
  const publishedStore = buildPublishedStoreCapture();
  let storyclusterOpenAIProvenance = {
    providerId: 'openai-storycluster',
    textModelId: process.env.VH_STORYCLUSTER_TEXT_MODEL?.trim() || 'gpt-4o-mini',
    embeddingModelId: process.env.VH_STORYCLUSTER_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    baseUrl: process.env.VH_STORYCLUSTER_OPENAI_BASE_URL?.trim() || null,
    timeoutMs: storyClusterOpenAITimeoutMs,
  };

  try {
    process.env.VH_DAEMON_FEED_RUN_ID = runId;
    process.env.VH_DAEMON_FEED_ARTIFACT_ROOT = runtimeArtifactRoot;
    process.env.VH_NEWS_RUNTIME_TRACE = 'true';
    process.env.VH_STORYCLUSTER_TRACE = 'true';
    process.env.VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE = maxItemsPerSource;
    process.env.VH_NEWS_FEED_MAX_ITEMS_TOTAL = maxItemsTotal;
    process.env.VH_STORYCLUSTER_OPENAI_TIMEOUT_MS = String(storyClusterOpenAITimeoutMs);

    const modules = await loadModules(repoRoot);
    storyclusterOpenAIProvenance = modules.resolveOpenAIStoryClusterProviderProvenanceFromEnv({
      timeoutMs: storyClusterOpenAITimeoutMs,
    });
    const feedSourceResolution = modules.resolveStarterFeedSources({
      cwd: repoRoot,
      env,
    });
    const selectedFeedSources = selectFeedSources(feedSourceResolution.feedSources, sourceIds);
    if (selectedFeedSources.length === 0) {
      throw new Error('publisher-canary-source-selection-empty');
    }

    if (requireSharedStack && remoteConfig.mode !== 'automation-stack') {
      throw new Error('publisher-canary-shared-stack-required');
    }

    let remoteClusterEndpoint = remoteConfig.clusterEndpoint;
    let readyUrl = remoteConfig.readyUrl;
    let storyclusterToken = remoteConfig.authToken;
    if (remoteConfig.mode === 'ephemeral') {
      const storyclusterStoreDir = path.join(artifactDir, 'storycluster-state');
      const vector = new modules.MemoryVectorBackend();
      const store = new modules.FileClusterStore(storyclusterStoreDir);
      server = modules.startStoryClusterServer({
        host: '127.0.0.1',
        port: 0,
        authToken: storyclusterToken,
        store,
        vectorBackend: vector,
      });
      await waitForServerListening(server);
      const address = server.address();
      const storyclusterPort = typeof address === 'object' && address ? address.port : 0;
      remoteClusterEndpoint = `http://127.0.0.1:${storyclusterPort}/cluster`;
      readyUrl = `http://127.0.0.1:${storyclusterPort}/ready`;
    }
    const remoteClusterHeaders = storyclusterToken
      ? {
        authorization: `Bearer ${storyclusterToken}`,
      }
      : undefined;
    await waitForHealth(
      readyUrl,
      DEFAULT_SERVER_READY_TIMEOUT_MS,
      fetchImpl,
      sleepImpl,
      remoteClusterHeaders,
    );

    client = modules.createNodeMeshClient({
      peers: [],
      requireSession: false,
    });
    let heldLease = null;
    daemon = modules.createNewsAggregatorDaemon({
      client,
      feedSources: selectedFeedSources,
      topicMapping: DEFAULT_TOPIC_MAPPING,
      pollIntervalMs: 60 * 60 * 1000,
      startRuntime(runtimeConfig) {
        return modules.startNewsRuntime({
          ...runtimeConfig,
          writeStoryBundle: publishedStore.writeStoryBundle,
          removeStoryBundle: publishedStore.removeStoryBundle,
          writeStorylineGroup: publishedStore.writeStorylineGroup,
          removeStorylineGroup: publishedStore.removeStorylineGroup,
        });
      },
      leaseTtlMs,
      leaseHolderId: 'vh-publisher-canary',
      readLease: async () => heldLease,
      writeLease: async (_runtimeClient, nextLease) => {
        heldLease = nextLease;
        return nextLease;
      },
      runtimeOrchestratorOptions: {
        productionMode: true,
        allowHeuristicFallback: false,
        remoteClusterEndpoint,
        remoteClusterTimeoutMs: timeoutMs,
        remoteClusterHeaders,
      },
    });

    await daemon.start();
    const waitOutcome = await waitForPublisherOutcome(captured.records, timeoutMs, sleepImpl);
    await sleepImpl(500);

    const publishedStoreSnapshot = publishedStore.snapshot(runId);
    writeAtomicJson(snapshotPath, publishedStoreSnapshot, {
      mkdir,
      writeFile,
      rename,
    });
    writeAtomicJson(logsPath, {
      schemaVersion: 'daemon-feed-publisher-canary-runtime-logs-v1',
      generatedAt: new Date().toISOString(),
      runId,
      records: captured.records,
    }, {
      mkdir,
      writeFile,
      rename,
    });

    const observed = observePublisherCanaryEvents(captured.records);
    const publishedSummary = summarizePublishedStoreSnapshot(publishedStoreSnapshot);
    const clusterCapturePath = path.join(runtimeArtifactRoot, runId, 'cluster-capture.json');
    summary = {
      schemaVersion: 'daemon-feed-publisher-canary-summary-v1',
      generatedAt: new Date().toISOString(),
      runId,
      commitSha: env.VH_GIT_COMMIT_SHA?.trim() || null,
      sourceHealth: {
        reportPath: feedSourceResolution.sourceHealth.reportPath,
        reportSource: feedSourceResolution.sourceHealth.reportSource,
        summary: feedSourceResolution.sourceHealth.summary,
      },
      config: {
        sourceIds,
        selectedSourceIds: selectedFeedSources.map((source) => source.id),
        maxItemsPerSource: Number.parseInt(maxItemsPerSource, 10),
        maxItemsTotal: Number.parseInt(maxItemsTotal, 10),
        leaseTtlMs,
        relayUsed: false,
        browserUsed: false,
        vectorBackend: remoteConfig.mode === 'ephemeral' ? 'memory' : 'external',
        remoteClusterMode: remoteConfig.mode,
      },
      observed,
      artifactPaths: {
        artifactDir,
        summaryPath,
        snapshotPath,
        logsPath,
        clusterCapturePath: exists(clusterCapturePath) ? clusterCapturePath : null,
      },
      automationStack: remoteConfig.mode === 'automation-stack'
        ? {
          statePath: remoteConfig.statePath,
          clusterEndpoint: remoteClusterEndpoint,
          readyUrl,
        }
        : null,
      openAIProvenance: {
        storycluster: storyclusterOpenAIProvenance,
      },
      pass: false,
      outcome: classifyPublisherCanaryOutcome({
        observed,
        waitOutcome,
        storyCount: publishedSummary.storyCount,
        errorMessage: null,
      }),
      ...publishedSummary,
    };
    summary.pass = summary.outcome === 'pass';
  } catch (error) {
    const observed = observePublisherCanaryEvents(captured.records);
    summary = {
      schemaVersion: 'daemon-feed-publisher-canary-summary-v1',
      generatedAt: new Date().toISOString(),
      runId,
      pass: false,
      outcome: classifyPublisherCanaryOutcome({
        observed,
        waitOutcome: 'failed',
        storyCount: 0,
        errorMessage: formatErrorMessage(error),
      }),
      errorMessage: formatErrorMessage(error),
      observed,
      openAIProvenance: {
        storycluster: storyclusterOpenAIProvenance,
      },
      artifactPaths: {
        artifactDir,
        summaryPath,
        snapshotPath: exists(snapshotPath) ? snapshotPath : null,
        logsPath,
        clusterCapturePath: null,
      },
    };
  } finally {
    writeAtomicJson(logsPath, {
      schemaVersion: 'daemon-feed-publisher-canary-runtime-logs-v1',
      generatedAt: new Date().toISOString(),
      runId,
      records: captured.records,
    }, {
      mkdir,
      writeFile,
      rename,
    });
    if (daemon) {
      await daemon.stop().catch(() => {});
    }
    if (client) {
      await client.shutdown().catch(() => {});
    }
    await closeServer(server).catch(() => {});
    captured.restore();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }

  writeAtomicJson(summaryPath, summary, {
    mkdir,
    writeFile,
    rename,
  });
  log(`[vh:publisher-canary] ${summary.pass ? 'PASS' : 'FAIL'} outcome=${summary.outcome} stories=${summary.storyCount ?? 0}`);

  if (!summary.pass) {
    throw new Error(`publisher-canary-${summary.outcome}`);
  }

  return summary;
}

async function main() {
  await runDaemonFeedPublisherCanary();
}

export const publisherCanaryInternal = {
  resolvePublisherCanaryMaxItemsTotal,
  resolvePublisherCanaryOpenAITimeoutMs,
  resolvePublisherCanaryRequireSharedStack,
  resolvePublisherCanaryRemoteConfig,
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('[vh:publisher-canary] failed', error);
      process.exit(1);
    });
}
/* c8 ignore stop */
