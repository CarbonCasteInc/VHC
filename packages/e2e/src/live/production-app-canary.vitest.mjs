import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildProductionAppCanaryReport,
  observeProductionAppDownstream,
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

function releaseReadyMeshReport(overrides = {}) {
  return meshReport({
    status: 'release_ready',
    release_readiness_blockers: [],
    topology: {
      deployment_scope: 'public_wss_deployment',
      configured_peer_count: 3,
      quorum_required: 2,
    },
    public_wss_proof: { status: 'pass' },
    ...overrides,
  });
}

function passDownstreamObservation(overrides = {}) {
  return {
    status: 'pass',
    required_surfaces: [
      'production_wss_relay_config',
      'app_preview_or_deploy_shape',
      'api_analyze',
      'news_synthesis_publication',
      'point_stance_write_readback',
      'story_thread_create_comment',
    ],
    app_url: 'https://venn.example/',
    gun_peer_url: 'wss://gun-a.example/gun',
    public_wss_peers: [
      'wss://gun-a.example/gun',
      'wss://gun-b.example/gun',
      'wss://gun-c.example/gun',
    ],
    artifact_dir: '/repo/.tmp/production-app-canary/run/downstream-observation',
    summary_path: '/repo/.tmp/production-app-canary/run/downstream-observation/public-feed-browser-smoke/public-feed-browser-smoke-summary.json',
    surfaces: {
      production_wss_relay_config: { status: 'pass' },
      app_preview_or_deploy_shape: { status: 'pass' },
      api_analyze: { status: 'pass' },
      news_synthesis_publication: { status: 'pass' },
      point_stance_write_readback: { status: 'pass' },
      story_thread_create_comment: { status: 'pass' },
    },
    failures: [],
    ...overrides,
  };
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
      appUrl: 'https://venn.carboncaste.io/',
    });

    expect(parseProductionAppCanaryOptions({
      argv: ['--app-url', 'https://venn.example', '--public-wss-peers', '["wss://gun-a.example/gun","wss://gun-b.example/gun"]'],
      env: {},
      repoRoot: '/repo',
    })).toMatchObject({
      appUrl: 'https://venn.example/',
      gunPeerUrl: 'wss://gun-a.example/gun',
      publicWssPeers: ['wss://gun-a.example/gun', 'wss://gun-b.example/gun'],
    });
  });

  it('blocks current review_required mesh evidence without faking an app canary pass', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const meshReportPath = path.join(repoRoot, '.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());
    let observerCalled = false;

    const result = await runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: ['--mesh-report', meshReportPath],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git,
      downstreamObserver: async () => {
        observerCalled = true;
        return passDownstreamObservation();
      },
    });

    expect(result.exitCode).toBe(1);
    expect(observerCalled).toBe(false);
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

  it('fails closed on release_ready mesh evidence when downstream observation is missing', () => {
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
    expect(report.reason).toBe('downstream_observation_missing');
    expect(report.release_claims.forbidden).toContain('The production app canary passed.');
    expect(report.checks.find((check) => check.id === 'downstream_observation')).toMatchObject({
      status: 'blocked',
      reason: 'downstream_observation_missing',
    });
  });

  it('passes only when every required downstream surface is observed', () => {
    const downstreamObservation = passDownstreamObservation();
    const report = buildProductionAppCanaryReport({
      runId: 'production-app-canary-test',
      startedAtMs: nowMs,
      completedAtMs: nowMs,
      command: 'pnpm check:production-app-canary',
      repo: { branch: 'coord/test', commit: 'abc123', dirty: false },
      meshReportPath: '/repo/.tmp/mesh.json',
      meshReport: releaseReadyMeshReport(),
      downstreamObservation,
    });

    expect(report.status).toBe('pass');
    expect(report.reason).toBe('all_required_surfaces_observed');
    expect(report.release_claims.allowed).toContain('The production app canary passed for the observed public deployment.');
    expect(report.release_claims.forbidden).not.toContain('The production app canary passed.');
    expect(report.checks.find((check) => check.id === 'downstream_observation')).toMatchObject({
      status: 'pass',
      observed_surfaces: downstreamObservation.required_surfaces,
    });
  });

  it('observes production app surfaces through public HTTPS, API health, and browser smoke evidence', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/api/analyze/health')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ ok: true, model: 'gpt-5-nano', upstream: 'reachable' }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>',
      };
    };

    const result = await observeProductionAppDownstream({
      repoRoot: '/repo',
      env: {},
      options: {
        appUrl: 'https://venn.example/',
        gunPeerUrl: 'wss://gun-a.example/gun',
        publicWssPeers: [
          'wss://gun-a.example/gun',
          'wss://gun-b.example/gun',
          'wss://gun-c.example/gun',
        ],
        readyTimeoutMs: 1_000,
        analysisTimeoutMs: 2_000,
      },
      meshReport: releaseReadyMeshReport(),
      artifactDir: '/repo/.tmp/production-app-canary/run/downstream-observation',
      fetchImpl,
      runPublicFeedBrowserSmokeImpl: async ({ env }) => ({
        status: 'pass',
        artifactPaths: {
          summaryPath: path.join(env.VH_PUBLIC_FEED_SMOKE_ARTIFACT_DIR, 'public-feed-browser-smoke-summary.json'),
        },
        checks: {
          acceptedAnalysisSynthesisVisible: {
            summaryText: 'A sourced public beta synthesis is visible.',
            voteButtonCount: 2,
            basis: '2 sources',
            provenance: 'observed in browser smoke',
          },
          pointStanceWriteReadback: {
            pointId: 'point-1',
            canonicalPointId: 'canonical-point-1',
            beforeAgree: 0,
            afterAgree: 1,
          },
          storyThreadCreateComment: {
            sectionId: 'news-card-topic-1',
            createdThread: true,
            countText: '1 comment',
          },
        },
      }),
    });

    expect(result.status).toBe('pass');
    expect(Object.keys(result.surfaces).sort()).toEqual([
      'api_analyze',
      'app_preview_or_deploy_shape',
      'news_synthesis_publication',
      'point_stance_write_readback',
      'production_wss_relay_config',
      'story_thread_create_comment',
    ]);
    expect(result.surfaces.api_analyze).toMatchObject({
      status: 'pass',
      evidence: { model: 'gpt-5-nano', upstream: 'reachable' },
    });
  });

  it('runs downstream observation for release_ready mesh evidence and writes a passing report', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const meshReportPath = path.join(repoRoot, '.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json');
    writeJson(meshReportPath, releaseReadyMeshReport());
    let observedAppUrl = null;

    const result = await runProductionAppCanary({
      repoRoot,
      outputRoot: path.join(repoRoot, '.tmp/production-app-canary'),
      argv: [
        '--mesh-report',
        meshReportPath,
        '--app-url',
        'https://venn.example',
        '--public-wss-peers',
        '["wss://gun-a.example/gun","wss://gun-b.example/gun","wss://gun-c.example/gun"]',
      ],
      env: {},
      now: () => nowMs,
      randomBytes: () => Buffer.from('00112233', 'hex'),
      git,
      downstreamObserver: async ({ options }) => {
        observedAppUrl = options.appUrl;
        return passDownstreamObservation();
      },
    });

    expect(observedAppUrl).toBe('https://venn.example/');
    expect(result.exitCode).toBe(0);
    expect(result.report.status).toBe('pass');
    expect(fs.existsSync(result.reportPath)).toBe(true);
  });

  it('maps downstream observation failures to a blocked canary report', () => {
    const report = buildProductionAppCanaryReport({
      runId: 'production-app-canary-test',
      startedAtMs: nowMs,
      completedAtMs: nowMs,
      command: 'pnpm check:production-app-canary',
      repo: { branch: 'coord/test', commit: 'abc123', dirty: false },
      meshReportPath: '/repo/.tmp/mesh.json',
      meshReport: releaseReadyMeshReport(),
      downstreamObservation: passDownstreamObservation({
        status: 'fail',
        reason: 'downstream_observation_failed',
        surfaces: {
          ...passDownstreamObservation().surfaces,
          api_analyze: { status: 'fail', reason: 'api_analyze_health_not_ok' },
        },
        failures: [{ surface: 'api_analyze', reason: 'api_analyze_health_not_ok' }],
      }),
    });

    expect(report.status).toBe('blocked');
    expect(report.reason).toBe('downstream_observation_failed');
    expect(report.checks.find((check) => check.id === 'downstream_observation')).toMatchObject({
      status: 'blocked',
      reason: 'downstream_observation_failed',
      failures: [{ surface: 'api_analyze', reason: 'api_analyze_health_not_ok' }],
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

  it('accepts a docs evidence packet generated at the immediate parent when the current diff is limited to that packet', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = await runProductionAppCanary({
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

  it('does not accept a parent-generated docs packet when the current diff touches anything outside that packet', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = await runProductionAppCanary({
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

  it('accepts a docs evidence packet generated before a merge commit when only that packet changed since the source commit', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = await runProductionAppCanary({
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

  it('accepts an ancestor docs evidence packet when intervening changes are limited to release-claim contract maintenance', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = await runProductionAppCanary({
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

  it('accepts an ancestor docs evidence packet when intervening changes include the sample-floor contract helper', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = await runProductionAppCanary({
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
            'packages/e2e/src/luma/mvp-production-readiness.mjs',
            'packages/e2e/src/luma/mvp-production-readiness.vitest.mjs',
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

  it('does not accept a docs evidence packet from an unrelated commit even when the diff is packet-only', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-production-app-canary-'));
    const packetRoot = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/mesh-production-readiness-test';
    const meshReportPath = path.join(repoRoot, packetRoot, 'mesh-production-readiness-report.json');
    writeJson(meshReportPath, meshReport());

    const result = await runProductionAppCanary({
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
