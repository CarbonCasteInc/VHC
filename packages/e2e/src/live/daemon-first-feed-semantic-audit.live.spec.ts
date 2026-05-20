import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { expect, test, type BrowserContext } from '@playwright/test';
import {
  FEED_READY_TIMEOUT_MS,
  LIVE_BASE_URL,
  NAV_TIMEOUT_MS,
  SHOULD_RUN,
  addConsumerInitScript,
  attachRuntimeLogs,
  logText,
  startDaemonFirstStack,
  stopDaemonFirstStack,
  waitForHeadlines,
  type DaemonFirstStack,
} from './daemonFirstFeedHarness';
import { resolveSemanticAuditOpenAIConfig } from './daemonFirstFeedSemanticAuditOpenAI';
import {
  assessDaemonFeedClusterCaptureEvidence,
  assessDaemonFirstFeedSemanticAuditGate,
  captureDaemonFirstFeedSemanticAuditSnapshots,
  runDaemonFirstFeedSemanticAudit,
} from './daemonFirstFeedSemanticAudit';
import type { LiveSemanticAuditBundleLike } from './daemonFirstFeedSemanticAuditTypes';

function readPositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }
  return parsed;
}

function resolveSemanticAuditTestTimeoutMs(): number {
  const semanticAuditTimeoutMs =
    readPositiveIntEnv('VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS') ?? 180_000;
  const clusterCaptureTimeoutMs =
    readPositiveIntEnv('VH_DAEMON_FEED_CLUSTER_CAPTURE_TIMEOUT_MS') ?? 180_000;
  return Math.max(
    12 * 60_000,
    FEED_READY_TIMEOUT_MS + semanticAuditTimeoutMs + clusterCaptureTimeoutMs + 180_000,
  );
}

function semanticAuditArtifactDir(): string | null {
  const runId = process.env.VH_DAEMON_FEED_RUN_ID?.trim();
  if (!runId) {
    return null;
  }
  return path.resolve(process.cwd(), '../../.tmp/e2e-daemon-feed', runId);
}

