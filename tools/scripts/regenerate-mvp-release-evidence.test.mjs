import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RELEASE_EVIDENCE_STEPS,
  runReleaseEvidencePipeline,
} from './regenerate-mvp-release-evidence.mjs';

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function stepPath(id) {
  const step = RELEASE_EVIDENCE_STEPS.find((entry) => entry.id === id);
  assert.ok(step, `missing step ${id}`);
  return step.reportPath;
}

function cleanRepoState(commit = 'abc1234567890') {
  return {
    branch: 'main',
    commit,
    dirty: false,
  };
}

function fakeCloseout(root, status = 'pass', failures = []) {
  return async () => {
    const report = {
      schema_version: 'mvp-closeout-report-v1',
      repo: cleanRepoState(),
      status,
      failures,
    };
    writeJson(root, '.tmp/mvp-closeout/latest/mvp-closeout-report.json', report);
    return report;
  };
}

function fakeSuccessfulSpawn(root, calls) {
  return (bin, args) => {
    const command = [bin, ...args].join(' ');
    calls.push(command);
    if (command === 'pnpm check:news-sources:health') {
      writeJson(root, stepPath('source_health'), {
        schemaVersion: 'news-source-health-report-v1',
        repo: cleanRepoState(),
        readinessStatus: 'ready',
        releaseEvidence: { status: 'pass' },
      });
      return { status: 0, signal: null };
    }
    if (command === 'pnpm check:luma:mvp-production-readiness') {
      writeJson(root, stepPath('luma_mvp'), {
        schema_version: 'luma-mvp-production-readiness-v1',
        repo: cleanRepoState(),
        status: 'pass',
      });
      return { status: 0, signal: null };
    }
    if (command === 'pnpm check:mesh:production-readiness') {
      writeJson(root, stepPath('mesh'), {
        schema_version: 'mesh-production-readiness-v1',
        repo: cleanRepoState(),
        status: 'review_required',
        release_readiness_blockers: [{ id: 'public-wss-deployment-proof' }],
      });
      return { status: 1, signal: null };
    }
    if (command === 'pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json') {
      writeJson(root, stepPath('production_app_canary'), {
        schema_version: 'production-app-canary-report-v1',
        repo: cleanRepoState(),
        status: 'blocked',
        reason: 'mesh_not_release_ready',
      });
      return { status: 1, signal: null };
    }
    if (command === 'pnpm check:mvp-release-gates') {
      writeJson(root, stepPath('mvp_release_gates'), {
        schema_version: 'mvp-release-gates-report-v1',
        repo: cleanRepoState(),
        overallStatus: 'pass',
        gates: [
          { id: 'source_health', status: 'pass' },
          { id: 'public_beta_launch_closeout', status: 'pass' },
        ],
      });
      return { status: 0, signal: null };
    }
    throw new Error(`unexpected command: ${command}`);
  };
}

test('release evidence pipeline regenerates closeout inputs and accepts boundary nonzero exits', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-release-evidence-pipeline-'));
  const calls = [];
  let tick = 1000;
  try {
    const result = await runReleaseEvidencePipeline(
      { repoRoot: root, check: true, env: {} },
      {
        spawnSyncImpl: fakeSuccessfulSpawn(root, calls),
        currentRepoStateImpl: () => cleanRepoState(),
        runMvpCloseoutImpl: fakeCloseout(root, 'pass'),
        nowMs: () => {
          tick += 1;
          return tick;
        },
      },
    );

    assert.equal(result.report.status, 'pass');
    assert.equal(result.report.release_commit_verified, true);
    assert.deepEqual(calls, [
      'pnpm check:news-sources:health',
      'pnpm check:luma:mvp-production-readiness',
      'pnpm check:mesh:production-readiness',
      'pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json',
      'pnpm check:mvp-release-gates',
    ]);
    const mesh = result.report.commands.find((command) => command.id === 'mesh');
    const canary = result.report.commands.find((command) => command.id === 'production_app_canary');
    assert.equal(mesh.accepted_boundary_exit, true);
    assert.equal(canary.accepted_boundary_exit, true);
    assert.equal(canary.report.reason, 'mesh_not_release_ready');

    const persisted = readJson(result.latestReportPath);
    assert.equal(persisted.schema_version, 'vh-mvp-release-evidence-pipeline-v1');
    assert.equal(persisted.status, 'pass');
    for (const command of persisted.commands) {
      assert.equal(Object.hasOwn(command, 'stdout'), false);
      assert.equal(Object.hasOwn(command, 'stderr'), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release evidence pipeline refuses dirty release commit by default', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-release-evidence-dirty-'));
  const calls = [];
  try {
    const result = await runReleaseEvidencePipeline(
      { repoRoot: root, check: true, env: {} },
      {
        spawnSyncImpl: (...args) => {
          calls.push(args);
          return { status: 0, signal: null };
        },
        currentRepoStateImpl: () => ({ ...cleanRepoState(), dirty: true }),
        runMvpCloseoutImpl: fakeCloseout(root, 'pass'),
        nowMs: () => 2000,
      },
    );

    assert.equal(result.report.status, 'blocked');
    assert.deepEqual(result.report.commands, []);
    assert.deepEqual(calls, []);
    assert.deepEqual(result.report.blockers, ['repo_dirty_before_release_evidence_regeneration']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release evidence pipeline records missing required report after command failure', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-release-evidence-fail-'));
  try {
    const result = await runReleaseEvidencePipeline(
      { repoRoot: root, check: true, env: {}, allowDirty: true },
      {
        spawnSyncImpl: (bin, args) => {
          const command = [bin, ...args].join(' ');
          if (command === 'pnpm check:news-sources:health') return { status: 1, signal: null };
          return fakeSuccessfulSpawn(root, [])(bin, args);
        },
        currentRepoStateImpl: () => cleanRepoState(),
        runMvpCloseoutImpl: fakeCloseout(root, 'blocked', ['missing source health report']),
        nowMs: () => 3000,
      },
    );

    assert.equal(result.report.status, 'blocked');
    assert.ok(result.report.blockers.includes('source_health_command_exit_1'));
    assert.ok(result.report.blockers.includes('source_health_report_missing:services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json'));
    assert.ok(result.report.blockers.includes('mvp_closeout_status_blocked'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
