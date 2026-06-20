#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"
ENV_FILE="${VH_NEWS_DAEMON_ENV_FILE:-${HOME}/.config/vhc/news-aggregator.env}"
SERVICE_PATH="%h/.local/bin:%h/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin"
ENABLE_WATCH=false
START_PUBLISHER=false

for arg in "$@"; do
  case "${arg}" in
    --enable-watch)
      ENABLE_WATCH=true
      ;;
    --start-publisher)
      START_PUBLISHER=true
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      exit 64
      ;;
  esac
done

require_user_linger() {
  local user_name="${VHC_SYSTEMD_USER:-${USER:-}}"
  if [[ -z "${user_name}" ]]; then
    user_name="$(id -un)"
  fi

  if ! command -v loginctl >/dev/null 2>&1; then
    echo "Unable to verify user linger: loginctl is not available" >&2
    echo "Before installing user services, run: loginctl enable-linger ${user_name}" >&2
    return 78
  fi

  local linger
  if ! linger="$(loginctl show-user "${user_name}" -p Linger --value 2>/dev/null)"; then
    echo "Unable to verify user linger for ${user_name}" >&2
    echo "Before installing user services, run: loginctl enable-linger ${user_name}" >&2
    return 78
  fi

  if [[ "${linger}" != "yes" ]]; then
    echo "User linger is required for durable user services; ${user_name} Linger=${linger:-unset}" >&2
    echo "Run: loginctl enable-linger ${user_name}" >&2
    echo "Verify: loginctl show-user ${user_name} -p Linger --value" >&2
    echo "Required user services: vh-analysis-backend-3001.service vh-storycluster-qdrant.service vh-storycluster-engine.service vh-news-aggregator.service" >&2
    return 78
  fi

  echo "Verified user linger for ${user_name}: yes"
}

require_user_linger
mkdir -p "${UNIT_DIR}"

cat >"${UNIT_DIR}/vh-news-aggregator.service" <<EOF
[Unit]
Description=VHC News Aggregator Publisher Daemon
Documentation=file:${REPO_ROOT}/docs/ops/news-aggregator-production-service.md
After=network-online.target vh-storycluster-engine.service
Wants=network-online.target vh-storycluster-engine.service
StartLimitIntervalSec=10min
StartLimitBurst=3

[Service]
Type=simple
Environment=VHC_REPO=${REPO_ROOT}
Environment=VH_NEWS_DAEMON_ENV_FILE=${ENV_FILE}
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/start-news-aggregator-daemon-production.sh
Restart=on-failure
RestartPreventExitStatus=78
RestartSec=30
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF

cat >"${UNIT_DIR}/vh-relay-snapshot-freshness-watch.service" <<EOF
[Unit]
Description=VHC Relay Latest-Index Snapshot Freshness Watch
Documentation=file:${REPO_ROOT}/docs/ops/news-aggregator-production-service.md

[Service]
Type=oneshot
Environment=VHC_REPO=${REPO_ROOT}
Environment=VH_RELAY_SNAPSHOT_WATCH_OUTPUT_FILE=%h/.local/state/vhc/relay-snapshot-watch/latest.json
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env node ${REPO_ROOT}/tools/scripts/relay-latest-index-snapshot-watch.mjs
EOF

cat >"${UNIT_DIR}/vh-relay-snapshot-freshness-watch.timer" <<'EOF'
[Unit]
Description=Run VHC relay latest-index snapshot freshness watch every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
AccuracySec=1min
Persistent=true
Unit=vh-relay-snapshot-freshness-watch.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload

echo "Installed user units:"
echo "  ${UNIT_DIR}/vh-news-aggregator.service"
echo "  ${UNIT_DIR}/vh-relay-snapshot-freshness-watch.service"
echo "  ${UNIT_DIR}/vh-relay-snapshot-freshness-watch.timer"
echo "Publisher env file expected at: ${ENV_FILE}"

if [[ "${ENABLE_WATCH}" == "true" ]]; then
  systemctl --user enable --now vh-relay-snapshot-freshness-watch.timer
  echo "Enabled relay snapshot freshness timer"
fi

if [[ "${START_PUBLISHER}" == "true" ]]; then
  if [[ "${VH_NEWS_DAEMON_START_APPROVED:-}" != "1" ]]; then
    echo "--start-publisher requires VH_NEWS_DAEMON_START_APPROVED=1" >&2
    exit 78
  fi
  systemctl --user enable --now vh-news-aggregator.service
  echo "Enabled and started vh-news-aggregator.service"
else
  echo "Publisher service installed but not started"
fi
