import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPORT_SCHEMA_VERSION = 'mvp-release-gates-report-v1';
export const VALID_STATUSES = ['pass', 'fail', 'setup_scarcity', 'skipped_not_in_scope'];
export const DEFAULT_GATE_TIMEOUT_MS = 12 * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const latestDir = path.join(repoRoot, '.tmp/mvp-release-gates/latest');
const latestReportPath = path.join(latestDir, 'mvp-release-gates-report.json');
export const PUBLIC_FEED_RELEASE_ENV = [
  'VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io',
  'VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun',
  'VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS=["https://venn.carboncaste.io","https://gun-a.carboncaste.io","https://gun-b.carboncaste.io","https://gun-c.carboncaste.io"]',
  'VH_PUBLIC_FEED_PUBLIC_WSS_PEERS=["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]',
];

function withPublicFeedReleaseEnv(command, extraEnv = []) {
  const [bin, args] = command;
  return ['env', [...PUBLIC_FEED_RELEASE_ENV, ...extraEnv, bin, ...args]];
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function killProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

export const GATES = [
  {
    id: 'source_health',
    label: 'Source health',
    command: ['pnpm', ['check:news-sources:health']],
    artifactRefs: [
      'services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json',
      'services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json',
    ],
  },
  {
    id: 'story_correctness',
    label: 'StoryCluster correctness',
    command: ['pnpm', ['check:storycluster:correctness']],
    artifactRefs: ['.tmp/storycluster-production-readiness/latest/correctness-gate-status.json'],
  },
  {
    id: 'feed_render',
    label: 'Fixture-backed feed render and preference ranking/filtering',
    command: [
      'pnpm',
      ['exec', 'vitest', 'run', 'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx', '-t', 'mvp gate: feed render'],
    ],
    artifactRefs: ['apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx'],
  },
  {
    id: 'story_detail',
    label: 'Headline detail opens from accepted TopicSynthesisV2',
    command: [
      'pnpm',
      ['exec', 'vitest', 'run', 'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx', '-t', 'mvp gate: story detail'],
    ],
    artifactRefs: ['apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx'],
  },
  {
    id: 'public_feed_analysis_frame_reliability',
    label: 'Public feed latest-index, accepted synthesis, and frame-table reliability',
    command: withPublicFeedReleaseEnv(['pnpm', ['test:public-feed:browser-smoke']]),
    artifactRefs: [
      'packages/e2e/src/live/public-feed-browser-smoke.mjs',
      '.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json',
      '.tmp/analysis-frame-pipeline',
    ],
  },
  {
    id: 'public_feed_composition_freshness',
    label: 'Public feed composition and freshness',
    command: withPublicFeedReleaseEnv(['pnpm', ['check:public-feed:composition-freshness']]),
    artifactRefs: [
      'packages/e2e/src/live/public-feed-composition-freshness-gate.mjs',
      '.tmp/release-evidence/public-feed-composition-freshness/latest/public-feed-composition-freshness-summary.json',
    ],
  },
  {
    id: 'public_feed_lifecycle_accountability',
    label: 'Raw story, product feed, and synthesis lifecycle accountability',
    command: withPublicFeedReleaseEnv(['pnpm', ['check:public-feed:lifecycle-accountability']]),
    artifactRefs: [
      'packages/e2e/src/live/public-feed-lifecycle-accountability.mjs',
      '.tmp/release-evidence/public-feed-lifecycle-accountability/latest/public-feed-lifecycle-accountability-summary.json',
    ],
  },
  {
    id: 'public_feed_fresh_propagation',
    label: 'Fresh RSS item propagation through daemon, StoryCluster, product feed, relay, and PWA refresh',
    command: withPublicFeedReleaseEnv(
      ['pnpm', ['check:public-feed:fresh-propagation']],
      ['VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_PUBLIC_BROWSER_SMOKE=true'],
    ),
    artifactRefs: [
      'packages/e2e/src/live/public-feed-fresh-propagation-gate.mjs',
      '.tmp/release-evidence/public-feed-fresh-propagation/latest/public-feed-fresh-propagation-summary.json',
      '.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json',
      '.tmp/daemon-feed-publisher-canary',
      '.tmp/daemon-feed-consumer-smoke',
    ],
  },
  {
    id: 'story_identity_growth',
    label: 'Story identity remains stable when singleton stories gain corroborating sources',
    command: [
      'pnpm',
      [
        '--filter',
        '@vh/storycluster-engine',
        'exec',
        'vitest',
        'run',
        'src/remoteContract.test.ts',
        'src/storyclusterBatchReplayIdentityDrift.test.ts',
        '--config',
        './vitest.config.ts',
      ],
    ],
    artifactRefs: [
      'services/storycluster-engine/src/remoteContract.test.ts',
      'services/storycluster-engine/src/storyclusterBatchReplayIdentityDrift.test.ts',
    ],
  },
  {
    id: 'public_feed_pagination_refresh',
    label: 'Public feed refresh and load-more pagination from mesh',
    command: withPublicFeedReleaseEnv(['pnpm', ['test:public-feed:browser-smoke']]),
    reusePreviousCommandResult: true,
    artifactRefs: [
      'packages/e2e/src/live/public-feed-browser-smoke.mjs',
      '.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json',
      'apps/web-pwa/src/components/feed/FeedShell.lazyLoading.test.tsx',
    ],
  },
  {
    id: 'stance_aggregate_decay_public_mesh',
    label: 'Stance persistence, public aggregate snapshots, and capped decay math',
    command: withPublicFeedReleaseEnv(['pnpm', ['check:public-feed:stance-aggregate-decay']]),
    artifactRefs: [
      'apps/web-pwa/src/components/feed/voteSemantics.ts',
      'apps/web-pwa/src/hooks/useSentimentState.ts',
      'packages/gun-client/src/aggregateAdapters.ts',
      'packages/gun-client/src/topicEngagementAdapters.ts',
      '.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json',
    ],
  },
  {
    id: 'synthesis_correction',
    label: 'Operator correction hides bad accepted synthesis with audit provenance',
    command: [
      'pnpm',
      ['exec', 'vitest', 'run', 'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx', '-t', 'mvp gate: synthesis correction'],
    ],
    artifactRefs: [
      'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx',
      'apps/web-pwa/src/store/synthesis/index.ts',
      'packages/data-model/src/schemas/hermes/synthesis.ts',
      'packages/gun-client/src/synthesisAdapters.ts',
    ],
  },
  {
    id: 'point_stance',
    label: 'Frame/reframe point stance persists and restores',
    command: [
      'pnpm',
      ['exec', 'vitest', 'run', 'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx', '-t', 'mvp gate: point stance'],
    ],
    artifactRefs: ['apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx'],
  },
  {
    id: 'story_thread',
    label: 'Story-thread replies stay attached to deterministic story id',
    command: [
      'pnpm',
      ['exec', 'vitest', 'run', 'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx', '-t', 'mvp gate: story thread'],
    ],
    artifactRefs: [
      'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx',
      'apps/web-pwa/src/utils/feedDiscussionThreads.ts',
    ],
  },
  {
    id: 'story_thread_moderation',
    label: 'Story-thread moderation hides abusive replies with audit provenance',
    command: [
      'pnpm',
      ['exec', 'vitest', 'run', 'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx', '-t', 'mvp gate: story thread moderation'],
    ],
    artifactRefs: [
      'apps/web-pwa/src/components/feed/MvpNewsLoop.release.test.tsx',
      'apps/web-pwa/src/components/hermes/CommentStream.tsx',
      'apps/web-pwa/src/store/forum/index.ts',
      'packages/data-model/src/schemas/hermes/forum.ts',
      'packages/gun-client/src/forumAdapters.ts',
    ],
  },
  {
    id: 'launch_content_snapshot',
    label: 'Curated launch-content snapshot validates representative MVP fallback content',
    command: ['pnpm', ['check:launch-content-snapshot']],
    artifactRefs: [
      'packages/e2e/fixtures/launch-content/validated-snapshot.json',
      '.tmp/launch-content-snapshot/latest/launch-content-snapshot-report.json',
      'apps/web-pwa/src/store/newsSnapshotBootstrap.launchContent.test.tsx',
    ],
  },
  {
    id: 'report_intake_admin_action',
    label: 'Report intake queue routes bad synthesis and thread reports to audited operator actions',
    command: [
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        'apps/web-pwa/src/components/admin/NewsReportAdminQueue.test.tsx',
        '-t',
        'mvp gate: report intake admin action',
      ],
    ],
    artifactRefs: [
      'apps/web-pwa/src/components/admin/NewsReportAdminQueue.test.tsx',
      'apps/web-pwa/src/store/newsReports.ts',
      'packages/data-model/src/schemas/hermes/newsReport.ts',
      'packages/gun-client/src/newsReportAdapters.ts',
    ],
  },
  {
    id: 'operator_trust_gate',
    label: 'Trusted beta operator authorization gates report remediation writes',
    command: [
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        'apps/web-pwa/src/store/newsReports.test.ts',
        'apps/web-pwa/src/components/admin/NewsReportAdminQueue.test.tsx',
        '-t',
        'mvp gate: operator trust gate',
      ],
    ],
    artifactRefs: [
      'packages/data-model/src/schemas/hermes/operatorTrust.ts',
      'apps/web-pwa/src/store/operatorTrust.ts',
      'apps/web-pwa/src/store/newsReports.ts',
      'apps/web-pwa/src/components/admin/NewsReportAdminQueue.tsx',
      'packages/gun-client/src/newsReportAdapters.ts',
      'packages/gun-client/src/synthesisAdapters.ts',
      'packages/gun-client/src/forumAdapters.ts',
    ],
  },
  {
    id: 'public_beta_compliance',
    label: 'Public beta policy routes and release checklist match implemented scope',
    command: ['pnpm', ['check:public-beta-compliance']],
    artifactRefs: [
      'apps/web-pwa/src/routes/publicBetaCompliance.tsx',
      'docs/ops/public-beta-compliance-minimums.md',
      'tools/scripts/check-public-beta-compliance.mjs',
    ],
  },
  {
    id: 'luma_forbidden_claims',
    label: 'LUMA forbidden-claims registry holds over app copy (spec §20)',
    command: ['pnpm', ['check:luma-forbidden-claims']],
    artifactRefs: [
      'tools/scripts/check-luma-forbidden-claims.mjs',
      'docs/specs/spec-luma-service-v0.md',
    ],
  },
  {
    id: 'luma_production_profile',
    label: 'LUMA profile guards keep dev fallback, mocks, and DEV-stub URLs out of deployable profiles',
    command: ['pnpm', ['check:luma-production-profile']],
    artifactRefs: [
      'tools/scripts/check-luma-production-profile.mjs',
      'apps/web-pwa/src/hooks/useIdentity.ts',
      'packages/luma-sdk/src/providers/index.ts',
    ],
  },
  {
    id: 'luma_telemetry_redaction',
    label: 'LUMA telemetry §16 source discipline holds; §21.4 replay remains deferred before <TrustClaim>',
    command: ['pnpm', ['check:luma-telemetry-redaction']],
    artifactRefs: [
      'tools/scripts/check-luma-telemetry-redaction.mjs',
      'packages/luma-sdk/src/telemetry.ts',
      'packages/luma-sdk/src/telemetry.test.ts',
      'docs/specs/spec-luma-service-v0.md',
    ],
  },
  {
    id: 'luma_mvp_production_readiness',
    label: 'LUMA public-beta MVP readiness has current signed-write and mesh evidence',
    command: ['pnpm', ['check:luma:mvp-production-readiness']],
    artifactRefs: [
      '.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json',
      '.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json',
      '.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json',
      'packages/e2e/src/luma/mvp-production-readiness.mjs',
    ],
  },
  {
    id: 'public_beta_launch_closeout',
    label: 'Public beta launch closeout maps launch gates to deterministic evidence',
    command: ['pnpm', ['check:public-beta-launch-closeout']],
    artifactRefs: [
      'docs/ops/public-beta-launch-readiness-closeout.md',
      'tools/scripts/check-public-beta-launch-closeout.mjs',
      'docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md',
      'docs/foundational/STATUS.md',
    ],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandToString(command) {
  const [bin, args] = command;
  return [bin, ...args].map(shellQuote).join(' ');
}

export function classifyGateFailure(output) {
  const text = String(output ?? '').toLowerCase();
  if (text.includes('mvp-release-gate-command-timeout')) {
    return 'fail';
  }
  if (
    text.includes('eligible_raw_story_hidden_without_allowed_reason') ||
    text.includes('multi_source_raw_story_hidden_by_synthesis_state') ||
    text.includes('product_feed_hot_index_missing_for_visible_story') ||
    text.includes('hot_index_product_metadata_missing') ||
    text.includes('product_visible_synthesis_lifecycle_pending_stale') ||
    text.includes('public-feed-initial-open-headlines-timeout') ||
    text.includes('public-feed-load-more-not-from-mesh') ||
    text.includes('public-feed-browser-csp-violations') ||
    text.includes('scroll-feed-lost-headlines') ||
    text.includes('public-relay-latest-index-missing-composition') ||
    text.includes('public-relay-latest-index-missing-story-states') ||
    text.includes('public-relay-latest-index-product-metadata-missing') ||
    text.includes('public-relay-current-accepted-synthesis-missing') ||
    text.includes('public-relay-peer-readback-not-configured') ||
    text.includes('public-relay-peer-readback-failed') ||
    text.includes('public-relay-feed-composition-backfill-only-multi-source') ||
    text.includes('public-relay-feed-stale') ||
    text.includes('fresh-propagation-fixture-only') ||
    text.includes('fresh-propagation-public-browser-smoke-missing') ||
    text.includes('fresh-propagation-public-browser-smoke-not-passing') ||
    text.includes('fresh-propagation-public-relay-latest-empty') ||
    text.includes('fresh-propagation-public-relay-story-body-empty') ||
    text.includes('fresh-propagation-public-browser-initial-empty') ||
    text.includes('fresh-propagation-public-browser-refresh-empty') ||
    text.includes('fresh-propagation-public-relay-pagination-failed') ||
    text.includes('fresh-propagation-consumer-not-browser') ||
    text.includes('fresh-propagation-consumer-fixture-mismatch') ||
    text.includes('fresh-propagation-consumer-summary-mismatch') ||
    text.includes('fresh-propagation-latest-activity-stale') ||
    text.includes('fail:public-relay-feed-composition-missing-multi-source') ||
    text.includes('fail:fresh-propagation') ||
    text.includes('source-labels-missing') ||
    text.includes('timestamps-missing')
  ) {
    return 'fail';
  }
  if (
    text.includes('blocked_setup_scarcity') ||
    text.includes('setup_scarcity') ||
    text.includes('fresh-propagation-feed-stage-outage') ||
    text.includes('publisher-not-passing:feed_stage_outage') ||
    text.includes('vote-capable-preflight-failed') ||
    text.includes('feed_stage_outage') ||
    text.includes('public-relay-feed-composition-missing-multi-source') ||
    text.includes('public_feed_composition_missing_multi_source') ||
    text.includes('missing_multi_source') ||
    text.includes('source health') && text.includes('insufficient')
  ) {
    return 'setup_scarcity';
  }
  return 'fail';
}

function runCommand(command, options = {}) {
  const echo = options.echo ?? true;
  const timeoutMs = options.timeoutMs ?? parsePositiveInteger(process.env.VH_MVP_RELEASE_GATE_TIMEOUT_MS, DEFAULT_GATE_TIMEOUT_MS);
  const [bin, args] = command;
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: repoRoot,
      env: { ...process.env, CI: process.env.CI ?? 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      const message = `[mvp-release-gate-command-timeout] command timed out after ${timeoutMs}ms\n`;
      stderr += message;
      if (echo) {
        process.stderr.write(message);
      }
      killProcessTree(child);
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (echo) {
        process.stdout.write(text);
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (echo) {
        process.stderr.write(text);
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.stack ?? error.message}`, timedOut });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? 124 : (exitCode ?? 1), stdout, stderr, timedOut });
    });
  });
}

async function gitValue(args) {
  const result = await runCommand(['git', args], { echo: false });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function runGate(gate) {
  const startedAt = nowIso();
  const started = Date.now();
  const commandText = commandToString(gate.command);
  console.info(`[mvp-release-gates] ${gate.id}: ${commandText}`);
  const result = await runCommand(gate.command);
  const endedAt = nowIso();
  const output = `${result.stdout}\n${result.stderr}`;
  const status = result.exitCode === 0 ? 'pass' : classifyGateFailure(output);
  const summary =
    status === 'pass'
      ? `${gate.label} passed.`
      : output.split('\n').filter(Boolean).slice(-8).join('\n');

  return {
    id: gate.id,
    label: gate.label,
    status,
    command: commandText,
    startedAt,
    endedAt,
    durationMs: Date.now() - started,
    exitCode: result.exitCode,
    artifactRefs: gate.artifactRefs,
    failureClassification: status === 'pass' ? null : status,
    summary,
  };
}

export function findReusableGateResult(gate, completedGates) {
  if (!gate.reusePreviousCommandResult) {
    return null;
  }
  const commandText = commandToString(gate.command);
  return completedGates.find((completedGate) => completedGate.command === commandText) ?? null;
}

export function buildReusedGateResult(gate, previousResult) {
  const timestamp = nowIso();
  return {
    id: gate.id,
    label: gate.label,
    status: previousResult.status,
    command: commandToString(gate.command),
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    exitCode: previousResult.exitCode,
    artifactRefs: gate.artifactRefs,
    failureClassification: previousResult.failureClassification,
    reusedFromGateId: previousResult.id,
    summary:
      previousResult.status === 'pass'
        ? `${gate.label} passed using the ${previousResult.id} browser-smoke evidence packet.`
        : `${gate.label} failed using the ${previousResult.id} browser-smoke evidence packet: ${previousResult.summary}`,
  };
}

async function writeReport(report) {
  await rm(latestDir, { recursive: true, force: true });
  await mkdir(latestDir, { recursive: true });
  await writeFile(latestReportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function runMvpReleaseGates() {
  const startedAt = nowIso();
  const branch = await gitValue(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = await gitValue(['rev-parse', 'HEAD']);
  const gates = [];
  for (const gate of GATES) {
    const reusableResult = findReusableGateResult(gate, gates);
    const result = reusableResult ? buildReusedGateResult(gate, reusableResult) : await runGate(gate);
    if (reusableResult) {
      console.info(`[mvp-release-gates] ${gate.id}: reused ${reusableResult.id} result`);
    }
    gates.push(result);
  }

  const failing = gates.filter((gate) => gate.status !== 'pass' && gate.status !== 'skipped_not_in_scope');
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: nowIso(),
    startedAt,
    endedAt: nowIso(),
    reportPath: latestReportPath,
    repo: {
      root: repoRoot,
      branch,
      commit,
    },
    statuses: VALID_STATUSES,
    overallStatus: failing.length === 0 ? 'pass' : failing.some((gate) => gate.status === 'fail') ? 'fail' : 'setup_scarcity',
    gates,
  };

  await writeReport(report);
  console.info(`[mvp-release-gates] wrote ${latestReportPath}`);
  return report;
}

if (process.argv[1] === __filename) {
  runMvpReleaseGates()
    .then((report) => {
      if (report.overallStatus !== 'pass') {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error('[mvp-release-gates] fatal:', error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    });
}
