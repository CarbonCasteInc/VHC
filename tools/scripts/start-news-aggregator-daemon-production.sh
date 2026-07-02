#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${VHC_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${VH_NEWS_DAEMON_ENV_FILE:-${HOME}/.config/vhc/news-aggregator.env}"
STATE_DIR="${VH_NEWS_DAEMON_STATE_DIR:-${HOME}/.local/state/vhc/news-aggregator}"
ARTIFACT_ROOT="${VH_DAEMON_FEED_ARTIFACT_ROOT:-${STATE_DIR}/artifacts}"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "[vh:news-daemon:prod] env file is required and must be readable: ${ENV_FILE}" >&2
  exit 78
fi

cd "${REPO_ROOT}"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

truthy_flag() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

find_news_daemon_sibling_pids() {
  ps -axo pid=,comm=,command= 2>/dev/null \
    | awk -v self_pid="$$" '
        $1 != self_pid && $2 == "node" && (index($0, "@vh/news-aggregator daemon") || index($0, "dist/daemon.js")) { print $1 }
      ' \
    | tr '\n' ' '
}

redact_process_line() {
  sed -E 's/([A-Z0-9_]*(KEY|TOKEN|SECRET|PRIVATE|PIN|OPENAI)[A-Z0-9_]*=)[^[:space:]]+/\1[redacted]/g'
}

require_no_news_daemon_siblings() {
  local context="${1:-preflight}"
  local pids
  pids="$(find_news_daemon_sibling_pids)"
  if [[ -z "${pids// }" ]]; then
    return 0
  fi

  echo "[vh:news-daemon:prod] refusing ${context}: existing news daemon runtime process(es): ${pids}" >&2
  for pid in ${pids}; do
    ps -p "${pid}" -o pid=,comm=,command= 2>/dev/null | redact_process_line >&2 || true
  done
  return 75
}

# Guarantee no diagnostic daemon outlives this wrapper, even if a tick hung
# (a hung tick never emits a summary, so the in-daemon max-ticks stop never
# fires). SIGTERM first for a graceful lease release, then SIGKILL any survivor.
reap_news_daemon_siblings() {
  local context="${1:-cleanup}"
  local pids attempt
  pids="$(find_news_daemon_sibling_pids)"
  if [[ -z "${pids// }" ]]; then
    return 0
  fi
  echo "[vh:news-daemon:prod] reaping ${context} news daemon runtime process(es): ${pids}" >&2
  for pid in ${pids}; do kill -TERM "${pid}" 2>/dev/null || true; done
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    pids="$(find_news_daemon_sibling_pids)"
    [[ -z "${pids// }" ]] && return 0
    sleep 1
  done
  pids="$(find_news_daemon_sibling_pids)"
  for pid in ${pids}; do kill -KILL "${pid}" 2>/dev/null || true; done
  sleep 1
  pids="$(find_news_daemon_sibling_pids)"
  if [[ -n "${pids// }" ]]; then
    echo "[vh:news-daemon:prod] failed to reap ${context} news daemon runtime process(es) after SIGKILL: ${pids}" >&2
    return 75
  fi
}

NO_WRITE_DIAGNOSTIC=false
if truthy_flag "${VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE:-${VH_NEWS_DAEMON_NO_WRITE:-}}"; then
  NO_WRITE_DIAGNOSTIC=true
  export VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE=1
fi

if [[ "${NO_WRITE_DIAGNOSTIC}" == "true" ]]; then
  if [[ "${VH_NEWS_DAEMON_DIAGNOSTIC_APPROVED:-}" != "1" ]]; then
    echo "[vh:news-daemon:prod] refusing no-write diagnostic without VH_NEWS_DAEMON_DIAGNOSTIC_APPROVED=1 in ${ENV_FILE}" >&2
    exit 78
  fi
  echo "[vh:news-daemon:prod] no-write diagnostic mode approved; live mesh mutations are suppressed"
  export VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS="${VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS:-1}"
  # Hard wall-clock bound so a hung tick (which never reaches the in-daemon
  # max-ticks stop) cannot orphan. Default sits above one healthy capped tick
  # (~160-235s) and above the 420s tick watchdog so a hang still logs its warning.
  DIAGNOSTIC_MAX_SECONDS="${VH_NEWS_DAEMON_DIAGNOSTIC_MAX_SECONDS:-600}"
  if [[ ! "${DIAGNOSTIC_MAX_SECONDS}" =~ ^[0-9]+$ || "${DIAGNOSTIC_MAX_SECONDS}" -le 0 ]]; then
    echo "[vh:news-daemon:prod] VH_NEWS_DAEMON_DIAGNOSTIC_MAX_SECONDS must be a positive integer" >&2
    exit 78
  fi
  DIAGNOSTIC_TIMEOUT_BIN="${VH_NEWS_DAEMON_DIAGNOSTIC_TIMEOUT_BIN:-timeout}"
