import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

export const INCIDENT_SCHEMA_VERSION = 'vhc-incident-v1';
export const OPERATOR_PACKET_SCHEMA_VERSION = 'vhc-operator-packet-v1';
export const REVIEW_VERDICT_SCHEMA_VERSION = 'vhc-review-verdict-v1';

export const REQUIRED_INCIDENT_LABELS = Object.freeze([
  'incident',
  'a6',
  'public-feed',
  'severity:critical',
  'severity:warning',
  'needs-codex-triage',
  'codex-investigating',
  'reviewer:fable',
  'reviewer:sol',
  'same-provider-review',
  'needs-more-evidence',
  'operator-action-needed',
  'waiting-for-readback',
  'resolved',
  'automation-paused',
]);

export const FORBIDDEN_ACTION_IDS = Object.freeze([
  'retention',
  'compaction',
  'eviction',
  'publisher_clear',
  'quorum_reduction',
  'fail_close_weakening',
  'raw_heap_export',
  'mesh_production_write',
]);

export const TRUST_PHASE_ACTIONS = Object.freeze({
  1: new Set([
    'read_only_a6_collector',
    'enable_alert_watch_timers',
    'run_heap_analyzer',
  ]),
  2: new Set([
    'read_only_a6_collector',
    'enable_alert_watch_timers',
    'run_heap_analyzer',
    'restart_publisher_exit69_only',
  ]),
  3: new Set([
    'read_only_a6_collector',
    'enable_alert_watch_timers',
    'run_heap_analyzer',
    'restart_publisher_exit69_only',
    'deploy_named_merged_commit',
  ]),
});

