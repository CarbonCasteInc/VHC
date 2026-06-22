#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"
ENV_FILE="${VH_NEWS_DAEMON_ENV_FILE:-${HOME}/.config/vhc/news-aggregator.env}"
SERVICE_PATH="%h/.local/bin:%h/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin"
ENABLE_WATCH=false
ENABLE_PUBLISHER_LIVENESS_WATCH=false
ENABLE_RELAY_LIVENESS_WATCH=false
START_PUBLISHER=false

for arg in "$@"; do
  case "${arg}" in
    --enable-watch)
      ENABLE_WATCH=true
      ;;
    --enable-publisher-liveness-watch)
      ENABLE_PUBLISHER_LIVENESS_WATCH=true
      ;;
    --enable-relay-liveness-watch)
      ENABLE_RELAY_LIVENESS_WATCH=true
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

cat >"${UNIT_DIR}/vh-news-aggregator-liveness-watch.service" <<EOF
[Unit]
Description=VHC News Aggregator Publisher Liveness Watch
Documentation=file:${REPO_ROOT}/docs/ops/news-aggregator-production-service.md

[Service]
Type=oneshot
Environment=VHC_REPO=${REPO_ROOT}
Environment=VH_NEWS_DAEMON_ENV_FILE=${ENV_FILE}
Environment=VH_NEWS_PUBLISHER_LIVENESS_OUTPUT_FILE=%h/.local/state/vhc/news-aggregator/publisher-liveness/latest.json
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env bash -c 'set -a; source "${ENV_FILE}"; set +a; exec node "${REPO_ROOT}/tools/scripts/news-aggregator-publisher-liveness-watch.mjs"'
EOF

cat >"${UNIT_DIR}/vh-news-aggregator-liveness-watch.timer" <<'EOF'
[Unit]
Description=Run VHC news aggregator publisher liveness watch every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
AccuracySec=1min
Persistent=true
Unit=vh-news-aggregator-liveness-watch.service

[Install]
WantedBy=timers.target
EOF

cat >"${UNIT_DIR}/vh-news-relay-liveness-watch.service" <<EOF
[Unit]
Description=VHC News Relay Liveness Watch
Documentation=file:${REPO_ROOT}/docs/ops/news-aggregator-production-service.md

[Service]
Type=oneshot
Environment=VHC_REPO=${REPO_ROOT}
Environment=VH_RELAY_LIVENESS_OUTPUT_FILE=%h/.local/state/vhc/relay-liveness/latest.json
Environment=VH_RELAY_LIVENESS_RESTART_ON_FAIL=true
Environment=VH_RELAY_LIVENESS_RESTART_MAX_PER_RUN=1
Environment=VH_RELAY_LIVENESS_RESTART_MIN_INTERVAL_MS=600000
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env node ${REPO_ROOT}/tools/scripts/news-relay-liveness-watch.mjs
EOF

cat >"${UNIT_DIR}/vh-news-relay-liveness-watch.timer" <<'EOF'
[Unit]
Description=Run VHC news relay liveness watch every 5 minutes

[Timer]
OnBootSec=4min
OnUnitActiveSec=5min
AccuracySec=1min
Persistent=true
Unit=vh-news-relay-liveness-watch.service

[Install]
WantedBy=timers.target
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
echo "  ${UNIT_DIR}/vh-news-aggregator-liveness-watch.service"
echo "  ${UNIT_DIR}/vh-news-aggregator-liveness-watch.timer"
echo "  ${UNIT_DIR}/vh-news-relay-liveness-watch.service"
echo "  ${UNIT_DIR}/vh-news-relay-liveness-watch.timer"
echo "Publisher env file expected at: ${ENV_FILE}"

if [[ "${ENABLE_WATCH}" == "true" ]]; then
  systemctl --user enable --now vh-relay-snapshot-freshness-watch.timer
  echo "Enabled relay snapshot freshness timer"
fi

if [[ "${ENABLE_PUBLISHER_LIVENESS_WATCH}" == "true" ]]; then
  systemctl --user enable --now vh-news-aggregator-liveness-watch.timer
  echo "Enabled news aggregator publisher liveness timer"
fi

if [[ "${ENABLE_RELAY_LIVENESS_WATCH}" == "true" ]]; then
  systemctl --user enable --now vh-news-relay-liveness-watch.timer
  echo "Enabled news relay liveness timer"
fi

if [[ "${START_PUBLISHER}" == "true" ]]; then
  if [[ "${VH_NEWS_DAEMON_START_APPROVED:-}" != "1" ]]; then
    echo "--start-publisher requires VH_NEWS_DAEMON_START_APPROVED=1" >&2
    exit 78
  fi
  systemctl --user set-environment VH_NEWS_DAEMON_START_APPROVED=1
  systemctl --user enable --now vh-news-aggregator.service
  echo "Enabled and started vh-news-aggregator.service with systemd manager approval env"
else
  echo "Publisher service installed but not started"
fi
