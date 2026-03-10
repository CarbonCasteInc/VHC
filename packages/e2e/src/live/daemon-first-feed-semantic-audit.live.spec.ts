import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { expect, test, type BrowserContext } from '@playwright/test';
import {
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
import { runDaemonFirstFeedSemanticAudit } from './daemonFirstFeedSemanticAudit';

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

function requireOpenAIApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  if (!apiKey) {
    throw new Error('blocked-setup-openai-api-key-missing');
  }
  return apiKey;
}

function semanticAuditArtifactDir(): string | null {
  const runId = process.env.VH_DAEMON_FEED_RUN_ID?.trim();
  if (!runId) {
    return null;
  }
  return path.resolve(process.cwd(), '../../.tmp/e2e-daemon-feed', runId);
}

async function attachSemanticAuditArtifacts(
  testInfo: {
    attach: (name: string, options: { body: string; contentType: string }) => Promise<void>;
  },
): Promise<void> {
  const artifactDir = semanticAuditArtifactDir();
  if (!artifactDir) {
    return;
  }

  const attachments = [
    {
      name: 'daemon-first-feed-semantic-audit',
      fileName: 'semantic-audit-report.json',
    },
    {
      name: 'daemon-first-feed-semantic-audit-failure-snapshot',
      fileName: 'semantic-audit-store-snapshot.json',
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
    test.setTimeout(12 * 60_000);

    let stack: DaemonFirstStack | null = null;
    let context: BrowserContext | null = null;
    const browserLogs: string[] = [];

    try {
      stack = await startDaemonFirstStack();
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      await addConsumerInitScript(context);

      const page = await context.newPage();
      page.on('console', (message) => browserLogs.push(logText(message)));

      await page.goto(LIVE_BASE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      await waitForHeadlines(page);

      const report = await runDaemonFirstFeedSemanticAudit(page, {
        openAIApiKey: requireOpenAIApiKey(),
        openAIModel: process.env.VH_STORYCLUSTER_AUDIT_MODEL?.trim() || undefined,
        sampleCount: readPositiveIntEnv('VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT'),
        timeoutMs: readPositiveIntEnv('VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS'),
      });

      await testInfo.attach('daemon-first-feed-semantic-audit', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });

      expect(report.sampled_story_count).toBeGreaterThanOrEqual(1);
      expect(report.overall.audited_pair_count).toBeGreaterThan(0);
      expect(report.overall.related_topic_only_pair_count).toBe(0);
      expect(report.overall.pass).toBe(true);
    } catch (error) {
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
