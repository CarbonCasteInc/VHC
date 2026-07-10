#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${VHC_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
EXPECTED_REVISION="${1:-${VH_NEWS_DAEMON_EXPECTED_REVISION:-}}"
AUTHORITY_FILE="${VH_NEWS_DAEMON_RESTART_AUTHORITY_FILE:-${HOME}/.local/state/vhc/news-aggregator/recovery/automatic-restart-authority.json}"
PERMIT_FILE="${VH_NEWS_DAEMON_RESTART_PERMIT_FILE:-${HOME}/.local/state/vhc/news-aggregator/recovery/automatic-restart-permit.json}"
UNIT="${VH_NEWS_DAEMON_SYSTEMD_UNIT:-vh-news-aggregator.service}"

# Ordering contract (upstream systemd src/core/service.c): ExecStopPost finishes
# through service_enter_dead(); service_enter_restart() runs afterward and then
# increments n_restarts. Therefore this hook records the prior value and the
# next automatic ExecStart must observe exactly prior+1.
previous_nrestarts="$(systemctl --user show "${UNIT}" --property=NRestarts --value 2>/dev/null || true)"
if [[ ! "${previous_nrestarts}" =~ ^[0-9]+$ ]]; then
  previous_nrestarts=-1
fi

node "${REPO_ROOT}/tools/scripts/news-aggregator-publisher-automatic-restart-authority.mjs" record-exit \
  --expected-revision "${EXPECTED_REVISION}" \
  --authority-file "${AUTHORITY_FILE}" \
  --permit-file "${PERMIT_FILE}" \
  --service-result "${SERVICE_RESULT:-unknown}" \
  --exit-code "${EXIT_CODE:-unknown}" \
  --exit-status "${EXIT_STATUS:-unknown}" \
  --previous-nrestarts "${previous_nrestarts}" >/dev/null