function resolveClusterCaptureTimeoutMs(): number {
  return readPositiveIntEnv('VH_DAEMON_FEED_CLUSTER_CAPTURE_TIMEOUT_MS') ?? 180_000;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readClusterCaptureArtifact(): Promise<unknown | null> {
  const artifactDir = semanticAuditArtifactDir();
  if (!artifactDir) {
    return null;
  }
  try {
    return JSON.parse(await readFile(path.join(artifactDir, 'cluster-capture.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function waitForDaemonClusterCaptureEvidence(): Promise<{
  readonly capture: unknown;
  readonly gate: ReturnType<typeof assessDaemonFeedClusterCaptureEvidence>;
}> {
  const startedAt = Date.now();
  const timeoutMs = resolveClusterCaptureTimeoutMs();
  let lastGate: ReturnType<typeof assessDaemonFeedClusterCaptureEvidence> | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const capture = await readClusterCaptureArtifact();
    if (capture) {
      const gate = assessDaemonFeedClusterCaptureEvidence(capture);
      lastGate = gate;
      if (gate.pass) {
        return { capture, gate };
      }
    }
    await sleep(1_000);
  }

  throw new Error(`daemon-cluster-capture-timeout:${JSON.stringify(lastGate?.blockingReasons ?? ['daemon_cluster_capture_missing'])}`);
}

function isLiveSemanticAuditBundleLike(value: unknown): value is LiveSemanticAuditBundleLike {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return typeof record?.story_id === 'string'
    && typeof record.topic_id === 'string'
    && typeof record.headline === 'string'
    && Array.isArray(record.sources);
}

function extractClusterCaptureBundles(capture: unknown): LiveSemanticAuditBundleLike[] {
  const bundles: LiveSemanticAuditBundleLike[] = [];
  const record = capture && typeof capture === 'object' && !Array.isArray(capture)
    ? capture as Record<string, unknown>
    : null;
  const ticks = Array.isArray(record?.ticks) ? record.ticks : [];

  for (const tick of ticks) {
    const tickRecord = tick && typeof tick === 'object' && !Array.isArray(tick)
      ? tick as Record<string, unknown>
      : null;
    const topicCaptures = Array.isArray(tickRecord?.topicCaptures) ? tickRecord.topicCaptures : [];
    for (const topicCapture of topicCaptures) {
      const topicRecord = topicCapture && typeof topicCapture === 'object' && !Array.isArray(topicCapture)
        ? topicCapture as Record<string, unknown>
        : null;
      const result = topicRecord?.result && typeof topicRecord.result === 'object' && !Array.isArray(topicRecord.result)
        ? topicRecord.result as Record<string, unknown>
        : null;
      const topicBundles = Array.isArray(result?.bundles) ? result.bundles : [];
      for (const bundle of topicBundles) {
        if (isLiveSemanticAuditBundleLike(bundle)) {
          bundles.push(bundle);
        }
      }
    }
  }

  return bundles;
}

function extractClusterCaptureStoryIds(capture: unknown): string[] {
  const storyIds = new Set<string>();
  for (const bundle of extractClusterCaptureBundles(capture)) {
    if (bundle.story_id.trim()) {
      storyIds.add(bundle.story_id);
    }
  }
  return [...storyIds].sort();
}

function requiresDomHeadlineReadiness(): boolean {
  return process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED !== 'true';
}

async function attachSemanticAuditArtifacts(
  testInfo: {
    attach: (name: string, options: { body: string; contentType: string }) => Promise<void>;
  },
  options: {
    includeAuditReport?: boolean;
  } = {},
): Promise<void> {
  const artifactDir = semanticAuditArtifactDir();
  if (!artifactDir) {
    return;
  }

  const attachments = [
    ...(options.includeAuditReport === false ? [] : [{
      name: 'daemon-first-feed-semantic-audit',
      fileName: 'semantic-audit-report.json',
    }]),
    {
      name: 'daemon-first-feed-semantic-audit-failure-snapshot',
      fileName: 'semantic-audit-store-snapshot.json',
    },
    {
      name: 'daemon-first-feed-retained-source-evidence',
      fileName: 'retained-source-evidence-snapshot.json',
    },
    {
      name: 'daemon-first-feed-cluster-capture',
      fileName: 'cluster-capture.json',
    },
  ];

  for (const attachment of attachments) {
    try {
      const body = await readFile(path.join(artifactDir, attachment.fileName), 'utf8');
      await testInfo.attach(attachment.name, {
        body,
        contentType: 'application/json',
      });
    } catch {
      // Artifact not produced in this run.
    }
  }
}

test.describe('daemon-first StoryCluster live semantic audit', () => {
  test.skip(!SHOULD_RUN, 'VH_RUN_DAEMON_FIRST_FEED is not enabled');

  test('rejects canonical bundles that contain topic-only source pairings', async ({ browser }, testInfo) => {
    test.setTimeout(resolveSemanticAuditTestTimeoutMs());

    let stack: DaemonFirstStack | null = null;
    let context: BrowserContext | null = null;
    let page: Awaited<ReturnType<BrowserContext['newPage']>> | null = null;
    const browserLogs: string[] = [];

    try {
      stack = await startDaemonFirstStack();
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      await addConsumerInitScript(context);

      page = await context.newPage();
      page.on('console', (message) => browserLogs.push(logText(message)));

      await page.goto(LIVE_BASE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      const clusterCapture = await waitForDaemonClusterCaptureEvidence();
      const clusterCaptureBundles = extractClusterCaptureBundles(clusterCapture.capture);
      if (requiresDomHeadlineReadiness()) {
        await waitForHeadlines(page);
      }
      await captureDaemonFirstFeedSemanticAuditSnapshots(page);
      const openAI = resolveSemanticAuditOpenAIConfig(process.env);

      const report = await runDaemonFirstFeedSemanticAudit(page, {
        openAIApiKey: openAI.apiKey,
        openAIBaseUrl: openAI.baseUrl,
        openAIModel: openAI.model,
        openAIProviderId: openAI.providerId,
        openAIUsesFixtureStub: openAI.usesFixtureStub,
        sampleCount: readPositiveIntEnv('VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT'),
        timeoutMs: readPositiveIntEnv('VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS'),
        allowedStoryIds: extractClusterCaptureStoryIds(clusterCapture.capture),
        candidateBundles: clusterCaptureBundles,
      });

      await testInfo.attach('daemon-first-feed-semantic-audit', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });
      await attachSemanticAuditArtifacts(testInfo, { includeAuditReport: false });
      if (stack) {
        await attachRuntimeLogs(testInfo, browserLogs, stack);
      }

      const gate = assessDaemonFirstFeedSemanticAuditGate(report);
      const blockingReasons = [
        ...gate.blockingReasons,
        ...clusterCapture.gate.blockingReasons,
      ];
      expect(blockingReasons, JSON.stringify({
        posture: gate.posture,
        supply: report.supply,
        overall: report.overall,
        clusterCapture: clusterCapture.gate,
      }, null, 2)).toEqual([]);
      expect(gate.pass).toBe(true);
      expect(clusterCapture.gate.pass).toBe(true);
    } catch (error) {
      if (page) {
        await captureDaemonFirstFeedSemanticAuditSnapshots(page).catch(() => {});
      }
      await attachSemanticAuditArtifacts(testInfo);
      if (stack) {
        await attachRuntimeLogs(testInfo, browserLogs, stack);
      }
      throw error;
    } finally {
      await context?.close().catch(() => {});
      await stopDaemonFirstStack(stack);
    }
  });
});
