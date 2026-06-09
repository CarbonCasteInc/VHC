#!/usr/bin/env node

import crypto from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../../..');
const DEFAULT_MESH_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRODUCTION_APP_URL = 'https://venn.carboncaste.io/';
const DEFAULT_PRODUCTION_APP_CANARY_READY_TIMEOUT_MS = 12 * 60_000;
const DEFAULT_PRODUCTION_APP_CANARY_ANALYSIS_TIMEOUT_MS = 120_000;

export const PRODUCTION_APP_CANARY_SCHEMA_VERSION = 'production-app-canary-report-v1';
export const PRODUCTION_APP_CANARY_MODE = 'production_app_canary_v1';

const REQUIRED_DOWNSTREAM_SURFACES = [
  'production_wss_relay_config',
  'app_preview_or_deploy_shape',
  'api_analyze',
  'news_synthesis_publication',
  'point_stance_write_readback',
  'story_thread_create_comment',
];

const FORBIDDEN_CLAIMS = [
  'The full app is test-group ready.',
  'The production app canary passed.',
  'The downstream app surfaces were observed end-to-end.',
  'LUMA profile gates passed through the production app canary.',
  'Mesh review_required evidence is sufficient for a full-app readiness claim.',
];

const PASS_ALLOWED_CLAIMS = [
  'The production app canary passed for the observed public deployment.',
  'The required downstream app surfaces were observed end-to-end for this canary run.',
];

const PASS_FORBIDDEN_CLAIMS = [
  'The full app is test-group ready.',
  'LUMA profile gates passed through the production app canary.',
  'Mesh review_required evidence is sufficient for a full-app readiness claim.',
  'The canary proves native App Store or TestFlight readiness.',
  'The canary proves legal, external, or commercial approval.',
];

function nowIso(date = new Date()) {
  return date.toISOString();
}

function nowIsoCompact(date = new Date()) {
  return nowIso(date).replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}

function makeId(prefix, randomBytes = crypto.randomBytes) {
  return `${prefix}-${nowIsoCompact()}-${randomBytes(4).toString('hex')}`;
}

