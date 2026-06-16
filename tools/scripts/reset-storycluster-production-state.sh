#!/usr/bin/env bash
set -euo pipefail

# Reset StoryCluster persistent state so the next clustering run starts clean.
#
# Why: the daemon's no-write diagnostic mode suppresses *mesh* writes, but the
# StoryCluster service still persists topic state (FileClusterStore) and Qdrant
# vectors on every clustering call. Diagnostic runs therefore pollute StoryCluster
# state, and a later live tick would publish (capped) bundles selected from that
# stale/accumulated state. This script clears that state, backup-first and gated,
# so a live first tick clusters fresh from current RSS.
#
# StoryCluster auto-recreates an empty Qdrant collection (ensureCollection) and an
# empty topic store on the next readiness probe / clustering call.
#
# Safe by construction: StoryCluster is a read/compute service (no mesh writes);
# this script refuses to run while the publisher is active, backs up before
# clearing, gates on an explicit approval flag, and prints only redacted proof.

ENV_FILE="${VH_STORYCLUSTER_ENV_FILE:-${HOME}/.config/vhc/storycluster.env}"
DEFAULT_STATE_DIR="${HOME}/.local/state/vhc/storycluster-engine"
DEFAULT_BACKUP_ROOT="${HOME}/.local/state/vhc/storycluster-reset-backups"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "[vh:storycluster:reset] env file is required and must be readable: ${ENV_FILE}" >&2
  exit 78
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# --- gate: explicit approval, distinct from start/diagnostic approvals ---
if [[ "${VH_STORYCLUSTER_RESET_APPROVED:-}" != "1" ]]; then
  echo "[vh:storycluster:reset] refusing reset without VH_STORYCLUSTER_RESET_APPROVED=1 in ${ENV_FILE}" >&2
  exit 78
fi

STATE_DIR="${VH_STORYCLUSTER_STATE_DIR:-${DEFAULT_STATE_DIR}}"
BACKUP_ROOT="${VH_STORYCLUSTER_RESET_BACKUP_ROOT:-${DEFAULT_BACKUP_ROOT}}"
ENGINE_UNIT="${VH_STORYCLUSTER_ENGINE_UNIT:-vh-storycluster-engine.service}"
PUBLISHER_UNIT="${VH_NEWS_DAEMON_UNIT:-vh-news-aggregator.service}"
STAMP="${VH_STORYCLUSTER_RESET_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
QDRANT_HTTP_PORT="${VH_STORYCLUSTER_QDRANT_HTTP_PORT:-6333}"
export VH_STORYCLUSTER_QDRANT_URL="${VH_STORYCLUSTER_QDRANT_URL:-http://127.0.0.1:${QDRANT_HTTP_PORT}}"
COLLECTION="${VH_STORYCLUSTER_QDRANT_COLLECTION:-storycluster_coarse_vectors}"
SERVER_HOST="${VH_STORYCLUSTER_SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${VH_STORYCLUSTER_SERVER_PORT:-4310}"
VERIFY_TIMEOUT_MS="${VH_STORYCLUSTER_RESET_VERIFY_TIMEOUT_MS:-120000}"

if [[ "${VH_STORYCLUSTER_VECTOR_BACKEND:-qdrant}" != "qdrant" ]]; then
  echo "[vh:storycluster:reset] refusing non-qdrant vector backend in production reset" >&2
  exit 78
fi

if [[ -z "${VH_STORYCLUSTER_SERVER_AUTH_TOKEN:-}" ]]; then
  echo "[vh:storycluster:reset] VH_STORYCLUSTER_SERVER_AUTH_TOKEN is required for post-reset /ready verification" >&2
  exit 78
fi