elif [[ "${VH_NEWS_DAEMON_START_APPROVED:-}" != "1" ]]; then
  echo "[vh:news-daemon:prod] refusing to start without VH_NEWS_DAEMON_START_APPROVED=1 in ${ENV_FILE}" >&2
  exit 78
fi

require_no_news_daemon_siblings "start"

export VH_NEWS_DAEMON_STATE_DIR="${VH_NEWS_DAEMON_STATE_DIR:-${STATE_DIR}}"
export VH_DAEMON_FEED_ARTIFACT_ROOT="${VH_DAEMON_FEED_ARTIFACT_ROOT:-${ARTIFACT_ROOT}}"
export VH_BUNDLE_SYNTHESIS_QUEUE_DIR="${VH_BUNDLE_SYNTHESIS_QUEUE_DIR:-${VH_NEWS_DAEMON_STATE_DIR}/bundle-synthesis-queue}"
export VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER="${VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER:-${VH_BUNDLE_SYNTHESIS_QUEUE_DIR}/synthesis-lifecycle.jsonl}"
export VH_DAEMON_FEED_RUN_ID="${VH_DAEMON_FEED_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export VH_NEWS_DAEMON_CURRENT_RUN_FILE="${VH_NEWS_DAEMON_CURRENT_RUN_FILE:-${VH_NEWS_DAEMON_STATE_DIR}/current-run.json}"
export VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE="${VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE:-8}"
export VH_NEWS_FEED_MAX_ITEMS_TOTAL="${VH_NEWS_FEED_MAX_ITEMS_TOTAL:-96}"
export VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST="${VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST:-24}"
export VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES="${VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES:-96}"
export VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES="${VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES:-8}"
export VH_NEWS_RUNTIME_PUBLICATION_FRESHNESS_MAX_AGE_MS="${VH_NEWS_RUNTIME_PUBLICATION_FRESHNESS_MAX_AGE_MS:-21600000}"
export VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY="${VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY:-2}"
export VH_NEWS_RUNTIME_TICK_WATCHDOG_MS="${VH_NEWS_RUNTIME_TICK_WATCHDOG_MS:-420000}"
export VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH="${VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH:-256}"
LAST_SUCCESS_FILE="${VH_NEWS_DAEMON_LAST_SUCCESS_FILE:-${VH_NEWS_DAEMON_STATE_DIR}/last-success.json}"
OPENAI_PREFLIGHT_TIMEOUT_MS="${VH_NEWS_PUBLISHER_OPENAI_PREFLIGHT_TIMEOUT_MS:-120000}"

mkdir -p "${VH_NEWS_DAEMON_STATE_DIR}" "${VH_DAEMON_FEED_ARTIFACT_ROOT}" "$(dirname "${LAST_SUCCESS_FILE}")"

echo "[vh:news-daemon:prod] production feed clustering budget applied"
echo "[vh:news-daemon:prod] source-health liveness preflight starting"
pnpm check:news-sources:liveness

echo "[vh:news-daemon:prod] StoryCluster OpenAI preflight build starting"
pnpm --filter @vh/storycluster-engine build

echo "[vh:news-daemon:prod] StoryCluster OpenAI preflight starting"
VH_NEWS_PUBLISHER_OPENAI_PREFLIGHT_TIMEOUT_MS="${OPENAI_PREFLIGHT_TIMEOUT_MS}" node --input-type=module <<'NODE'
import { preflightOpenAIStoryClusterProviderFromEnv } from './services/storycluster-engine/dist/openaiProvider.js';

const timeoutMs = Number.parseInt(process.env.VH_NEWS_PUBLISHER_OPENAI_PREFLIGHT_TIMEOUT_MS ?? '120000', 10);
const result = await preflightOpenAIStoryClusterProviderFromEnv({
  timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
});
console.info(JSON.stringify({
  stage: 'storycluster_openai_preflight',
  status: result.status,
  code: result.code,
  provider: result.provider,
}));
if (result.status !== 'pass') {
  process.exit(1);
}
NODE

echo "[vh:news-daemon:prod] StoryCluster service readiness preflight starting"
node --input-type=module <<'NODE'
const endpointUrl = process.env.VH_STORYCLUSTER_REMOTE_URL?.trim();
const healthUrl = process.env.VH_STORYCLUSTER_REMOTE_HEALTH_URL?.trim();
const token = process.env.VH_STORYCLUSTER_REMOTE_AUTH_TOKEN?.trim();
const authHeader = process.env.VH_STORYCLUSTER_REMOTE_AUTH_HEADER?.trim() || 'authorization';
const authScheme = process.env.VH_STORYCLUSTER_REMOTE_AUTH_SCHEME?.trim() || 'Bearer';
const timeoutMs = Number.parseInt(process.env.VH_STORYCLUSTER_REMOTE_TIMEOUT_MS ?? '300000', 10);