const URL_PATTERN = /https?:\/\/[^\s"'<>)}\]]+/gi;
const TOKENISH_PATTERN = /\b(?:ghp|github_pat|sk|xox[baprs]|anthropic|vhp)_[A-Za-z0-9_=-]{8,}\b/g;
const RAW_HEAP_PATTERN = /[^\s"'<>]*\.heap(?:snapshot|profile)[^\s"'<>]*/gi;

export function sha256Hex(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  return createHash('sha256').update(input).digest('hex');
}

export function redactSecretText(value) {
  return String(value ?? '')
    .replace(URL_PATTERN, (url) => `url_hash:${sha256Hex(url).slice(0, 16)}`)
    .replace(TOKENISH_PATTERN, (token) => `token_hash:${sha256Hex(token).slice(0, 16)}`)
    .replace(RAW_HEAP_PATTERN, (heapPath) => `heap_artifact_hash:${sha256Hex(heapPath).slice(0, 16)}`);
}

export function normalizeAlertClassFamily(alertClass) {
  const text = String(alertClass ?? '').trim();
  if (!text) return 'unknown';
  if (text.startsWith('exit_69')) return 'exit_69';
  if (text.startsWith('exit_75')) return 'exit_75';
  if (text.startsWith('exit_78')) return 'exit_78';
  if (text.includes('freshness')) return 'freshness';
  if (text.includes('relay_liveness')) return 'relay_liveness';
  if (text.includes('watch_closure')) return 'watch_closure';
  return text.replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
}

export function incidentKey({ source = 'public-feed', alertClass, alertClassFamily } = {}) {
  const normalizedSource = String(source || 'public-feed').replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
  return `a6:${normalizedSource}:${normalizeAlertClassFamily(alertClassFamily ?? alertClass)}`;
}

export function allowlistFromEnv(value) {
  return String(value ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowlistedLogin(login, allowlist) {
  const normalized = String(login ?? '').trim().toLowerCase();
  return Boolean(normalized) && new Set(allowlist.map((entry) => entry.toLowerCase())).has(normalized);
}

export function isUneditedComment(comment) {
  return Boolean(comment?.created_at && comment?.updated_at && comment.created_at === comment.updated_at);
}

export function parseVhcCommand(body) {
  const line = String(body ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('/vhc '));
  if (!line) return null;
  const parts = line.split(/\s+/);
  if (parts[1] === 'approve' && parts[2] === 'packet' && parts[3] && parts[4]) {
    return {
      kind: 'approve_packet',
      packetId: parts[3],
      sha256: parts[4].toLowerCase(),
      raw: line,
    };
  }
  if (parts[1] === 'reviewer' && ['fable', 'sol'].includes(parts[2])) {
    return { kind: 'set_reviewer', reviewer: parts[2], raw: line };
  }
  if (parts[1] === 'pause') return { kind: 'pause_automation', raw: line };
  if (parts[1] === 'resume') return { kind: 'resume_automation', raw: line };
  return { kind: 'unknown', raw: line };
}

export function verifyCommandIdentity({ comment, allowlist }) {
  const command = parseVhcCommand(comment?.body);
  if (!command) return { ok: false, reason: 'no_vhc_command', command: null };
  if (!isAllowlistedLogin(comment?.user?.login, allowlist)) {
    return { ok: false, reason: 'comment_author_not_allowlisted', command };
  }
  if (!isUneditedComment(comment)) {
    return { ok: false, reason: 'comment_was_edited', command };
  }
  return { ok: true, reason: 'command_identity_verified', command };
}

export function validatePacketActions({ actions = [], trustPhase = 1 }) {
  const phaseActions = TRUST_PHASE_ACTIONS[trustPhase] ?? TRUST_PHASE_ACTIONS[1];
  const blockers = [];
  for (const action of actions) {
    const id = typeof action === 'string' ? action : action?.id;
    if (!id) {
      blockers.push('action_id_missing');
      continue;
    }
    if (FORBIDDEN_ACTION_IDS.includes(id)) {
      blockers.push(`forbidden_action:${id}`);
    } else if (!phaseActions.has(id)) {
      blockers.push(`action_not_allowed_in_phase_${trustPhase}:${id}`);
    }
  }
  return { ok: blockers.length === 0, blockers };
}

export function validateExitClassGuard({ actionId, systemctl = {} }) {
  if (actionId !== 'restart_publisher_exit69_only') return { ok: true, blockers: [] };
  const status = String(systemctl.ExecMainStatus ?? systemctl.execMainStatus ?? '').trim();
  const result = String(systemctl.Result ?? systemctl.result ?? '').trim();
  if (status === '78') return { ok: false, blockers: ['exit_class_guard_refused_exit_78'] };
  if (status === '75') return { ok: false, blockers: ['exit_class_guard_refused_exit_75'] };
  if (status === '69') return { ok: true, blockers: [] };
  if (result === 'success' || status === '0') return { ok: true, blockers: [] };
  return { ok: false, blockers: [`exit_class_guard_unrecognized_status:${status || 'missing'}`] };
}

export function canonicalReviewPayload(verdict) {
  return JSON.stringify({
    schemaVersion: verdict.schemaVersion,
    packetSha256: verdict.packetSha256,
    verdict: verdict.verdict,
    risk: verdict.risk,
    approvedActionIds: verdict.approvedActionIds ?? [],
    blockedActionIds: verdict.blockedActionIds ?? [],
    requiredReadbacks: verdict.requiredReadbacks ?? [],
    expiresAt: verdict.expiresAt,
  });
}

export function verifyReviewSignature({ verdict, publicKeyPem, nowMs = Date.now() }) {
  if (!verdict || verdict.schemaVersion !== REVIEW_VERDICT_SCHEMA_VERSION) {
    return { ok: false, reason: 'review_schema_invalid' };
  }
  if (verdict.verdict !== 'pass') return { ok: false, reason: `review_not_pass:${verdict.verdict ?? 'missing'}` };
  const expiresAtMs = Date.parse(String(verdict.expiresAt ?? ''));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return { ok: false, reason: 'review_expired_or_missing' };
  }
  if (!verdict.signature) return { ok: false, reason: 'review_signature_missing' };
  try {
    const verified = verifySignature(
      null,
      Buffer.from(canonicalReviewPayload(verdict), 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(verdict.signature, 'base64'),
    );
    return verified ? { ok: true, reason: 'review_signature_verified' } : { ok: false, reason: 'review_signature_invalid' };
  } catch {
    return { ok: false, reason: 'review_signature_invalid' };
  }
}

export function packetSha256(packetText) {
  return sha256Hex(packetText);
}

export function normalizeSeverity(value) {
  return value === 'critical' ? 'critical' : value === 'warning' ? 'warning' : 'info';
}
