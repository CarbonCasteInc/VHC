#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMON_SH="${REPO_ROOT}/tools/scripts/lib/news-aggregator-publisher-recovery-common.sh"
if [[ ! -r "${COMMON_SH}" ]]; then
  echo "Publisher recovery common checks are unavailable" >&2
  exit 78
fi
# shellcheck disable=SC1090
source "${COMMON_SH}"
UNIT_DIR="${HOME}/.config/systemd/user"
ENV_FILE="${VH_NEWS_DAEMON_ENV_FILE:-${HOME}/.config/vhc/news-aggregator.env}"
SERVICE_PATH="%h/.local/bin:%h/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin"
ENABLE_WATCH=false
ENABLE_PUBLISHER_LIVENESS_WATCH=false
ENABLE_RELAY_LIVENESS_WATCH=false
ENABLE_SOAK_ARCHIVE=false
ENABLE_WATCH_CLOSURE=false
EXPECTED_REVISION=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --expected-revision)
      if [[ "$#" -lt 2 ]]; then
        echo "--expected-revision requires a full commit id" >&2
        exit 64
      fi
      EXPECTED_REVISION="$2"
      shift 2
      ;;
    --enable-watch)
      ENABLE_WATCH=true
      shift
      ;;
    --enable-publisher-liveness-watch)
      ENABLE_PUBLISHER_LIVENESS_WATCH=true
      shift
      ;;
    --enable-relay-liveness-watch)
      ENABLE_RELAY_LIVENESS_WATCH=true
      shift
      ;;
    --enable-soak-archive)
      ENABLE_SOAK_ARCHIVE=true
      shift
      ;;
    --enable-watch-closure)
      ENABLE_WATCH_CLOSURE=true
      shift
      ;;
    --start-publisher)
      echo "--start-publisher is retired; use news-aggregator-publisher-recovery-control.sh after reviewed preflight evidence" >&2
      exit 78
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

vh_publisher_require_exact_checkout "${REPO_ROOT}" "${EXPECTED_REVISION}"

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
Environment=VH_NEWS_DAEMON_EXPECTED_REVISION=${EXPECTED_REVISION}
Environment=VH_NEWS_DAEMON_SYSTEMD_UNIT=vh-news-aggregator.service
Environment=VH_NEWS_DAEMON_RESTART_AUTHORITY_FILE=%h/.local/state/vhc/news-aggregator/recovery/automatic-restart-authority.json
Environment=VH_NEWS_DAEMON_RESTART_PERMIT_FILE=%h/.local/state/vhc/news-aggregator/recovery/automatic-restart-permit.json
Environment=VH_NEWS_DAEMON_ATTENDED_START_PERMIT_FILE=%h/.local/state/vhc/news-aggregator/recovery/attended-start-permit.json
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStartPre=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/check-news-aggregator-expected-revision.sh ${EXPECTED_REVISION}
ExecStart=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/start-news-aggregator-daemon-production.sh
ExecStopPost=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/record-news-aggregator-restartable-exit.sh ${EXPECTED_REVISION}
Restart=no
RestartForceExitStatus=69
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
Environment=VH_NEWS_DAEMON_EXPECTED_REVISION=${EXPECTED_REVISION}
Environment=VH_RELAY_SNAPSHOT_WATCH_OUTPUT_FILE=%h/.local/state/vhc/relay-snapshot-watch/latest.json
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStartPre=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/check-news-aggregator-expected-revision.sh ${EXPECTED_REVISION}
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
Environment=VH_NEWS_DAEMON_EXPECTED_REVISION=${EXPECTED_REVISION}
Environment=VH_NEWS_PUBLISHER_LIVENESS_OUTPUT_FILE=%h/.local/state/vhc/news-aggregator/publisher-liveness/latest.json
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStartPre=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/check-news-aggregator-expected-revision.sh ${EXPECTED_REVISION}
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
Environment=VH_NEWS_DAEMON_EXPECTED_REVISION=${EXPECTED_REVISION}
Environment=VH_RELAY_LIVENESS_OUTPUT_FILE=%h/.local/state/vhc/relay-liveness/latest.json
Environment=VH_RELAY_LIVENESS_RESTART_ON_FAIL=true
Environment=VH_RELAY_LIVENESS_RESTART_MAX_PER_RUN=1
Environment=VH_RELAY_LIVENESS_RESTART_MIN_INTERVAL_MS=600000
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStartPre=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/check-news-aggregator-expected-revision.sh ${EXPECTED_REVISION}
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

cat >"${UNIT_DIR}/vh-phase5-scope-a-soak-archive.service" <<EOF
[Unit]
Description=VHC Phase 5 Scope A Soak Evidence Archive
Documentation=file:${REPO_ROOT}/docs/ops/news-aggregator-production-service.md

[Service]
Type=oneshot
Environment=VHC_REPO=${REPO_ROOT}
Environment=VH_NEWS_DAEMON_EXPECTED_REVISION=${EXPECTED_REVISION}
Environment=VH_PHASE5_SCOPE_A_SOAK_ARCHIVE_ROOT=%h/.local/state/vhc/phase5-scope-a-soak
Environment=VH_PHASE5_SCOPE_A_SOAK_RUN_PUBLIC_MONITOR=true
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStartPre=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/check-news-aggregator-expected-revision.sh ${EXPECTED_REVISION}
ExecStart=/usr/bin/env node ${REPO_ROOT}/tools/scripts/archive-phase5-scope-a-soak-sample.mjs
EOF

cat >"${UNIT_DIR}/vh-phase5-scope-a-soak-archive.timer" <<'EOF'
[Unit]
Description=Archive VHC Phase 5 Scope A soak evidence every hour

