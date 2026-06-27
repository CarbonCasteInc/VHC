#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${VHC_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${VH_STORYCLUSTER_ENV_FILE:-${HOME}/.config/vhc/storycluster.env}"
STATE_DIR="${VH_STORYCLUSTER_STATE_DIR:-${HOME}/.local/state/vhc/storycluster-engine}"

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "[vh:storycluster:prod] env file is required and must be readable: ${ENV_FILE}" >&2
  exit 78
fi

cd "${REPO_ROOT}"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

failure_artifacts_enabled() {
  case "${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACTS_ENABLED:-1}" in
    0|[fF][aA][lL][sS][eE]|[nN][oO]|[nN]|[oO][fF][fF]) return 1 ;;
    *) return 0 ;;
  esac
}

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "[vh:storycluster:prod] OPENAI_API_KEY is required" >&2
  exit 78
fi

if [[ -z "${VH_STORYCLUSTER_SERVER_AUTH_TOKEN:-}" ]]; then
  echo "[vh:storycluster:prod] VH_STORYCLUSTER_SERVER_AUTH_TOKEN is required" >&2
  exit 78
fi

export NODE_ENV=production
export VH_STORYCLUSTER_VECTOR_BACKEND="${VH_STORYCLUSTER_VECTOR_BACKEND:-qdrant}"
if [[ "${VH_STORYCLUSTER_VECTOR_BACKEND}" != "qdrant" ]]; then
  echo "[vh:storycluster:prod] refusing non-qdrant vector backend in production" >&2
  exit 78
fi

export VH_STORYCLUSTER_SERVER_HOST="${VH_STORYCLUSTER_SERVER_HOST:-127.0.0.1}"
export VH_STORYCLUSTER_SERVER_PORT="${VH_STORYCLUSTER_SERVER_PORT:-4310}"
export VH_STORYCLUSTER_STATE_DIR="${VH_STORYCLUSTER_STATE_DIR:-${STATE_DIR}}"
if [[ "${VH_STORYCLUSTER_STATE_DIR}" != /* ]]; then
  echo "[vh:storycluster:prod] refusing non-absolute VH_STORYCLUSTER_STATE_DIR: ${VH_STORYCLUSTER_STATE_DIR}" >&2
  exit 78
fi
export VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR="${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR:-${VH_STORYCLUSTER_STATE_DIR}/openai-failures}"
QDRANT_HTTP_PORT="${VH_STORYCLUSTER_QDRANT_HTTP_PORT:-6333}"
export VH_STORYCLUSTER_QDRANT_URL="${VH_STORYCLUSTER_QDRANT_URL:-http://127.0.0.1:${QDRANT_HTTP_PORT}}"
export VH_STORYCLUSTER_QDRANT_COLLECTION="${VH_STORYCLUSTER_QDRANT_COLLECTION:-storycluster_coarse_vectors}"
export VH_STORYCLUSTER_QDRANT_TIMEOUT_MS="${VH_STORYCLUSTER_QDRANT_TIMEOUT_MS:-20000}"

mkdir -p "${VH_STORYCLUSTER_STATE_DIR}"
if failure_artifacts_enabled; then
  if [[ "${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR}" != /* ]]; then
    echo "[vh:storycluster:prod] refusing non-absolute VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR: ${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR}" >&2
    exit 78
  fi
  mkdir -p "${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR}"
  chmod 750 "${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR}"
  artifact_probe="${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR}/.write-test.$$"
  if ! (umask 077 && : > "${artifact_probe}") 2>/dev/null; then
    echo "[vh:storycluster:prod] OpenAI failure artifact directory is not writable: ${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR}" >&2
    exit 78
  fi
  rm -f "${artifact_probe}"
  echo "[vh:storycluster:prod] OpenAI failure artifacts enabled at ${VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR}"
fi

echo "[vh:storycluster:prod] Qdrant readiness preflight starting"
node --input-type=module <<'NODE'
const baseUrl = process.env.VH_STORYCLUSTER_QDRANT_URL?.replace(/\/+$/, '');
const timeoutMs = Number.parseInt(process.env.VH_STORYCLUSTER_QDRANT_STARTUP_TIMEOUT_MS ?? '120000', 10);
const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);
const headers = {};
if (process.env.VH_STORYCLUSTER_QDRANT_API_KEY) {
  headers['api-key'] = process.env.VH_STORYCLUSTER_QDRANT_API_KEY;
}

let last = 'not-run';
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${baseUrl}/collections`, { headers });
    last = `HTTP ${response.status}`;
    if (response.ok) {
      console.info(JSON.stringify({ stage: 'storycluster_qdrant_readiness', status: 'pass', url: baseUrl }));
      process.exit(0);
    }
  } catch (error) {
    last = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.error(JSON.stringify({
  stage: 'storycluster_qdrant_readiness',
  status: 'fail',
  url: baseUrl,
  detail: last,
}));
process.exit(1);
NODE

echo "[vh:storycluster:prod] build starting"
pnpm --filter @vh/storycluster-engine build

echo "[vh:storycluster:prod] OpenAI preflight starting"
node --input-type=module <<'NODE'
import { preflightOpenAIStoryClusterProviderFromEnv } from './services/storycluster-engine/dist/openaiProvider.js';

const result = await preflightOpenAIStoryClusterProviderFromEnv({
  timeoutMs: Number.parseInt(process.env.VH_STORYCLUSTER_OPENAI_PREFLIGHT_TIMEOUT_MS ?? '120000', 10) || 120000,
});
console.info(JSON.stringify({
  stage: 'storycluster_service_openai_preflight',
  status: result.status,
  code: result.code,
  provider: result.provider,
}));
if (result.status !== 'pass') {
  process.exit(1);
}
NODE

echo "[vh:storycluster:prod] starting StoryCluster engine"
exec node \
  --loader "${REPO_ROOT}/tools/node/esm-resolve-loader.mjs" \
  "${REPO_ROOT}/tools/scripts/start-storycluster-local.mjs"