if [[ "${STATE_DIR}" != /* ]]; then
  echo "[vh:storycluster:reset] refusing non-absolute VH_STORYCLUSTER_STATE_DIR" >&2
  exit 78
fi

state_dir_trimmed="${STATE_DIR%/}"
case "${state_dir_trimmed}" in
  ""|"/"|"${HOME}"|"${HOME}/.local"|"${HOME}/.local/state"|"${HOME}/.local/state/vhc")
    echo "[vh:storycluster:reset] refusing unsafe VH_STORYCLUSTER_STATE_DIR: ${STATE_DIR}" >&2
    exit 78
    ;;
esac

if [[ "${state_dir_trimmed}" != *storycluster* && "${VH_STORYCLUSTER_RESET_ALLOW_NON_STORYCLUSTER_STATE_DIR:-}" != "1" ]]; then
  echo "[vh:storycluster:reset] refusing state dir that does not look StoryCluster-scoped: ${STATE_DIR}" >&2
  exit 78
fi

if [[ -z "${COLLECTION}" || "${COLLECTION}" == */* ]]; then
  echo "[vh:storycluster:reset] refusing invalid VH_STORYCLUSTER_QDRANT_COLLECTION" >&2
  exit 78
fi

if [[ ! "${VERIFY_TIMEOUT_MS}" =~ ^[0-9]+$ || "${VERIFY_TIMEOUT_MS}" -le 0 ]]; then
  echo "[vh:storycluster:reset] VH_STORYCLUSTER_RESET_VERIFY_TIMEOUT_MS must be a positive integer" >&2
  exit 78
fi

# --- safety: never reset while the publisher could be issuing clustering calls ---
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "${PUBLISHER_UNIT}" 2>/dev/null; then
  echo "[vh:storycluster:reset] refusing reset while ${PUBLISHER_UNIT} is active; stop the publisher first" >&2
  exit 75
fi

BACKUP_DIR="${BACKUP_ROOT}/${STAMP}"
mkdir -p "${BACKUP_DIR}"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[vh:storycluster:reset] systemctl is required for production reset" >&2
  exit 78
fi
if ! systemctl --user cat "${ENGINE_UNIT}" >/dev/null 2>&1; then
  echo "[vh:storycluster:reset] required StoryCluster unit is not installed: ${ENGINE_UNIT}" >&2
  exit 78
fi

systemctl --user stop "${ENGINE_UNIT}"
echo "[vh:storycluster:reset] ${ENGINE_UNIT} stopped"

# --- 1. backup the file cluster store before clearing ---
if [[ -d "${STATE_DIR}" ]]; then
  tar -czf "${BACKUP_DIR}/storycluster-state.tgz" -C "$(dirname "${STATE_DIR}")" "$(basename "${STATE_DIR}")"
  echo "[vh:storycluster:reset] state dir backed up"
fi

# --- 2. capture pre-reset Qdrant point count (proof) ---
__RESET_COLLECTION="${COLLECTION}" node --input-type=module <<'NODE' || true
const baseUrl = process.env.VH_STORYCLUSTER_QDRANT_URL?.replace(/\/+$/, '') ?? '';
const collection = process.env.__RESET_COLLECTION;
const collectionPath = encodeURIComponent(collection);
const headers = {};
if (process.env.VH_STORYCLUSTER_QDRANT_API_KEY) headers['api-key'] = process.env.VH_STORYCLUSTER_QDRANT_API_KEY;
try {
  const res = await fetch(`${baseUrl}/collections/${collectionPath}`, { headers });
  const body = await res.json().catch(() => null);
  console.info(JSON.stringify({ stage: 'pre_reset', http: res.status, points: body?.result?.points_count ?? null }));
} catch {
  console.info(JSON.stringify({ stage: 'pre_reset', http: null, points: null }));
}
NODE

# --- 3. clear the file cluster store ---
if [[ -d "${STATE_DIR}" ]]; then
  find "${STATE_DIR}" -mindepth 1 -delete 2>/dev/null || true
fi
mkdir -p "${STATE_DIR}"

