import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function rankFeedSourcesByIds(feedSources, rankedIds) {
  const rankedOrder = Array.isArray(rankedIds)
    ? rankedIds.filter((sourceId) => typeof sourceId === 'string' && sourceId.trim().length > 0)
    : [];
  const byId = new Map(
    (Array.isArray(feedSources) ? feedSources : [])
      .filter((source) => typeof source?.id === 'string' && source.id.trim().length > 0)
      .map((source) => [source.id, source]),
  );
  const selected = [];
  const seen = new Set();

  for (const sourceId of rankedOrder) {
    const source = byId.get(sourceId);
    if (source && !seen.has(sourceId)) {
      selected.push(source);
      seen.add(sourceId);
    }
  }

  for (const source of Array.isArray(feedSources) ? feedSources : []) {
    const sourceId = typeof source?.id === 'string' ? source.id : '';
    if (!sourceId || seen.has(sourceId)) {
      continue;
    }
    selected.push(source);
    seen.add(sourceId);
  }

  return selected;
}

export function summarizePublishedStoreSnapshot(snapshot) {
  const stories = Array.isArray(snapshot?.stories) ? snapshot.stories : [];
  const storylines = Array.isArray(snapshot?.storylines) ? snapshot.storylines : [];
  const latestIndex = snapshot?.latestIndex && typeof snapshot.latestIndex === 'object'
    ? snapshot.latestIndex
    : {};
  const hotIndex = snapshot?.hotIndex && typeof snapshot.hotIndex === 'object'
    ? snapshot.hotIndex
    : {};
  const sourceIds = new Set();
  let auditableStoryCount = 0;
  let corroboratedBundleCount = 0;

  for (const story of stories) {
    const primarySourceCount = Array.isArray(story?.primary_sources)
      ? story.primary_sources.length
      : Array.isArray(story?.sources)
        ? story.sources.length
        : 0;
    if (primarySourceCount >= 2) {
      auditableStoryCount += 1;
      corroboratedBundleCount += 1;
    }
    for (const source of story?.sources ?? []) {
      if (typeof source?.source_id === 'string' && source.source_id.trim().length > 0) {
        sourceIds.add(source.source_id.trim());
      }
    }
  }

  return {
    storyCount: stories.length,
    storylineCount: storylines.length,
    latestIndexCount: Object.keys(latestIndex).length,
    hotIndexCount: Object.keys(hotIndex).length,
    auditableStoryCount,
    corroboratedBundleCount,
    uniqueSourceCount: sourceIds.size,
    uniqueSourceIds: [...sourceIds].sort(),
  };
}

export function observePublisherCanaryEvents(records) {
  const lines = (Array.isArray(records) ? records : []).map((record) =>
    typeof record === 'string'
      ? record
      : typeof record?.message === 'string'
        ? record.message
        : '',
  );

  const has = (pattern) => lines.some((line) => line.includes(pattern));

  return {
    tickQueuedImmediate: has('[vh:news-runtime] tick_queued_immediate'),
    tickStarted: has('[vh:news-runtime] tick_started'),
    pipelineStarted: has('[vh:news-orchestrator] pipeline_started'),
    ingestCompleted: has('[vh:news-orchestrator] ingest_completed'),
    normalizeCompleted: has('[vh:news-orchestrator] normalize_completed'),
    topicClusterStarted: has('[vh:news-orchestrator] topic_cluster_started'),
    clusterRequestReceived:
      has('[vh:storycluster] cluster_request_received')
      || has('[vh:storycluster-remote] request_started'),
    clusterRequestCompleted:
      has('[vh:storycluster] cluster_request_completed')
      || has('[vh:storycluster-remote] request_completed'),
    tickCompleted: has('[vh:news-runtime] tick_completed'),
    tickFailed: has('[vh:news-runtime] tick_failed'),
  };
}

