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

if [[ "${VH_NEWS_DAEMON_START_APPROVED:-}" != "1" ]]; then
  echo "[vh:news-daemon:prod] refusing to start without VH_NEWS_DAEMON_START_APPROVED=1 in ${ENV_FILE}" >&2
  exit 78
fi

export VH_NEWS_DAEMON_STATE_DIR="${VH_NEWS_DAEMON_STATE_DIR:-${STATE_DIR}}"
export VH_DAEMON_FEED_ARTIFACT_ROOT="${VH_DAEMON_FEED_ARTIFACT_ROOT:-${ARTIFACT_ROOT}}"
export VH_BUNDLE_SYNTHESIS_QUEUE_DIR="${VH_BUNDLE_SYNTHESIS_QUEUE_DIR:-${VH_NEWS_DAEMON_STATE_DIR}/bundle-synthesis-queue}"
export VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER="${VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER:-${VH_BUNDLE_SYNTHESIS_QUEUE_DIR}/synthesis-lifecycle.jsonl}"
LAST_SUCCESS_FILE="${VH_NEWS_DAEMON_LAST_SUCCESS_FILE:-${VH_NEWS_DAEMON_STATE_DIR}/last-success.json}"
OPENAI_PREFLIGHT_TIMEOUT_MS="${VH_NEWS_PUBLISHER_OPENAI_PREFLIGHT_TIMEOUT_MS:-120000}"

mkdir -p "${VH_NEWS_DAEMON_STATE_DIR}" "${VH_DAEMON_FEED_ARTIFACT_ROOT}" "$(dirname "${LAST_SUCCESS_FILE}")"

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

LAST_SUCCESS_FILE="${LAST_SUCCESS_FILE}" node --input-type=module <<'NODE'
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const filePath = process.env.LAST_SUCCESS_FILE;
await mkdir(path.dirname(filePath), { recursive: true });
await writeFile(filePath, `${JSON.stringify({
  schemaVersion: 'vh-news-daemon-production-start-v1',
  generatedAt: new Date().toISOString(),
  status: 'preflight_passed',
  stateDir: process.env.VH_NEWS_DAEMON_STATE_DIR,
  artifactRoot: process.env.VH_DAEMON_FEED_ARTIFACT_ROOT,
  queueDir: process.env.VH_BUNDLE_SYNTHESIS_QUEUE_DIR,
  lifecycleLedger: process.env.VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER,
}, null, 2)}\n`, 'utf8');
NODE

echo "[vh:news-daemon:prod] preflights passed; starting canonical @vh/news-aggregator daemon"
exec pnpm --filter @vh/news-aggregator daemon