if (!endpointUrl || !healthUrl || !token) {
  console.error(JSON.stringify({
    stage: 'storycluster_service_readiness',
    status: 'fail',
    code: 'storycluster-remote-config-missing',
  }));
  process.exit(1);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300000);
try {
  const response = await fetch(healthUrl, {
    headers: {
      [authHeader]: `${authScheme} ${token}`,
    },
    signal: controller.signal,
  });
  const payload = await response.json().catch(() => ({}));
  const detail = typeof payload.detail === 'string' ? payload.detail : null;
  if (!response.ok || payload.ok !== true || !detail?.startsWith('qdrant:')) {
    console.error(JSON.stringify({
      stage: 'storycluster_service_readiness',
      status: 'fail',
      code: 'storycluster-ready-not-qdrant-backed',
      http_status: response.status,
      service: typeof payload.service === 'string' ? payload.service : null,
      detail,
    }));
    process.exit(1);
  }
  console.info(JSON.stringify({
    stage: 'storycluster_service_readiness',
    status: 'pass',
    http_status: response.status,
    service: payload.service,
    detail,
  }));
} catch (error) {
  console.error(JSON.stringify({
    stage: 'storycluster_service_readiness',
    status: 'fail',
    code: 'storycluster-ready-fetch-failed',
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
} finally {
  clearTimeout(timer);
}
NODE

echo "[vh:news-daemon:prod] raw publication readiness preflight starting"
node "${REPO_ROOT}/tools/scripts/news-aggregator-publisher-preflight.mjs"

LAST_SUCCESS_FILE="${LAST_SUCCESS_FILE}" node --input-type=module <<'NODE'
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const filePath = process.env.LAST_SUCCESS_FILE;
const currentRunFilePath = process.env.VH_NEWS_DAEMON_CURRENT_RUN_FILE;
const generatedAt = new Date().toISOString();
const currentRun = {
  schemaVersion: 'vh-news-daemon-current-run-v1',
  generatedAt,
  status: 'preflight_passed',
  runId: process.env.VH_DAEMON_FEED_RUN_ID,
  stateDir: process.env.VH_NEWS_DAEMON_STATE_DIR,
  artifactRoot: process.env.VH_DAEMON_FEED_ARTIFACT_ROOT,
  queueDir: process.env.VH_BUNDLE_SYNTHESIS_QUEUE_DIR,
  lifecycleLedger: process.env.VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER,
};
await mkdir(path.dirname(filePath), { recursive: true });
await writeFile(filePath, `${JSON.stringify({
  schemaVersion: 'vh-news-daemon-production-start-v1',
  generatedAt,
  status: 'preflight_passed',
  runId: process.env.VH_DAEMON_FEED_RUN_ID,
  stateDir: process.env.VH_NEWS_DAEMON_STATE_DIR,
  artifactRoot: process.env.VH_DAEMON_FEED_ARTIFACT_ROOT,
  queueDir: process.env.VH_BUNDLE_SYNTHESIS_QUEUE_DIR,
  lifecycleLedger: process.env.VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER,
}, null, 2)}\n`, 'utf8');
if (currentRunFilePath) {
  await mkdir(path.dirname(currentRunFilePath), { recursive: true });
  await writeFile(currentRunFilePath, `${JSON.stringify(currentRun, null, 2)}\n`, 'utf8');
}
NODE

echo "[vh:news-daemon:prod] preflights passed; starting canonical @vh/news-aggregator daemon"
if [[ "${NO_WRITE_DIAGNOSTIC}" == "true" ]]; then
  set +e
  if command -v "${DIAGNOSTIC_TIMEOUT_BIN}" >/dev/null 2>&1; then
    "${DIAGNOSTIC_TIMEOUT_BIN}" --signal=TERM --kill-after=30s "${DIAGNOSTIC_MAX_SECONDS}" pnpm --filter @vh/news-aggregator daemon
  else
    echo "[vh:news-daemon:prod] '${DIAGNOSTIC_TIMEOUT_BIN}' unavailable; relying on in-daemon max-ticks + post-run reap" >&2
    pnpm --filter @vh/news-aggregator daemon
  fi
  daemon_status=$?
  set -e
  if [[ "${daemon_status}" == "124" ]]; then
    echo "[vh:news-daemon:prod] no-write diagnostic hit the ${DIAGNOSTIC_MAX_SECONDS}s wall-clock bound (likely a hung tick); reaping" >&2
  fi
  # Guarantee no orphan survives this wrapper regardless of how the daemon exited.
  reap_news_daemon_siblings "post-diagnostic"
  exit "${daemon_status}"
fi
exec pnpm --filter @vh/news-aggregator daemon