export function classifyPublisherCanaryOutcome({
  observed,
  waitOutcome,
  storyCount,
  errorMessage,
}) {
  if (typeof errorMessage === 'string' && errorMessage.length > 0) {
    return 'startup_failure';
  }
  if (waitOutcome === 'timeout') {
    return 'runtime_timeout';
  }
  if (observed?.tickFailed) {
    return 'runtime_failure';
  }
  if (!observed?.clusterRequestReceived) {
    return 'cluster_request_missing';
  }
  if (!observed?.tickCompleted) {
    return 'tick_incomplete';
  }
  if (!isFiniteNumber(storyCount) || storyCount < 1) {
    return 'publish_empty';
  }
  return 'pass';
}

export function classifyConsumerSmokeOutcome({
  renderCount,
  expanded,
  errorMessage,
  validationMode = 'browser',
}) {
  if (typeof errorMessage === 'string' && errorMessage.length > 0) {
    return 'startup_failure';
  }
  if (!isFiniteNumber(renderCount) || renderCount < 1) {
    return 'render_empty';
  }
  if (validationMode === 'http-contract') {
    return 'pass';
  }
  if (!expanded) {
    return 'story_open_failed';
  }
  return 'pass';
}

export function formatConsoleArgs(args) {
  return (Array.isArray(args) ? args : []).map((value) => {
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ');
}

export function resolveLatestPassingCanaryArtifact(
  artifactRoot,
  {
    exists,
    readdir,
    stat,
    readFile,
    summaryFileName,
    requiredArtifactNames,
    passPredicate,
  },
) {
  if (!exists(artifactRoot)) {
    return null;
  }

  const candidates = readdir(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const artifactDir = path.join(artifactRoot, entry.name);
      return {
        artifactDir,
        mtimeMs: stat(artifactDir).mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const candidate of candidates) {
    const summaryPath = path.join(candidate.artifactDir, summaryFileName);
    if (!exists(summaryPath)) {
      continue;
    }
    if (requiredArtifactNames.some((fileName) => !exists(path.join(candidate.artifactDir, fileName)))) {
      continue;
    }

    try {
      const summary = JSON.parse(readFile(summaryPath, 'utf8'));
      if (!passPredicate(summary)) {
        continue;
      }
      return {
        artifactDir: candidate.artifactDir,
        summaryPath,
        summary,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeUrl(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveAutomationStackState(
  repoRoot,
  {
    env = process.env,
    exists = existsSync,
    readFile = readFileSync,
  } = {},
) {
  const explicitStatePath = env.VH_AUTOMATION_STACK_STATE_PATH?.trim();
  const statePath = explicitStatePath || path.join(repoRoot, '.tmp', 'automation-stack', 'state.json');
  if (!exists(statePath)) {
    return null;
  }

  let state;
  try {
    state = JSON.parse(readFile(statePath, 'utf8'));
  } catch {
    return null;
  }

  const services = state?.services ?? {};
  return {
    statePath,
    healthStatus: typeof state?.healthStatus === 'string' ? state.healthStatus : 'unknown',
    webBaseUrl: services.web?.healthy ? normalizeUrl(state?.webBaseUrl) : null,
    relayUrl: services.relay?.healthy ? normalizeUrl(state?.relayUrl) : null,
    storyclusterClusterUrl: services.storycluster?.healthy
      ? normalizeUrl(state?.storyclusterClusterUrl)
      : null,
    storyclusterReadyUrl: services.storycluster?.healthy
      ? normalizeUrl(state?.storyclusterReadyUrl)
      : null,
    storyclusterAuthToken: services.storycluster?.healthy
      ? normalizeUrl(state?.storyclusterAuthToken)
      : null,
    snapshotPath: services.snapshot?.healthy ? normalizeUrl(state?.snapshotPath) : null,
    snapshotUrl: services.snapshot?.healthy && Number.isFinite(state?.ports?.snapshot)
      ? `http://127.0.0.1:${state.ports.snapshot}/snapshot.json`
      : null,
    state,
  };
}
