import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildProductionAppCanaryReport,
  parseProductionAppCanaryOptions,
  PRODUCTION_APP_CANARY_SCHEMA_VERSION,
  runProductionAppCanary,
} from './production-app-canary.mjs';

const nowMs = Date.parse('2026-05-08T18:00:00.000Z');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function meshReport(overrides = {}) {
  return {
    schema_version: 'mesh-production-readiness-v1',
    generated_at: '2026-05-08T17:55:00.000Z',
    run_id: 'mesh-production-readiness-test',
    repo: {
      commit: 'abc123',
      dirty: false,
    },
    status: 'review_required',
    schema_epoch: 'post_luma_m0b',
    luma_profile: 'none',
    release_readiness_blockers: [
      {
        id: 'canonical-30-minute-soak',
        command: 'VH_MESH_SOAK_DURATION_MS=1800000 pnpm test:mesh:soak',
        reason: 'latest soak evidence is shortened',
      },
    ],
    ...overrides,
  };
}

function git(args) {
  if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'coord/test';
  if (args.join(' ') === 'rev-parse HEAD') return 'abc123';
  if (args.join(' ') === 'status --short') return '';
  return '';
}

describe('production-app-canary', () => {
  it('defaults to the repo latest mesh report and supports CLI/env overrides', () => {
    expect(parseProductionAppCanaryOptions({
      argv: [],
      env: {},
      repoRoot: '/repo',
    }).meshReportPath).toBe('/repo/.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json');

    expect(parseProductionAppCanaryOptions({
      argv: [],
      env: { VH_PRODUCTION_APP_CANARY_MESH_REPORT: '.tmp/env-report.json' },
      repoRoot: '/repo',
    }).meshReportPath).toBe('/repo/.tmp/env-report.json');

    expect(parseProductionAppCanaryOptions({
      argv: ['--mesh-report', '.tmp/cli-report.json', '--expected-luma-profile=production-attestation'],
      env: { VH_PRODUCTION_APP_CANARY_MESH_REPORT: '.tmp/env-report.json' },
      repoRoot: '/repo',
    })).toMatchObject({
      meshReportPath: '/repo/.tmp/cli-report.json',
      expectedLumaProfile: 'production-attestation',
    });
  });

  it('blocks current review_required mesh evidence without faking an app canary pass', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const meshReportPath = path.join(repoRoot, '.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: ['--mesh-report', meshReportPath],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git,
    });

    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({
      schema_version: PRODUCTION_APP_CANARY_SCHEMA_VERSION,
      status: 'blocked',
      reason: 'mesh_not_release_ready',
      mesh_report: {
        loaded: true,
        run_id: 'mesh-production-readiness-test',
        status: 'review_required',
        source_commit: 'abc123',
      },
      luma_profile: {
        observed: 'none',
        expected: 'none',
        status: 'pass',
      },
      downstream_observation: {
        status: 'not_run',
        reason: 'prerequisites_blocked',
      },
    });
    expect(fs.existsSync(result.reportPath)).toBe(true);
    expect(fs.existsSync(result.latestReportPath)).toBe(true);
  });

  it('fails closed on LUMA profile mismatch before downstream observation', () => {
    const report = buildProductionAppCanaryReport({
      runId: 'production-app-canary-test',
      startedAtMs: nowMs,
      completedAtMs: nowMs,
      command: 'pnpm check:production-app-canary -- --expected-luma-profile production-attestation',
      repo: { branch: 'coord/test', commit: 'abc123', dirty: false },
      meshReportPath: '/repo/.tmp/mesh.json',
      meshReport: meshReport({ status: 'release_ready', release_readiness_blockers: [] }),
      expectedLumaProfile: 'production-attestation',
    });

    expect(report.status).toBe('blocked');
    expect(report.reason).toBe('luma_profile_mismatch');
    expect(report.luma_profile).toMatchObject({
      observed: 'none',
      expected: 'production-attestation',
      status: 'blocked',
    });
  });

  it('still refuses to pass release_ready mesh evidence until real downstream observation exists', () => {
    const report = buildProductionAppCanaryReport({
      runId: 'production-app-canary-test',
      startedAtMs: nowMs,
      completedAtMs: nowMs,
      command: 'pnpm check:production-app-canary',
      repo: { branch: 'coord/test', commit: 'abc123', dirty: false },
      meshReportPath: '/repo/.tmp/mesh.json',
      meshReport: meshReport({ status: 'release_ready', release_readiness_blockers: [] }),
    });

    expect(report.status).toBe('blocked');
    expect(report.reason).toBe('downstream_observation_not_implemented');
    expect(report.release_claims.forbidden).toContain('The production app canary passed.');
    expect(report.checks.find((check) => check.id === 'downstream_observation')).toMatchObject({
      status: 'blocked',
      reason: 'downstream_observation_not_implemented',
    });
  });

  it('fails closed on stale, dirty, and wrong-commit mesh reports', () => {
    const report = buildProductionAppCanaryReport({
      runId: 'production-app-canary-test',
      startedAtMs: nowMs,
      completedAtMs: nowMs,
      command: 'pnpm check:production-app-canary',
      repo: { branch: 'coord/test', commit: 'abc123', dirty: false },
      meshReportPath: '/repo/.tmp/mesh.json',
      meshReport: meshReport({
        generated_at: '2026-05-06T17:55:00.000Z',
        repo: {
          commit: 'def456',
          dirty: true,
        },
      }),
    });

    expect(report.reason).toBe('stale_mesh_report');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mesh_report_fresh', status: 'blocked', reason: 'stale_mesh_report' }),
      expect.objectContaining({ id: 'mesh_report_clean_repo', status: 'blocked', reason: 'mesh_report_dirty' }),
      expect.objectContaining({ id: 'mesh_report_current_commit', status: 'blocked', reason: 'mesh_report_wrong_commit' }),
    ]));
  });

  it('accepts a docs evidence packet generated at the immediate parent when the current diff is limited to that packet', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: ['--mesh-report', meshReportPath],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git: (args) => {
        const command = args.join(' ');
        if (command === 'rev-parse --abbrev-ref HEAD') return 'coord/test';
        if (command === 'rev-parse HEAD') return 'branch456';
        if (command === 'status --short') return '';
        if (command === 'rev-list --parents -n 1 branch456') return 'branch456 abc123';
        if (command === 'diff --name-only abc123 branch456') {
          return [
            `${packetRoot}/mesh-production-readiness-report.json`,
            `${packetRoot}/source-reports/soak/mesh-production-readiness-report.json`,
          ].join('\n');
        }
        return '';
      },
    });

    expect(result.report.reason).toBe('mesh_not_release_ready');
    expect(result.report.checks.find((check) => check.id === 'mesh_report_current_commit')).toMatchObject({
      status: 'pass',
      observed_commit: 'abc123',
      expected_commit: 'branch456',
      accepted_via: 'committed_evidence_packet_from_parent',
    });
  });

  it('does not accept a parent-generated docs packet when the current diff touches anything outside that packet', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: ['--mesh-report', meshReportPath],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git: (args) => {
        const command = args.join(' ');
        if (command === 'rev-parse --abbrev-ref HEAD') return 'coord/test';
        if (command === 'rev-parse HEAD') return 'branch456';
        if (command === 'status --short') return '';
        if (command === 'rev-list --parents -n 1 branch456') return 'branch456 abc123';
        if (command === 'diff --name-only abc123 branch456') {
          return [
            `${packetRoot}/mesh-production-readiness-report.json`,
            'apps/web-pwa/src/App.tsx',
          ].join('\n');
        }
        return '';
      },
    });

    expect(result.report.reason).toBe('mesh_report_wrong_commit');
    expect(result.report.checks.find((check) => check.id === 'mesh_report_current_commit')).toMatchObject({
      status: 'blocked',
      reason: 'mesh_report_wrong_commit',
      observed_commit: 'abc123',
      expected_commit: 'branch456',
      accepted_via: null,
    });
  });

  it('accepts a docs evidence packet generated before a merge commit when only that packet changed since the source commit', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: ['--mesh-report', meshReportPath],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git: (args) => {
        const command = args.join(' ');
        if (command === 'rev-parse --abbrev-ref HEAD') return 'main';
        if (command === 'rev-parse HEAD') return 'merge789';
        if (command === 'status --short') return '';
        if (command === 'rev-list --parents -n 1 merge789') return 'merge789 main123 branch456';
        if (command === 'merge-base abc123 merge789') return 'abc123';
        if (command === 'diff --name-only abc123 merge789') {
          return [
            `${packetRoot}/mesh-production-readiness-report.json`,
            `${packetRoot}/source-reports/soak/mesh-production-readiness-report.json`,
          ].join('\n');
        }
        return '';
      },
    });

    expect(result.report.reason).toBe('mesh_not_release_ready');
    expect(result.report.checks.find((check) => check.id === 'mesh_report_current_commit')).toMatchObject({
      status: 'pass',
      observed_commit: 'abc123',
      expected_commit: 'merge789',
      accepted_via: 'committed_evidence_packet_from_ancestor',
    });
  });

  it('accepts an ancestor docs evidence packet when intervening changes are limited to release-claim contract maintenance', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: ['--mesh-report', meshReportPath],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git: (args) => {
        const command = args.join(' ');
        if (command === 'rev-parse --abbrev-ref HEAD') return 'coord/mesh-release-claim-contract-v1';
        if (command === 'rev-parse HEAD') return 'claimcontract123';
        if (command === 'status --short') return '';
        if (command === 'rev-list --parents -n 1 claimcontract123') return 'claimcontract123 merge789';
        if (command === 'merge-base abc123 claimcontract123') return 'abc123';
        if (command === 'diff --name-only abc123 claimcontract123') {
          return [
            `${packetRoot}/mesh-production-readiness-report.json`,
            'packages/e2e/src/mesh/production-readiness-check.mjs',
            'packages/e2e/src/mesh/evidence-scrub-check.mjs',
            'packages/e2e/src/mesh/production-readiness-check.test.mjs',
            'docs/specs/spec-mesh-production-readiness.md',
          ].join('\n');
        }
        return '';
      },
    });

    expect(result.report.reason).toBe('mesh_not_release_ready');
    expect(result.report.checks.find((check) => check.id === 'mesh_report_current_commit')).toMatchObject({
      status: 'pass',
      observed_commit: 'abc123',
      expected_commit: 'claimcontract123',
      accepted_via: 'committed_evidence_packet_from_ancestor',
    });
  });

  it('accepts an ancestor docs evidence packet when intervening changes include the sample-floor contract helper', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: ['--mesh-report', meshReportPath],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git: (args) => {
        const command = args.join(' ');
        if (command === 'rev-parse --abbrev-ref HEAD') return 'coord/mesh-release-ready-refresh-after-luma-mvp';
        if (command === 'rev-parse HEAD') return 'samplefloors456';
        if (command === 'status --short') return '';
        if (command === 'rev-list --parents -n 1 samplefloors456') return 'samplefloors456 evidencecommit123';
        if (command === 'merge-base abc123 samplefloors456') return 'abc123';
        if (command === 'diff --name-only abc123 samplefloors456') {
          return [
            'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-previous/mesh-production-readiness-report.json',
            `${packetRoot}/mesh-production-readiness-report.json`,
            `${packetRoot}/source-reports/soak/mesh-production-readiness-report.json`,
            'packages/e2e/src/live/production-app-canary.mjs',
            'packages/e2e/src/live/production-app-canary.vitest.mjs',
            'packages/e2e/src/mesh/evidence-scrub-check.mjs',
            'packages/e2e/src/mesh/production-readiness-check.mjs',
            'packages/e2e/src/mesh/sample-floor-contract.mjs',
            'docs/specs/spec-mesh-production-readiness.md',
          ].join('\n');
        }
        return '';
      },
    });

    expect(result.report.reason).toBe('mesh_not_release_ready');
    expect(result.report.checks.find((check) => check.id === 'mesh_report_current_commit')).toMatchObject({
      status: 'pass',
      observed_commit: 'abc123',
      expected_commit: 'samplefloors456',
      accepted_via: 'committed_evidence_packet_from_ancestor',
    });
  });

  it('does not accept a docs evidence packet from an unrelated commit even when the diff is packet-only', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: ['--mesh-report', meshReportPath],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git: (args) => {
        const command = args.join(' ');
        if (command === 'rev-parse --abbrev-ref HEAD') return 'main';
        if (command === 'rev-parse HEAD') return 'merge789';
        if (command === 'status --short') return '';
        if (command === 'rev-list --parents -n 1 merge789') return 'merge789 main123 branch456';
        if (command === 'merge-base abc123 merge789') return 'older000';
        if (command === 'diff --name-only abc123 merge789') {
          return `${packetRoot}/mesh-production-readiness-report.json`;
        }
        return '';
      },
    });

    expect(result.report.reason).toBe('mesh_report_wrong_commit');
    expect(result.report.checks.find((check) => check.id === 'mesh_report_current_commit')).toMatchObject({
      status: 'blocked',
      reason: 'mesh_report_wrong_commit',
      observed_commit: 'abc123',
      expected_commit: 'merge789',
      accepted_via: null,
    });
  });
});