[Timer]
OnBootSec=8min
OnUnitActiveSec=1h
AccuracySec=5min
Persistent=true
Unit=vh-phase5-scope-a-soak-archive.service

[Install]
WantedBy=timers.target
EOF

cat >"${UNIT_DIR}/vh-phase5-scope-a-watch-closure.service" <<EOF
[Unit]
Description=VHC Phase 5 Scope A Watch Closure Packet
Documentation=file:${REPO_ROOT}/docs/ops/news-aggregator-production-service.md

[Service]
Type=oneshot
Environment=VHC_REPO=${REPO_ROOT}
Environment=VH_NEWS_DAEMON_EXPECTED_REVISION=${EXPECTED_REVISION}
Environment=VH_PHASE5_SCOPE_A_WATCH_ARCHIVE_ROOT=%h/.local/state/vhc/phase5-scope-a-soak
Environment=VH_PHASE5_SCOPE_A_WATCH_RUNTIME_DIAGNOSTICS_FILE=%h/.local/state/vhc/news-aggregator/artifacts/news-runtime-diagnostics.json
Environment=VH_PHASE5_SCOPE_A_WATCH_STORYCLUSTER_FAILURE_DIR=%h/.local/state/vhc/storycluster-engine/openai-failures
Environment=VH_PHASE5_SCOPE_A_WATCH_OUTPUT_FILE=%h/.local/state/vhc/phase5-scope-a-watch-closure/latest.json
Environment=VH_PHASE5_SCOPE_A_WATCH_VERDICT_FILE=%h/.local/state/vhc/phase5-scope-a-watch-closure/verdict.json
Environment=PATH=${SERVICE_PATH}
WorkingDirectory=${REPO_ROOT}
ExecStartPre=/usr/bin/env bash ${REPO_ROOT}/tools/scripts/check-news-aggregator-expected-revision.sh ${EXPECTED_REVISION}
ExecStart=/usr/bin/env bash -c 'if [ -f "%h/.config/vhc/phase5-scope-a-watch-closure.env" ]; then set -a; source "%h/.config/vhc/phase5-scope-a-watch-closure.env"; set +a; fi; exec node "${REPO_ROOT}/tools/scripts/phase5-scope-a-watch-closure-packet.mjs"'
EOF

cat >"${UNIT_DIR}/vh-phase5-scope-a-watch-closure.timer" <<'EOF'
[Unit]
Description=Build VHC Phase 5 Scope A watch closure packet every 30 minutes

[Timer]
OnBootSec=12min
OnUnitActiveSec=30min
AccuracySec=2min
Persistent=true
Unit=vh-phase5-scope-a-watch-closure.service

[Install]
WantedBy=timers.target
EOF

lint_user_units() {
  if ! command -v systemd-analyze >/dev/null 2>&1; then
    echo "systemd-analyze not available; skipping user unit verification"
    return 0
  fi

  local units=(
    "${UNIT_DIR}/vh-news-aggregator.service"
    "${UNIT_DIR}/vh-relay-snapshot-freshness-watch.service"
    "${UNIT_DIR}/vh-relay-snapshot-freshness-watch.timer"
    "${UNIT_DIR}/vh-news-aggregator-liveness-watch.service"
    "${UNIT_DIR}/vh-news-aggregator-liveness-watch.timer"
    "${UNIT_DIR}/vh-news-relay-liveness-watch.service"
    "${UNIT_DIR}/vh-news-relay-liveness-watch.timer"
    "${UNIT_DIR}/vh-phase5-scope-a-soak-archive.service"
    "${UNIT_DIR}/vh-phase5-scope-a-soak-archive.timer"
    "${UNIT_DIR}/vh-phase5-scope-a-watch-closure.service"
    "${UNIT_DIR}/vh-phase5-scope-a-watch-closure.timer"
  )

  if systemd-analyze verify --user "${units[@]}"; then
    echo "Verified generated user units with systemd-analyze"
    return 0
  fi

  echo "Generated user unit verification failed" >&2
  exit 78
}

lint_user_units
systemctl --user daemon-reload

echo "Installed user units:"
echo "  ${UNIT_DIR}/vh-news-aggregator.service"
echo "  ${UNIT_DIR}/vh-relay-snapshot-freshness-watch.service"
echo "  ${UNIT_DIR}/vh-relay-snapshot-freshness-watch.timer"
echo "  ${UNIT_DIR}/vh-news-aggregator-liveness-watch.service"
echo "  ${UNIT_DIR}/vh-news-aggregator-liveness-watch.timer"
echo "  ${UNIT_DIR}/vh-news-relay-liveness-watch.service"
echo "  ${UNIT_DIR}/vh-news-relay-liveness-watch.timer"
echo "  ${UNIT_DIR}/vh-phase5-scope-a-soak-archive.service"
echo "  ${UNIT_DIR}/vh-phase5-scope-a-soak-archive.timer"
echo "  ${UNIT_DIR}/vh-phase5-scope-a-watch-closure.service"
echo "  ${UNIT_DIR}/vh-phase5-scope-a-watch-closure.timer"
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

if [[ "${ENABLE_SOAK_ARCHIVE}" == "true" ]]; then
  systemctl --user enable --now vh-phase5-scope-a-soak-archive.timer
  echo "Enabled Phase 5 Scope A soak archive timer"
fi

if [[ "${ENABLE_WATCH_CLOSURE}" == "true" ]]; then
  systemctl --user enable --now vh-phase5-scope-a-watch-closure.timer
  echo "Enabled Phase 5 Scope A watch closure timer"
fi

echo "Publisher service installed for exact revision ${EXPECTED_REVISION} but not started"