function runGit(args, { repoRoot = defaultRepoRoot } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parsePeerList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((peer) => String(peer || '').trim()).filter(Boolean);
    }
  } catch {
    // Fall through to comma/whitespace parsing for operator shell input.
  }
  return raw
    .split(/[\s,]+/)
    .map((peer) => peer.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizeGunPeer(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/gun') ? trimmed : `${trimmed.replace(/\/+$/, '')}/gun`;
}

function redactedUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return String(value);
  }
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isPublicWssGunPeer(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'wss:' &&
      url.pathname.replace(/\/+$/, '') === '/gun' &&
      !['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function argValue(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === name) {
      return argv[index + 1] || '';
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

function resolveRepoPath(repoRoot, candidate) {
  if (!candidate) return candidate;
  return path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
}

function repoRelativePath(repoRoot, filePath) {
  const relativePath = path.relative(repoRoot, filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  return relativePath.split(path.sep).join('/');
}

function committedEvidencePacketRoot(repoRoot, meshReportPath) {
  const relativePath = repoRelativePath(repoRoot, meshReportPath);
  if (!relativePath) return null;
  const marker = '/mesh-production-readiness-report.json';
  if (!relativePath.endsWith(marker)) return null;
  const packetRoot = relativePath.slice(0, -marker.length);
  return packetRoot.startsWith('docs/reports/evidence/mesh-production/') ? packetRoot : null;
}

function committedEvidenceFamilyRoot(packetRoot) {
  const familyRoot = path.posix.dirname(packetRoot);
  return familyRoot && familyRoot !== '.' ? familyRoot : packetRoot;
}

function lines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseProductionAppCanaryOptions({
  argv = [],
  env = process.env,
  repoRoot = defaultRepoRoot,
} = {}) {
  const fallbackMeshReportPath = path.join(repoRoot, '.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json');
  const meshReportCandidate =
    argValue(argv, '--mesh-report') ||
    env.VH_PRODUCTION_APP_CANARY_MESH_REPORT ||
    fallbackMeshReportPath;
  const expectedLumaProfile =
    argValue(argv, '--expected-luma-profile') ||
    env.VH_PRODUCTION_APP_CANARY_LUMA_PROFILE ||
    null;
  const appUrlCandidate =
    argValue(argv, '--app-url') ||
    env.VH_PRODUCTION_APP_CANARY_APP_URL ||
    env.VH_MESH_PUBLIC_APP_URL ||
    DEFAULT_PRODUCTION_APP_URL;
  const publicWssPeers = parsePeerList(
    argValue(argv, '--public-wss-peers') ||
      env.VH_PRODUCTION_APP_CANARY_PUBLIC_WSS_PEERS ||
      env.VH_MESH_PUBLIC_WSS_PEERS ||
      '',
  ).map(normalizeGunPeer);
  const gunPeerCandidate =
    argValue(argv, '--gun-peer-url') ||
    env.VH_PRODUCTION_APP_CANARY_GUN_PEER_URL ||
    env.VH_PUBLIC_FEED_GUN_PEER_URL ||
    publicWssPeers[0] ||
    '';

  return {
    meshReportPath: resolveRepoPath(repoRoot, meshReportCandidate),
    expectedLumaProfile,
    appUrl: normalizeUrl(appUrlCandidate),
    gunPeerUrl: normalizeGunPeer(gunPeerCandidate),
    publicWssPeers,
    readyTimeoutMs: parsePositiveInteger(
      env.VH_PRODUCTION_APP_CANARY_READY_TIMEOUT_MS || env.VH_PUBLIC_FEED_SMOKE_READY_TIMEOUT_MS,
      DEFAULT_PRODUCTION_APP_CANARY_READY_TIMEOUT_MS,
    ),
    analysisTimeoutMs: parsePositiveInteger(
      env.VH_PRODUCTION_APP_CANARY_ANALYSIS_TIMEOUT_MS || env.VH_PUBLIC_FEED_SMOKE_ANALYSIS_TIMEOUT_MS,
      DEFAULT_PRODUCTION_APP_CANARY_ANALYSIS_TIMEOUT_MS,
    ),
    maxMeshReportAgeMs: parsePositiveInteger(
      env.VH_PRODUCTION_APP_CANARY_MAX_MESH_REPORT_AGE_MS,
      DEFAULT_MESH_REPORT_MAX_AGE_MS,
    ),
    forceIpv4: boolEnv(
      env.VH_PRODUCTION_APP_CANARY_FORCE_IPV4 || env.VH_PUBLIC_FEED_SMOKE_FORCE_IPV4,
      false,
    ),
  };
}

function meshReportBlockers(meshReport) {
  return Array.isArray(meshReport?.release_readiness_blockers)
    ? meshReport.release_readiness_blockers.map((blocker) => ({
        id: blocker.id || 'unknown',
        command: blocker.command || null,
        reason: blocker.reason || null,
      }))
    : [];
}

function checkStatus(condition, blockedReason = null) {
  return condition
    ? { status: 'pass' }
    : { status: 'blocked', reason: blockedReason };
}

function downstreamCheckStatus(prerequisiteFailures, downstreamObservation) {
  if (prerequisiteFailures.length > 0) {
    return {
      status: 'blocked',
      reason: 'prerequisites_blocked',
      required_surfaces: REQUIRED_DOWNSTREAM_SURFACES,
    };
  }
  if (!downstreamObservation) {
    return {
      status: 'blocked',
      reason: 'downstream_observation_missing',
      required_surfaces: REQUIRED_DOWNSTREAM_SURFACES,
    };
  }
  return {
    status: downstreamObservation.status === 'pass' ? 'pass' : 'blocked',
    reason: downstreamObservation.status === 'pass'
      ? undefined
      : downstreamObservation.reason || 'downstream_observation_failed',
    required_surfaces: REQUIRED_DOWNSTREAM_SURFACES,
    observed_surfaces: Object.entries(downstreamObservation.surfaces || {})
      .filter(([, surface]) => surface?.status === 'pass')
      .map(([surfaceId]) => surfaceId),
    artifact_dir: downstreamObservation.artifact_dir || null,
    summary_path: downstreamObservation.summary_path || null,
    failures: downstreamObservation.failures || [],
  };
}

const COMMITTED_EVIDENCE_PACKET_COMPATIBILITY_PATHS = new Set([
  'docs/specs/spec-mesh-production-readiness.md',
  'packages/e2e/src/live/production-app-canary.mjs',
  'packages/e2e/src/live/production-app-canary.vitest.mjs',
  'packages/e2e/src/luma/mvp-production-readiness.mjs',
  'packages/e2e/src/luma/mvp-production-readiness.vitest.mjs',
  'packages/e2e/src/mesh/evidence-scrub-check.mjs',
  'packages/e2e/src/mesh/evidence-scrub-check.test.mjs',
  'packages/e2e/src/mesh/production-readiness-check.mjs',
  'packages/e2e/src/mesh/production-readiness-check.test.mjs',
  'packages/e2e/src/mesh/sample-floor-contract.mjs',
]);

function compatibleCommittedEvidenceInterveningPath(changedPath, packetRoot) {
  const familyRoot = committedEvidenceFamilyRoot(packetRoot);
  return (
    changedPath === packetRoot ||
    changedPath.startsWith(`${packetRoot}/`) ||
    changedPath === familyRoot ||
    changedPath.startsWith(`${familyRoot}/`) ||
    COMMITTED_EVIDENCE_PACKET_COMPATIBILITY_PATHS.has(changedPath)
  );
}

function evaluateMeshReportCommit({
  meshReport,
  meshReportPath,
  currentCommit,
  repoRoot = defaultRepoRoot,
  git = runGit,
} = {}) {
  const observedCommit = meshReport?.repo?.commit || null;
  if (!observedCommit || !currentCommit) {
    return {
      ok: false,
      expected_commit: currentCommit || null,
      observed_commit: observedCommit,
      accepted_via: null,
    };
  }
  if (observedCommit === currentCommit) {
    return {
      ok: true,
      expected_commit: currentCommit,
      observed_commit: observedCommit,
      accepted_via: 'current_commit',
    };
  }

  const packetRoot = committedEvidencePacketRoot(repoRoot, meshReportPath);
  if (!packetRoot) {
    return {
      ok: false,
      expected_commit: currentCommit,
      observed_commit: observedCommit,
      accepted_via: null,
    };
  }

  const parentCommits = lines(git(['rev-list', '--parents', '-n', '1', currentCommit], { repoRoot }))
    .flatMap((line) => line.split(/\s+/).slice(1));
  const sourceIsDirectParent = parentCommits.includes(observedCommit);
  const mergeBase = lines(git(['merge-base', observedCommit, currentCommit], { repoRoot }))[0] || null;
  const sourceIsAncestor = sourceIsDirectParent || mergeBase === observedCommit;
  const changedPaths = lines(git(['diff', '--name-only', observedCommit, currentCommit], { repoRoot }));
  const diffLimitedToCommittedEvidence =
    changedPaths.length > 0 &&
    changedPaths.every((changedPath) => compatibleCommittedEvidenceInterveningPath(changedPath, packetRoot));

  if (sourceIsAncestor && diffLimitedToCommittedEvidence) {
    return {
      ok: true,
      expected_commit: currentCommit,
      observed_commit: observedCommit,
      accepted_via: sourceIsDirectParent
        ? 'committed_evidence_packet_from_parent'
        : 'committed_evidence_packet_from_ancestor',
      packet_root: packetRoot,
    };
  }

  return {
    ok: false,
    expected_commit: currentCommit,
    observed_commit: observedCommit,
    accepted_via: null,
    packet_root: packetRoot,
  };
}

function buildChecks({
  meshReport,
  meshReadError,
  currentCommit,
  meshReportCommitStatus,
  expectedLumaProfile,
  maxMeshReportAgeMs,
  nowMs,
  downstreamObservation = null,
}) {
  const checks = [];
  const meshReportLoaded = Boolean(meshReport) && !meshReadError;
  const generatedAtMs = meshReportLoaded ? Date.parse(meshReport.generated_at || '') : NaN;
  const observedLumaProfile = meshReport?.luma_profile || null;
  const expectedProfile = expectedLumaProfile || observedLumaProfile;

  checks.push({
    id: 'mesh_report_present',
    ...checkStatus(meshReportLoaded, meshReadError?.reason || 'missing_mesh_report'),
  });

  checks.push({
    id: 'mesh_report_fresh',
    ...checkStatus(
      meshReportLoaded &&
        Number.isFinite(generatedAtMs) &&
        nowMs >= generatedAtMs &&
        nowMs - generatedAtMs <= maxMeshReportAgeMs,
      meshReportLoaded && Number.isFinite(generatedAtMs) ? 'stale_mesh_report' : 'malformed_mesh_report',
    ),
    max_age_ms: maxMeshReportAgeMs,
    generated_at: meshReport?.generated_at || null,
  });

  checks.push({
    id: 'mesh_report_clean_repo',
    ...checkStatus(meshReportLoaded && meshReport.repo?.dirty === false, 'mesh_report_dirty'),
  });

  checks.push({
    id: 'mesh_report_current_commit',
    ...checkStatus(meshReportLoaded && meshReportCommitStatus?.ok, 'mesh_report_wrong_commit'),
    expected_commit: meshReportCommitStatus?.expected_commit || currentCommit || null,
    observed_commit: meshReportCommitStatus?.observed_commit || meshReport?.repo?.commit || null,
    accepted_via: meshReportCommitStatus?.accepted_via || null,
  });

  checks.push({
    id: 'luma_profile_match',
    ...checkStatus(!expectedProfile || observedLumaProfile === expectedProfile, 'luma_profile_mismatch'),
    expected_luma_profile: expectedProfile || null,
    observed_luma_profile: observedLumaProfile,
  });

  checks.push({
    id: 'mesh_release_ready',
    ...checkStatus(meshReportLoaded && meshReport.status === 'release_ready', 'mesh_not_release_ready'),
    observed_status: meshReport?.status || null,
    blockers: meshReportBlockers(meshReport),
  });

  const prerequisiteFailures = checks.filter((check) => check.status !== 'pass');
  checks.push({
    id: 'downstream_observation',
    ...downstreamCheckStatus(prerequisiteFailures, downstreamObservation),
  });

  return checks;
}

function primaryReason(checks) {
  return checks.find((check) => check.status !== 'pass' && check.reason !== 'prerequisites_blocked')?.reason || 'blocked';
}

export function buildProductionAppCanaryReport({
  runId,
  startedAtMs,
  completedAtMs,
  command,
  repo,
  meshReportPath,
  meshReport,
  meshReadError = null,
  meshReportCommitStatus = null,
  expectedLumaProfile = null,
  maxMeshReportAgeMs = DEFAULT_MESH_REPORT_MAX_AGE_MS,
  downstreamObservation = null,
  appUrl = DEFAULT_PRODUCTION_APP_URL,
  gunPeerUrl = '',
  publicWssPeers = [],
} = {}) {
  const checks = buildChecks({
    meshReport,
    meshReadError,
    currentCommit: repo?.commit,
    meshReportCommitStatus: meshReportCommitStatus || {
      ok: Boolean(meshReport?.repo?.commit && repo?.commit && meshReport.repo.commit === repo.commit),
      expected_commit: repo?.commit || null,
      observed_commit: meshReport?.repo?.commit || null,
      accepted_via: meshReport?.repo?.commit && repo?.commit && meshReport.repo.commit === repo.commit ? 'current_commit' : null,
    },
    expectedLumaProfile,
    maxMeshReportAgeMs,
    nowMs: completedAtMs,
    downstreamObservation,
  });
  const reason = primaryReason(checks);
  const status = checks.every((check) => check.status === 'pass') ? 'pass' : 'blocked';
  const observedLumaProfile = meshReport?.luma_profile || null;
  const expectedProfile = expectedLumaProfile || observedLumaProfile;

  return {
    schema_version: PRODUCTION_APP_CANARY_SCHEMA_VERSION,
    generated_at: new Date(completedAtMs).toISOString(),
    run_id: runId,
    repo: {
      branch: repo?.branch || null,
      commit: repo?.commit || null,
      base_ref: 'origin/main',
      dirty: Boolean(repo?.dirty),
    },
    run: {
      mode: PRODUCTION_APP_CANARY_MODE,
      started_at: new Date(startedAtMs).toISOString(),
      completed_at: new Date(completedAtMs).toISOString(),
      duration_ms: completedAtMs - startedAtMs,
      command,
    },
    status,
    reason: status === 'pass' ? 'all_required_surfaces_observed' : reason,
    mesh_report: {
      path: meshReportPath,
      loaded: Boolean(meshReport) && !meshReadError,
      read_error: meshReadError,
      schema_version: meshReport?.schema_version || null,
      run_id: meshReport?.run_id || null,
      generated_at: meshReport?.generated_at || null,
      status: meshReport?.status || null,
      source_commit: meshReport?.repo?.commit || null,
      source_dirty: meshReport?.repo?.dirty ?? null,
      blockers: meshReportBlockers(meshReport),
    },
    luma_profile: {
      observed: observedLumaProfile,
      expected: expectedProfile || null,
      status: expectedProfile && observedLumaProfile !== expectedProfile ? 'blocked' : 'pass',
    },
    checks,
    downstream_observation: downstreamObservation || {
      status: 'not_run',
      reason: reason === 'downstream_observation_missing' ? reason : 'prerequisites_blocked',
      required_surfaces: REQUIRED_DOWNSTREAM_SURFACES,
      app_url: redactedUrl(appUrl),
      gun_peer_url: redactedUrl(gunPeerUrl),
      public_wss_peers: publicWssPeers.map(redactedUrl),
    },
    release_claims: {
      allowed: status === 'pass' ? PASS_ALLOWED_CLAIMS : [],
      forbidden: status === 'pass' ? PASS_FORBIDDEN_CLAIMS : FORBIDDEN_CLAIMS,
    },
  };
}

function surfacePass(evidence = {}) {
  return { status: 'pass', evidence };
}

function surfaceFail(reason, evidence = {}) {
  return { status: 'fail', reason, evidence };
}

function responseHeader(response, name) {
  return typeof response.headers?.get === 'function' ? response.headers.get(name) : null;
}

async function fetchWithTimeout(fetchImpl, url, { timeoutMs, accept } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: accept ? { accept } : undefined,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseText(response) {
  if (typeof response.text === 'function') return response.text();
  return '';
}

async function readResponseJson(response) {
  if (typeof response.json === 'function') return response.json();
  const text = await readResponseText(response);
  return text ? JSON.parse(text) : null;
}

function publicWssRelayConfigSurface({ meshReport, options }) {
  const configuredPeers = options?.publicWssPeers || [];
  const peers = configuredPeers.length > 0
    ? options.publicWssPeers
    : (options.gunPeerUrl ? [options.gunPeerUrl] : []);
  const publicPeers = peers.filter(isPublicWssGunPeer);
  const configuredPeerCount = meshReport?.topology?.configured_peer_count || publicPeers.length;
  const minimumPeerCount = Math.max(3, configuredPeerCount || 0);
  const quorumRequired = meshReport?.topology?.quorum_required || 2;
  const deploymentScope =
    meshReport?.topology?.deployment_scope ||
    meshReport?.public_wss_deployment_proof?.deployment_scope ||
    meshReport?.public_wss_proof?.deployment_scope ||
    null;
  const proofStatus =
    meshReport?.public_wss_deployment_proof?.public_wss_proof_status ||
    meshReport?.public_wss_deployment_proof?.status ||
    meshReport?.public_wss_proof?.status ||
    null;
  const meshPublicReady =
    meshReport?.status === 'release_ready' &&
    (deploymentScope === 'public_wss_deployment' || proofStatus === 'pass');
  const peerCountReady = publicPeers.length >= minimumPeerCount;

  if (!meshPublicReady || !peerCountReady) {
    return surfaceFail('production_wss_relay_config_not_observed', {
      mesh_status: meshReport?.status || null,
      deployment_scope: deploymentScope,
      public_wss_proof_status: proofStatus,
      configured_peer_count: configuredPeerCount,
      observed_public_peer_count: publicPeers.length,
      minimum_peer_count: minimumPeerCount,
      quorum_required: quorumRequired,
      peers: peers.map(redactedUrl),
    });
  }

  return surfacePass({
    mesh_status: meshReport.status,
    deployment_scope: deploymentScope,
    public_wss_proof_status: proofStatus || 'implied_by_release_ready',
    configured_peer_count: configuredPeerCount,
    observed_public_peer_count: publicPeers.length,
    minimum_peer_count: minimumPeerCount,
    quorum_required: quorumRequired,
    peers: publicPeers.map(redactedUrl),
  });
}

async function appPreviewSurface({ appUrl, fetchImpl, timeoutMs }) {
  if (!isPublicHttpsUrl(appUrl)) {
    return surfaceFail('production_app_url_not_public_https', { app_url: redactedUrl(appUrl) });
  }
  try {
    const response = await fetchWithTimeout(fetchImpl, appUrl, {
      timeoutMs,
      accept: 'text/html,application/xhtml+xml',
    });
    const text = await readResponseText(response);
    const contentType = responseHeader(response, 'content-type') || '';
    const htmlLooksBootable =
      /<html[\s>]/i.test(text) &&
      (/<script[\s>]/i.test(text) || /id=["']root["']/i.test(text) || /id=["']app["']/i.test(text));
    if (!response.ok || !htmlLooksBootable) {
      return surfaceFail('production_app_boot_html_not_observed', {
        app_url: redactedUrl(appUrl),
        status: response.status || null,
        content_type: contentType,
        html_bytes: text.length,
      });
    }
    return surfacePass({
      app_url: redactedUrl(appUrl),
      status: response.status,
      content_type: contentType,
      html_bytes: text.length,
    });
  } catch (error) {
    return surfaceFail('production_app_fetch_failed', {
      app_url: redactedUrl(appUrl),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function apiAnalyzeSurface({ appUrl, fetchImpl, timeoutMs }) {
  const healthUrl = new URL('/api/analyze/health', appUrl).href;
  try {
    const response = await fetchWithTimeout(fetchImpl, healthUrl, {
      timeoutMs,
      accept: 'application/json',
    });
    const payload = await readResponseJson(response).catch((error) => ({
      parse_error: error instanceof Error ? error.message : String(error),
    }));
    if (!response.ok || payload?.ok !== true) {
      return surfaceFail('api_analyze_health_not_ok', {
        url: redactedUrl(healthUrl),
        status: response.status || null,
        payload,
      });
    }
    return surfacePass({
      url: redactedUrl(healthUrl),
      status: response.status,
      model: payload.model || null,
      upstream: payload.upstream || null,
    });
  } catch (error) {
    return surfaceFail('api_analyze_health_fetch_failed', {
      url: redactedUrl(healthUrl),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function surfaceFromSmoke(summary, surfaceId, checkId, mapper = (value) => value) {
  const evidence = summary?.checks?.[checkId] || null;
  if (!evidence) {
    return [
      surfaceId,
      surfaceFail(`${surfaceId}_not_observed`, {
        smoke_status: summary?.status || null,
        check_id: checkId,
      }),
    ];
  }
  return [surfaceId, surfacePass(mapper(evidence))];
}

export async function observeProductionAppDownstream({
  repoRoot = defaultRepoRoot,
  env = process.env,
  options,
  meshReport,
  artifactDir,
  fetchImpl = globalThis.fetch,
  runPublicFeedBrowserSmokeImpl = null,
} = {}) {
  const appUrl = options?.appUrl || DEFAULT_PRODUCTION_APP_URL;
  const gunPeerUrl = options?.gunPeerUrl || options?.publicWssPeers?.[0] || '';
  const surfaces = {
    production_wss_relay_config: publicWssRelayConfigSurface({ meshReport, options }),
  };

  if (typeof fetchImpl !== 'function') {
    surfaces.app_preview_or_deploy_shape = surfaceFail('fetch_unavailable');
    surfaces.api_analyze = surfaceFail('fetch_unavailable');
  } else {
    surfaces.app_preview_or_deploy_shape = await appPreviewSurface({
      appUrl,
      fetchImpl,
      timeoutMs: Math.min(30_000, options?.readyTimeoutMs || 30_000),
    });
    surfaces.api_analyze = await apiAnalyzeSurface({
      appUrl,
      fetchImpl,
      timeoutMs: Math.min(30_000, options?.readyTimeoutMs || 30_000),
    });
  }

  let smokeSummary = null;
  const smokeArtifactDir = path.join(artifactDir, 'public-feed-browser-smoke');
  try {
    if (!isPublicWssGunPeer(gunPeerUrl)) {
      throw new Error('production_gun_peer_not_public_wss');
    }
    const smokeImpl = runPublicFeedBrowserSmokeImpl ||
      (await import('./public-feed-browser-smoke.mjs')).runPublicFeedBrowserSmoke;
    smokeSummary = await smokeImpl({
      repoRoot,
      env: {
        ...env,
        VH_PUBLIC_FEED_APP_URL: appUrl,
        VH_PUBLIC_FEED_GUN_PEER_URL: gunPeerUrl,
        VH_PUBLIC_FEED_SMOKE_ARTIFACT_DIR: smokeArtifactDir,
        VH_PUBLIC_FEED_SMOKE_READY_TIMEOUT_MS: String(options?.readyTimeoutMs || DEFAULT_PRODUCTION_APP_CANARY_READY_TIMEOUT_MS),
        VH_PUBLIC_FEED_SMOKE_ANALYSIS_TIMEOUT_MS: String(options?.analysisTimeoutMs || DEFAULT_PRODUCTION_APP_CANARY_ANALYSIS_TIMEOUT_MS),
      },
    });
    Object.assign(surfaces, Object.fromEntries([
      surfaceFromSmoke(
        smokeSummary,
        'news_synthesis_publication',
        'acceptedAnalysisSynthesisVisible',
        (evidence) => ({
          summary_preview: String(evidence.summaryText || '').slice(0, 240),
          vote_button_count: evidence.voteButtonCount || 0,
          basis: evidence.basis || null,
          provenance_preview: String(evidence.provenance || '').slice(0, 240),
        }),
      ),
      surfaceFromSmoke(
        smokeSummary,
        'point_stance_write_readback',
        'pointStanceWriteReadback',
        (evidence) => ({
          point_id: evidence.pointId || null,
          canonical_point_id: evidence.canonicalPointId || null,
          before_agree: evidence.beforeAgree ?? null,
          after_agree: evidence.afterAgree ?? null,
        }),
      ),
      surfaceFromSmoke(
        smokeSummary,
        'story_thread_create_comment',
        'storyThreadCreateComment',
        (evidence) => ({
          section_id: evidence.sectionId || null,
          created_thread: evidence.createdThread ?? null,
          count_text: evidence.countText || null,
        }),
      ),
    ]));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    for (const surfaceId of [
      'news_synthesis_publication',
      'point_stance_write_readback',
      'story_thread_create_comment',
    ]) {
      surfaces[surfaceId] = surfaceFail('public_feed_browser_smoke_failed', {
        error: reason,
        artifact_dir: smokeArtifactDir,
      });
    }
  }

  const failures = Object.entries(surfaces)
    .filter(([, surface]) => surface?.status !== 'pass')
    .map(([surfaceId, surface]) => ({
      surface: surfaceId,
      reason: surface?.reason || 'surface_failed',
    }));
  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    reason: failures.length === 0 ? null : 'downstream_observation_failed',
    required_surfaces: REQUIRED_DOWNSTREAM_SURFACES,
    app_url: redactedUrl(appUrl),
    gun_peer_url: redactedUrl(gunPeerUrl),
    public_wss_peers: (options?.publicWssPeers || []).map(redactedUrl),
    artifact_dir: artifactDir,
    summary_path: smokeSummary?.artifactPaths?.summaryPath || path.join(smokeArtifactDir, 'public-feed-browser-smoke-summary.json'),
    surfaces,
    failures,
  };
}

function readMeshReport(meshReportPath) {
  if (!fs.existsSync(meshReportPath)) {
    return {
      meshReport: null,
      meshReadError: {
        reason: 'missing_mesh_report',
        detail: `mesh readiness report does not exist at ${meshReportPath}`,
      },
    };
  }

  try {
    return {
      meshReport: readJson(meshReportPath),
      meshReadError: null,
    };
  } catch (error) {
    return {
      meshReport: null,
      meshReadError: {
        reason: 'malformed_mesh_report',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function commandText(argv) {
  return ['pnpm', 'check:production-app-canary', ...argv].join(' ');
}

export async function runProductionAppCanary({
  argv = [],
  env = process.env,
  repoRoot = defaultRepoRoot,
  outputRoot = path.join(repoRoot, '.tmp/production-app-canary'),
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  git = runGit,
  downstreamObserver = observeProductionAppDownstream,
  fetchImpl = globalThis.fetch,
  runPublicFeedBrowserSmokeImpl = null,
} = {}) {
  const startedAtMs = now();
  const runId = makeId('production-app-canary', randomBytes);
  const options = parseProductionAppCanaryOptions({ argv, env, repoRoot });
  if (options.forceIpv4) {
    setDefaultResultOrder('ipv4first');
  }
  const { meshReport, meshReadError } = readMeshReport(options.meshReportPath);
  const repo = {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], { repoRoot }),
    commit: git(['rev-parse', 'HEAD'], { repoRoot }),
    dirty: git(['status', '--short'], { repoRoot }).length > 0,
  };
  const artifactDir = path.join(outputRoot, runId);
  const reportPath = path.join(artifactDir, 'production-app-canary-report.json');
  const latestDir = path.join(outputRoot, 'latest');
  const latestReportPath = path.join(latestDir, 'production-app-canary-report.json');
  const meshReportCommitStatus = evaluateMeshReportCommit({
    meshReport,
    meshReportPath: options.meshReportPath,
    currentCommit: repo.commit,
    repoRoot,
    git,
  });
  const preliminaryChecks = buildChecks({
    meshReport,
    meshReadError,
    currentCommit: repo.commit,
    meshReportCommitStatus,
    expectedLumaProfile: options.expectedLumaProfile,
    maxMeshReportAgeMs: options.maxMeshReportAgeMs,
    nowMs: now(),
  });
  const prerequisitesPassed = preliminaryChecks
    .filter((check) => check.id !== 'downstream_observation')
    .every((check) => check.status === 'pass');
  const downstreamObservation = prerequisitesPassed
    ? await downstreamObserver({
        repoRoot,
        env,
        options,
        meshReport,
        artifactDir: path.join(artifactDir, 'downstream-observation'),
        fetchImpl,
        runPublicFeedBrowserSmokeImpl,
      })
    : null;
  const completedAtMs = now();
  const report = buildProductionAppCanaryReport({
    runId,
    startedAtMs,
    completedAtMs,
    command: commandText(argv),
    repo,
    meshReportPath: options.meshReportPath,
    meshReport,
    meshReadError,
    meshReportCommitStatus,
    expectedLumaProfile: options.expectedLumaProfile,
    maxMeshReportAgeMs: options.maxMeshReportAgeMs,
    downstreamObservation,
    appUrl: options.appUrl,
    gunPeerUrl: options.gunPeerUrl,
    publicWssPeers: options.publicWssPeers,
  });

  writeJson(reportPath, report);
  fs.rmSync(latestDir, { recursive: true, force: true });
  writeJson(latestReportPath, report);

  return {
    report,
    reportPath,
    latestReportPath,
    exitCode: report.status === 'pass' ? 0 : 1,
  };
}

if (process.argv[1] === __filename) {
  const result = await runProductionAppCanary({ argv: process.argv.slice(2) });
  console.log(`[vh:production-app-canary] report: ${path.relative(defaultRepoRoot, result.reportPath)}`);
  console.log(`[vh:production-app-canary] latest: ${path.relative(defaultRepoRoot, result.latestReportPath)}`);
  if (result.exitCode !== 0) {
    console.error(`[vh:production-app-canary] blocked: ${result.report.reason}`);
  }
  process.exit(result.exitCode);
}
