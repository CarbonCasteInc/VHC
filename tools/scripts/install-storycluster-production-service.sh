#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"
ENV_FILE="${VH_STORYCLUSTER_ENV_FILE:-${HOME}/.config/vhc/storycluster.env}"
SERVICE_PATH="%h/.local/bin:%h/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin"
START_QDRANT=false
START_STORYCLUSTER=false

export PATH="${HOME}/.local/bin:${HOME}/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

for arg in "$@"; do
  case "${arg}" in
    --start)
      START_QDRANT=true
      START_STORYCLUSTER=true
      ;;
    --start-qdrant)
      START_QDRANT=true
      ;;
    --start-storycluster)
      START_STORYCLUSTER=true
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      exit 64
      ;;
  esac
done

mkdir -p "${UNIT_DIR}"

cat >"${UNIT_DIR}/vh-storycluster-qdrant.service" <<EOF
[Unit]
Description=VHC StoryCluster Qdrant Vector Store
Documentation=file:${REPO_ROOT}/docs/ops/storycluster-production-service.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=VHC_REPO=${REPO_ROOT}
Environment=VH_STORYCLUSTER_ENV_FILE=${ENV_FILE}
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/start-storycluster-qdrant-production.sh
ExecStop=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/stop-storycluster-qdrant-production.sh
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStartSec=180
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF

cat >"${UNIT_DIR}/vh-storycluster-engine.service" <<EOF
[Unit]
Description=VHC StoryCluster Engine (:4310 production Qdrant)
Documentation=file:${REPO_ROOT}/docs/ops/storycluster-production-service.md
After=network-online.target vh-storycluster-qdrant.service
Wants=network-online.target vh-storycluster-qdrant.service

[Service]
Type=simple
Environment=VHC_REPO=${REPO_ROOT}
Environment=VH_STORYCLUSTER_ENV_FILE=${ENV_FILE}
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/start-storycluster-production.sh
Restart=always
RestartSec=10
KillSignal=SIGTERM
TimeoutStartSec=240
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload

echo "Installed user units:"
echo "  ${UNIT_DIR}/vh-storycluster-qdrant.service"
echo "  ${UNIT_DIR}/vh-storycluster-engine.service"
echo "StoryCluster env file expected at: ${ENV_FILE}"

if [[ "${START_STORYCLUSTER}" == "true" && ! -r "${ENV_FILE}" ]]; then
  echo "--start/--start-storycluster requires readable ${ENV_FILE}" >&2
  exit 78
fi

wait_for_qdrant() {
  if [[ -r "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi
  local qdrant_url="${VH_STORYCLUSTER_QDRANT_URL:-http://127.0.0.1:${VH_STORYCLUSTER_QDRANT_HTTP_PORT:-6333}}"
  VH_STORYCLUSTER_QDRANT_URL="${qdrant_url}" node --input-type=module <<'NODE'
const baseUrl = process.env.VH_STORYCLUSTER_QDRANT_URL?.replace(/\/+$/, '');
const headers = {};
if (process.env.VH_STORYCLUSTER_QDRANT_API_KEY) {
  headers['api-key'] = process.env.VH_STORYCLUSTER_QDRANT_API_KEY;
}
let last = 'not-run';
for (let attempt = 1; attempt <= 90; attempt += 1) {
  try {
    const response = await fetch(`${baseUrl}/collections`, { headers });
    last = `HTTP ${response.status}`;
    if (response.ok) {
      console.info(JSON.stringify({ stage: 'qdrant_readiness', status: 'pass', url: baseUrl }));
      process.exit(0);
    }
  } catch (error) {
    last = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error(JSON.stringify({ stage: 'qdrant_readiness', status: 'fail', url: baseUrl, detail: last }));
process.exit(1);
NODE
}

wait_for_storycluster() {
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  local port="${VH_STORYCLUSTER_SERVER_PORT:-4310}"
  local ready_url="http://127.0.0.1:${port}/ready"
  VH_STORYCLUSTER_READY_URL="${ready_url}" node --input-type=module <<'NODE'
const readyUrl = process.env.VH_STORYCLUSTER_READY_URL;
const token = process.env.VH_STORYCLUSTER_SERVER_AUTH_TOKEN;
let last = 'not-run';
for (let attempt = 1; attempt <= 120; attempt += 1) {
  try {
    const response = await fetch(readyUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
    last = `HTTP ${response.status}`;
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.ok === true && String(payload?.detail ?? '').startsWith('qdrant:')) {
      console.info(JSON.stringify({
        stage: 'storycluster_readiness',
        status: 'pass',
        service: payload.service,
        detail: payload.detail,
      }));
      process.exit(0);
    }
    if (payload?.detail || payload?.error) {
      last = String(payload.detail ?? payload.error);
    }
  } catch (error) {
    last = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error(JSON.stringify({ stage: 'storycluster_readiness', status: 'fail', detail: last }));
process.exit(1);
NODE
}

if [[ "${START_QDRANT}" == "true" ]]; then
  systemctl --user enable --now vh-storycluster-qdrant.service
  wait_for_qdrant
  echo "Enabled and started vh-storycluster-qdrant.service"
fi

if [[ "${START_STORYCLUSTER}" == "true" ]]; then
  wait_for_qdrant
  systemctl --user enable --now vh-storycluster-engine.service
  wait_for_storycluster
  echo "Enabled and started vh-storycluster-engine.service"
else
  echo "StoryCluster services installed but not started"
fi