# --- 4. delete the Qdrant collection (auto-recreated empty by ensureCollection) ---
__RESET_COLLECTION="${COLLECTION}" node --input-type=module <<'NODE'
const baseUrl = process.env.VH_STORYCLUSTER_QDRANT_URL?.replace(/\/+$/, '') ?? '';
const collection = process.env.__RESET_COLLECTION;
const collectionPath = encodeURIComponent(collection);
const headers = { 'content-type': 'application/json' };
if (process.env.VH_STORYCLUSTER_QDRANT_API_KEY) headers['api-key'] = process.env.VH_STORYCLUSTER_QDRANT_API_KEY;
const res = await fetch(`${baseUrl}/collections/${collectionPath}`, { method: 'DELETE', headers });
console.info(JSON.stringify({ stage: 'delete_collection', http: res.status, collection }));
// 200 (deleted) and 404 (already absent) are both acceptable end states.
if (!res.ok && res.status !== 404) process.exit(1);
NODE

# --- 5. restart StoryCluster so it drops any in-memory topic state ---
systemctl --user restart "${ENGINE_UNIT}"
echo "[vh:storycluster:reset] ${ENGINE_UNIT} restarted"

# --- 6. verify: /ready qdrant-backed, collection recreated empty, store empty ---
VH_STORYCLUSTER_RESET_VERIFY_URL="http://${SERVER_HOST}:${SERVER_PORT}/ready" \
VH_STORYCLUSTER_RESET_VERIFY_TIMEOUT_MS="${VERIFY_TIMEOUT_MS}" \
__RESET_COLLECTION="${COLLECTION}" node --input-type=module <<'NODE'
const readyUrl = process.env.VH_STORYCLUSTER_RESET_VERIFY_URL;
const baseUrl = process.env.VH_STORYCLUSTER_QDRANT_URL?.replace(/\/+$/, '') ?? '';
const collection = process.env.__RESET_COLLECTION;
const collectionPath = encodeURIComponent(collection);
const authToken = process.env.VH_STORYCLUSTER_SERVER_AUTH_TOKEN;
const authHeader = (process.env.VH_STORYCLUSTER_SERVER_AUTH_HEADER || 'authorization').toLowerCase();
const authScheme = process.env.VH_STORYCLUSTER_SERVER_AUTH_SCHEME || 'Bearer';
const timeoutMs = Number.parseInt(process.env.VH_STORYCLUSTER_RESET_VERIFY_TIMEOUT_MS ?? '120000', 10);
const qHeaders = {};
if (process.env.VH_STORYCLUSTER_QDRANT_API_KEY) qHeaders['api-key'] = process.env.VH_STORYCLUSTER_QDRANT_API_KEY;

const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);
let readyDetail = null;
while (Date.now() < deadline) {
  try {
    const headers = {};
    if (authToken) headers[authHeader] = `${authScheme} ${authToken}`;
    const res = await fetch(readyUrl, { headers });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok === true && String(body?.detail ?? '').startsWith('qdrant:')) {
      readyDetail = body.detail;
      break;
    }
  } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 1000));
}

let points = null;
try {
  const res = await fetch(`${baseUrl}/collections/${collectionPath}`, { headers: qHeaders });
  const body = await res.json().catch(() => null);
  points = body?.result?.points_count ?? null;
} catch { /* leave null */ }

const ok = readyDetail !== null && points === 0;
console.info(JSON.stringify({ stage: 'post_reset', ready_detail: readyDetail, collection_points: points, ok }));
if (!ok) process.exit(1);
NODE

# --- 7. redacted proof ---
REMAINING_FILES="$(find "${STATE_DIR}" -type f 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${REMAINING_FILES}" != "0" ]]; then
  echo "[vh:storycluster:reset] state dir still contains files after reset: ${REMAINING_FILES}" >&2
  exit 1
fi
echo "[vh:storycluster:reset] reset complete"
echo "  state_dir_files_remaining: ${REMAINING_FILES}"
echo "  collection: ${COLLECTION}"
echo "  backup_dir: ${BACKUP_DIR}"
echo "  qdrant_url_host: $(printf '%s' "${VH_STORYCLUSTER_QDRANT_URL}" | sed -E 's#^(https?://[^/]+).*#\1#')"
