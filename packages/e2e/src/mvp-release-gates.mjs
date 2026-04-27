import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPORT_SCHEMA_VERSION = 'mvp-release-gates-report-v1';
export const VALID_STATUSES = ['pass', 'fail', 'setup_scarcity', 'skipped_not_in_scope'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const latestDir = path.join(repoRoot, '.tmp/mvp-release-gates/latest');
const latestReportPath = path.join(latestDir, 'mvp-release-gates-report.json');

const GATES = [
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
  if (
    text.includes('blocked_setup_scarcity') ||
    text.includes('setup_scarcity') ||
    text.includes('vote-capable-preflight-failed') ||
    text.includes('feed_stage_outage') ||
    text.includes('source health') && text.includes('insufficient')
  ) {
    return 'setup_scarcity';
  }
  return 'fail';
}

function runCommand(command, options = {}) {
  const echo = options.echo ?? true;
  const [bin, args] = command;
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: repoRoot,
      env: { ...process.env, CI: process.env.CI ?? 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
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
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.stack ?? error.message}` });
    });
    child.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
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
    const result = await runGate(gate);
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
