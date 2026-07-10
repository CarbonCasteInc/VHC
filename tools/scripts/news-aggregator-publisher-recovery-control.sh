#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${VHC_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
COMMON_SH="${REPO_ROOT}/tools/scripts/lib/news-aggregator-publisher-recovery-common.sh"
START_SCRIPT="${REPO_ROOT}/tools/scripts/start-news-aggregator-daemon-production.sh"
GUARD_SCRIPT="${REPO_ROOT}/tools/scripts/news-aggregator-publisher-recovery-guard.mjs"
VERIFY_SCRIPT="${REPO_ROOT}/tools/scripts/verify-news-aggregator-publisher-recovery.mjs"
START_CONTROL_WRITER="${REPO_ROOT}/tools/scripts/write-news-aggregator-publisher-start-control-artifact.mjs"
SERVICE="vh-news-aggregator.service"
PUBLISHER_ENV_FILE="${VH_NEWS_DAEMON_ENV_FILE:-${HOME}/.config/vhc/news-aggregator.env}"
RESTART_AUTHORITY_FILE="${VH_NEWS_DAEMON_RESTART_AUTHORITY_FILE:-${HOME}/.local/state/vhc/news-aggregator/recovery/automatic-restart-authority.json}"
RESTART_PERMIT_FILE="${VH_NEWS_DAEMON_RESTART_PERMIT_FILE:-${HOME}/.local/state/vhc/news-aggregator/recovery/automatic-restart-permit.json}"
ATTENDED_START_PERMIT_FILE="${VH_NEWS_DAEMON_ATTENDED_START_PERMIT_FILE:-${HOME}/.local/state/vhc/news-aggregator/recovery/attended-start-permit.json}"
RESTART_AUTHORITY_SCRIPT="${REPO_ROOT}/tools/scripts/news-aggregator-publisher-automatic-restart-authority.mjs"

if [[ ! -r "${COMMON_SH}" ]]; then
  echo "[vh:publisher-recovery] common checks are unavailable" >&2
  exit 78
fi
# shellcheck disable=SC1090
source "${COMMON_SH}"

usage() {
  cat >&2 <<'EOF'
usage:
  news-aggregator-publisher-recovery-control.sh preflight --expected-revision REV --output-file FILE --approve-preflight
  news-aggregator-publisher-recovery-control.sh start --expected-revision REV --relay-recovery-evidence FILE --relay-recovery-expected-sha256 SHA --preflight-artifact FILE --mailbox-artifact FILE --mailbox-expected-sha256 SHA --mailbox-expected-critical-count N --start-control-output FILE --approve-attended-start
  news-aggregator-publisher-recovery-control.sh verify --expected-revision REV --start-control-artifact FILE --current-run-file FILE --runtime-diagnostics-file FILE --output-file FILE --relay-origin URL (three times) --approve-verification-and-abort
  news-aggregator-publisher-recovery-control.sh finalize --expected-revision REV --start-control-artifact FILE --readback-artifact FILE --watch-env-file FILE --first-alert-file FILE --second-alert-file FILE --mailbox-artifact FILE --finalization-output FILE --approve-finalization-and-abort
  news-aggregator-publisher-recovery-control.sh park --expected-revision REV --approve-park
EOF
  exit 64
}

[[ "$#" -ge 1 ]] || usage
COMMAND="$1"
shift

EXPECTED_REVISION=""
PREFLIGHT_ARTIFACT=""
MAILBOX_ARTIFACT=""
CURRENT_RUN_FILE=""
RUNTIME_DIAGNOSTICS_FILE=""
OUTPUT_FILE=""
START_CONTROL_OUTPUT=""
START_CONTROL_ARTIFACT=""
READBACK_ARTIFACT=""
WATCH_ENV_FILE=""
FIRST_ALERT_FILE=""
SECOND_ALERT_FILE=""
FINALIZATION_OUTPUT=""
MAILBOX_EXPECTED_SHA256=""
MAILBOX_EXPECTED_CRITICAL_COUNT=""
RELAY_RECOVERY_EVIDENCE=""
RELAY_RECOVERY_EXPECTED_SHA256=""
PREFLIGHT_MAX_AGE_MS="1800000"
MAILBOX_MAX_AGE_MS="900000"
MAX_TICK_AGE_MS="1800000"
START_CONTROL_MAX_AGE_MS="7200000"
ALERT_MAX_AGE_MS="3600000"
TIMEOUT_MS="5000"
ACTIVE_TIMEOUT_SECONDS="60"
FINALIZE_WAIT_SECONDS="900"
APPROVE_PREFLIGHT=false
APPROVE_ATTENDED_START=false
APPROVE_VERIFICATION_AND_ABORT=false
APPROVE_FINALIZATION_AND_ABORT=false
APPROVE_PARK=false
RELAY_ORIGINS=()

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --approve-preflight)
      APPROVE_PREFLIGHT=true
      shift
      ;;
    --approve-attended-start)
      APPROVE_ATTENDED_START=true
      shift
      ;;
    --approve-verification-and-abort)
      APPROVE_VERIFICATION_AND_ABORT=true
      shift
      ;;
    --approve-finalization-and-abort)
      APPROVE_FINALIZATION_AND_ABORT=true
      shift
      ;;
    --approve-park)
      APPROVE_PARK=true
      shift
      ;;
    --relay-origin)
      [[ "$#" -ge 2 ]] || usage
      RELAY_ORIGINS+=("$2")
      shift 2
      ;;
    --expected-revision|--relay-recovery-evidence|--relay-recovery-expected-sha256|--preflight-artifact|--mailbox-artifact|--mailbox-expected-sha256|--mailbox-expected-critical-count|--start-control-output|--start-control-artifact|--readback-artifact|--watch-env-file|--first-alert-file|--second-alert-file|--finalization-output|--current-run-file|--runtime-diagnostics-file|--output-file|--preflight-max-age-ms|--mailbox-max-age-ms|--max-tick-age-ms|--start-control-max-age-ms|--alert-max-age-ms|--timeout-ms|--active-timeout-seconds|--finalize-wait-seconds)
      [[ "$#" -ge 2 ]] || usage
      case "$1" in
        --expected-revision) EXPECTED_REVISION="$2" ;;
        --relay-recovery-evidence) RELAY_RECOVERY_EVIDENCE="$2" ;;
        --relay-recovery-expected-sha256) RELAY_RECOVERY_EXPECTED_SHA256="$2" ;;
        --preflight-artifact) PREFLIGHT_ARTIFACT="$2" ;;
        --mailbox-artifact) MAILBOX_ARTIFACT="$2" ;;
        --mailbox-expected-sha256) MAILBOX_EXPECTED_SHA256="$2" ;;
        --mailbox-expected-critical-count) MAILBOX_EXPECTED_CRITICAL_COUNT="$2" ;;
        --start-control-output) START_CONTROL_OUTPUT="$2" ;;
        --start-control-artifact) START_CONTROL_ARTIFACT="$2" ;;
        --readback-artifact) READBACK_ARTIFACT="$2" ;;
        --watch-env-file) WATCH_ENV_FILE="$2" ;;
        --first-alert-file) FIRST_ALERT_FILE="$2" ;;
        --second-alert-file) SECOND_ALERT_FILE="$2" ;;
        --finalization-output) FINALIZATION_OUTPUT="$2" ;;
        --current-run-file) CURRENT_RUN_FILE="$2" ;;
        --runtime-diagnostics-file) RUNTIME_DIAGNOSTICS_FILE="$2" ;;
        --output-file) OUTPUT_FILE="$2" ;;
        --preflight-max-age-ms) PREFLIGHT_MAX_AGE_MS="$2" ;;
        --mailbox-max-age-ms) MAILBOX_MAX_AGE_MS="$2" ;;
        --max-tick-age-ms) MAX_TICK_AGE_MS="$2" ;;
        --start-control-max-age-ms) START_CONTROL_MAX_AGE_MS="$2" ;;
        --alert-max-age-ms) ALERT_MAX_AGE_MS="$2" ;;
        --timeout-ms) TIMEOUT_MS="$2" ;;
        --active-timeout-seconds) ACTIVE_TIMEOUT_SECONDS="$2" ;;
        --finalize-wait-seconds) FINALIZE_WAIT_SECONDS="$2" ;;
      esac
      shift 2
      ;;
    *) usage ;;
  esac
done

vh_publisher_require_full_revision "${EXPECTED_REVISION}"

manager_approval_is_set() {
  local manager_environment
  if ! manager_environment="$(systemctl --user show-environment 2>/dev/null)"; then
    return 0
  fi
  grep -Eq '^(VH_NEWS_DAEMON_ATTENDED_START_APPROVED|VH_NEWS_DAEMON_START_APPROVED)=' \
    <<<"${manager_environment}"
}

park_internal() {
  local state sub_state result_state exec_status enabled
  state="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
  sub_state="$(systemctl --user show "${SERVICE}" --property=SubState --value 2>/dev/null)"
  result_state="$(systemctl --user show "${SERVICE}" --property=Result --value 2>/dev/null)"
  exec_status="$(systemctl --user show "${SERVICE}" --property=ExecMainStatus --value 2>/dev/null)"
  if [[ "${state}" != "failed" || "${sub_state}" != "failed"
    || "${result_state}" != "exit-code" || "${exec_status}" != "78" ]]; then
    systemctl --user stop "${SERVICE}" >/dev/null
  fi
  systemctl --user disable "${SERVICE}" >/dev/null
  systemctl --user unset-environment \
    VH_NEWS_DAEMON_ATTENDED_START_APPROVED \
    VH_NEWS_DAEMON_START_APPROVED >/dev/null
  if ! node "${RESTART_AUTHORITY_SCRIPT}" disarm \
    --authority-file "${RESTART_AUTHORITY_FILE}" \
    --permit-file "${RESTART_PERMIT_FILE}" \
    --attended-permit-file "${ATTENDED_START_PERMIT_FILE}" >/dev/null 2>&1; then
    echo "[vh:publisher-recovery] automatic restart authority failed to clear" >&2
    return 78
  fi
  if [[ -e "${ATTENDED_START_PERMIT_FILE}" || -L "${ATTENDED_START_PERMIT_FILE}"
    || -e "${RESTART_PERMIT_FILE}" || -L "${RESTART_PERMIT_FILE}"
    || -e "${RESTART_AUTHORITY_FILE}" || -L "${RESTART_AUTHORITY_FILE}" ]]; then
    echo "[vh:publisher-recovery] automatic restart authority remained after park" >&2
    return 78
  fi

  state="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
  enabled="$(systemctl --user is-enabled "${SERVICE}" 2>/dev/null || true)"
  if [[ "${state}" != "inactive" && "${state}" != "failed" ]]; then
    echo "[vh:publisher-recovery] publisher failed to park" >&2
    return 78
  fi
  if [[ "${enabled}" != "disabled" ]]; then
    echo "[vh:publisher-recovery] publisher unit failed to disable" >&2
    return 78
  fi
  if manager_approval_is_set; then
    echo "[vh:publisher-recovery] publisher approval remained in manager environment" >&2
    return 78
  fi
}

if [[ "${COMMAND}" == "park" || "${COMMAND}" == "abort" ]]; then
  [[ "${APPROVE_PARK}" == "true" ]] || {
    echo "[vh:publisher-recovery] park requires separate explicit approval" >&2
    exit 78
  }
  park_internal
  echo "[vh:publisher-recovery] publisher is stopped, disabled, and approval-free"
  exit 0
fi

vh_publisher_require_exact_checkout "${REPO_ROOT}" "${EXPECTED_REVISION}"

if [[ "${COMMAND}" == "preflight" ]]; then
  [[ "${APPROVE_PREFLIGHT}" == "true" && -n "${OUTPUT_FILE}" ]] || {
    echo "[vh:publisher-recovery] preflight requires its distinct approval and output file" >&2
    exit 78
  }
  exec env \
    VHC_REPO="${REPO_ROOT}" \
    VH_NEWS_DAEMON_EXPECTED_REVISION="${EXPECTED_REVISION}" \
    VH_NEWS_DAEMON_PREFLIGHT_ONLY=1 \
    VH_NEWS_DAEMON_PREFLIGHT_APPROVED=1 \
    VH_NEWS_DAEMON_ATTENDED_START_APPROVED= \
    VH_NEWS_DAEMON_START_APPROVED= \
    VH_NEWS_DAEMON_PREFLIGHT_ARTIFACT="${OUTPUT_FILE}" \
    bash "${START_SCRIPT}"
fi

if [[ "${COMMAND}" == "start" ]]; then
  [[ "${APPROVE_ATTENDED_START}" == "true" && -n "${PREFLIGHT_ARTIFACT}" && -n "${MAILBOX_ARTIFACT}"
    && -n "${RELAY_RECOVERY_EVIDENCE}" && -n "${RELAY_RECOVERY_EXPECTED_SHA256}"
    && -n "${MAILBOX_EXPECTED_SHA256}" && -n "${MAILBOX_EXPECTED_CRITICAL_COUNT}"
    && -n "${START_CONTROL_OUTPUT}" ]] || {
    echo "[vh:publisher-recovery] start requires attended approval, preflight evidence, and mailbox evidence" >&2
    exit 78
  }
  if [[ ! "${ACTIVE_TIMEOUT_SECONDS}" =~ ^[0-9]+$ || "${ACTIVE_TIMEOUT_SECONDS}" -le 0 || "${ACTIVE_TIMEOUT_SECONDS}" -gt 300 ]]; then
    echo "[vh:publisher-recovery] active timeout must be 1..300 seconds" >&2
    exit 78
  fi
  if [[ "${START_CONTROL_OUTPUT}" != /* || -e "${START_CONTROL_OUTPUT}" || -L "${START_CONTROL_OUTPUT}" ]]; then
    echo "[vh:publisher-recovery] start-control output must be a new absolute path" >&2
    exit 78
  fi
  node "${GUARD_SCRIPT}" output-parent --file "${START_CONTROL_OUTPUT}" >/dev/null
  preflight_json="$(node "${GUARD_SCRIPT}" preflight \
    --file "${PREFLIGHT_ARTIFACT}" \
    --expected-revision "${EXPECTED_REVISION}" \
    --max-age-ms "${PREFLIGHT_MAX_AGE_MS}")"
  relay_recovery_json="$(node "${GUARD_SCRIPT}" relay-recovery \
    --file "${RELAY_RECOVERY_EVIDENCE}" \
    --expected-revision "${EXPECTED_REVISION}" \
    --expected-sha256 "${RELAY_RECOVERY_EXPECTED_SHA256}" \
    --max-age-ms "${START_CONTROL_MAX_AGE_MS}")"
  mailbox_current_json="$(node "${GUARD_SCRIPT}" mailbox-current \
    --file "${MAILBOX_ARTIFACT}" \
    --expected-sha256 "${MAILBOX_EXPECTED_SHA256}" \
    --expected-critical-count "${MAILBOX_EXPECTED_CRITICAL_COUNT}" \
    --max-age-ms "${MAILBOX_MAX_AGE_MS}")"

  active_state="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
  sub_state="$(systemctl --user show "${SERVICE}" --property=SubState --value 2>/dev/null)"
  result_state="$(systemctl --user show "${SERVICE}" --property=Result --value 2>/dev/null)"
  exec_status="$(systemctl --user show "${SERVICE}" --property=ExecMainStatus --value 2>/dev/null)"
  incident_nrestarts="$(systemctl --user show "${SERVICE}" --property=NRestarts --value 2>/dev/null)"
  enabled_state="$(systemctl --user is-enabled "${SERVICE}" 2>/dev/null || true)"
  if [[ "${active_state}" != "failed" || "${sub_state}" != "failed"
    || "${result_state}" != "exit-code" || "${exec_status}" != "78"
    || "${enabled_state}" != "disabled" || ! "${incident_nrestarts}" =~ ^[0-9]+$ ]] || manager_approval_is_set; then
    echo "[vh:publisher-recovery] publisher is not in the exact reviewed exit-78 parked state" >&2
    exit 78
  fi

  mutation_started=false
  start_control_staging=""
  cleanup_start() {
    local status=$?
    trap - EXIT HUP INT TERM
    if [[ -n "${start_control_staging}" ]]; then
      rm -f -- "${start_control_staging}" >/dev/null 2>&1 || status=78
      [[ ! -e "${start_control_staging}" && ! -L "${start_control_staging}" ]] || status=78
    fi
    systemctl --user unset-environment \
      VH_NEWS_DAEMON_ATTENDED_START_APPROVED \
      VH_NEWS_DAEMON_START_APPROVED >/dev/null 2>&1 || status=78
    if [[ "${status}" -ne 0 && "${mutation_started}" == "true" ]]; then
      park_internal >/dev/null 2>&1 || status=78
      status=78
    fi
    exit "${status}"
  }
  trap cleanup_start EXIT
  trap 'exit 78' HUP INT TERM

  started_at="$(node -e 'process.stdout.write(new Date().toISOString())')"
  mutation_started=true
  systemctl --user enable "${SERVICE}" >/dev/null
  systemctl --user reset-failed "${SERVICE}" >/dev/null
  baseline_nrestarts="$(systemctl --user show "${SERVICE}" --property=NRestarts --value 2>/dev/null)"
  if [[ ! "${baseline_nrestarts}" =~ ^[0-9]+$ ]]; then
    echo "[vh:publisher-recovery] publisher restart baseline is unavailable after reset-failed" >&2
    exit 78
  fi
  node "${RESTART_AUTHORITY_SCRIPT}" arm \
    --expected-revision "${EXPECTED_REVISION}" \
    --authority-file "${RESTART_AUTHORITY_FILE}" \
    --permit-file "${RESTART_PERMIT_FILE}" \
    --baseline-nrestarts "${baseline_nrestarts}" >/dev/null
  attended_evidence_bindings="$(node -e '
    const [preflight, relay, mailbox] = process.argv.slice(1).map(JSON.parse);
    process.stdout.write(JSON.stringify({
      preflightSha256: preflight.sha256,
      relayEvidenceSha256: relay.sha256,
      relayPacketSha256: relay.packetSha256,
      relayCaptureSha256: relay.captureSha256,
      mailboxSha256: mailbox.sha256,
      mailboxCriticalCount: mailbox.newCriticalCount,
    }));
  ' "${preflight_json}" "${relay_recovery_json}" "${mailbox_current_json}")"
  attended_permit_json="$(node "${RESTART_AUTHORITY_SCRIPT}" issue-attended \
    --expected-revision "${EXPECTED_REVISION}" \
    --attended-permit-file "${ATTENDED_START_PERMIT_FILE}" \
    --baseline-nrestarts "${baseline_nrestarts}" \
    --start-control-output "${START_CONTROL_OUTPUT}" \
    --evidence-bindings-json "${attended_evidence_bindings}" \
    --controller-pid "$$" \
    --max-age-ms 120000)"
  attended_permit_binding_sha256="$(node -e '
    const value = JSON.parse(process.argv[1]);
    if (value.status !== "attended_start_permit_issued" || !/^[0-9a-f]{64}$/.test(value.permitBindingSha256 ?? "")) process.exit(78);
    process.stdout.write(value.permitBindingSha256);
  ' "${attended_permit_json}")"
  systemctl --user start "${SERVICE}" >/dev/null

  deadline=$((SECONDS + ACTIVE_TIMEOUT_SECONDS))
  while true; do
    active_state="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
    sub_state="$(systemctl --user show "${SERVICE}" --property=SubState --value 2>/dev/null)"
    if [[ "${active_state}" == "active" && "${sub_state}" == "running"
      && ! -e "${ATTENDED_START_PERMIT_FILE}" && ! -L "${ATTENDED_START_PERMIT_FILE}" ]]; then
      break
    fi
    if [[ "${active_state}" == "failed" || "${SECONDS}" -ge "${deadline}" ]]; then
      echo "[vh:publisher-recovery] publisher did not reach active/running" >&2
      exit 78
    fi
    sleep 1
  done
  systemctl --user unset-environment \
    VH_NEWS_DAEMON_ATTENDED_START_APPROVED \
    VH_NEWS_DAEMON_START_APPROVED >/dev/null
  if manager_approval_is_set; then
    echo "[vh:publisher-recovery] one-shot approval did not clear" >&2
    exit 78
  fi
  if [[ -e "${ATTENDED_START_PERMIT_FILE}" || -L "${ATTENDED_START_PERMIT_FILE}" ]]; then
    echo "[vh:publisher-recovery] attended start permit was not consumed" >&2
    exit 78
  fi
  post_nrestarts="$(systemctl --user show "${SERVICE}" --property=NRestarts --value 2>/dev/null)"
  if [[ ! "${post_nrestarts}" =~ ^[0-9]+$ || "${post_nrestarts}" != "${baseline_nrestarts}" ]]; then
    echo "[vh:publisher-recovery] publisher restart count changed during activation" >&2
    exit 78
  fi
  activated_at="$(node -e 'process.stdout.write(new Date().toISOString())')"
  start_control_staging="$(dirname "${START_CONTROL_OUTPUT}")/.${START_CONTROL_OUTPUT##*/}.pending-$$-${RANDOM}"
  node "${START_CONTROL_WRITER}" \
    --output-file "${start_control_staging}" \
    --expected-revision "${EXPECTED_REVISION}" \
    --started-at "${started_at}" \
    --activated-at "${activated_at}" \
    --incident-nrestarts "${incident_nrestarts}" \
    --baseline-nrestarts "${baseline_nrestarts}" \
    --post-nrestarts "${post_nrestarts}" \
    --attended-permit-binding-sha256 "${attended_permit_binding_sha256}" \
    --preflight-binding-json "${preflight_json}" \
    --relay-binding-json "${relay_recovery_json}" \
    --mailbox-binding-json "${mailbox_current_json}"
  final_active_state="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
  final_sub_state="$(systemctl --user show "${SERVICE}" --property=SubState --value 2>/dev/null)"
  final_nrestarts="$(systemctl --user show "${SERVICE}" --property=NRestarts --value 2>/dev/null)"
  if [[ "${final_active_state}" != "active" || "${final_sub_state}" != "running"
    || "${final_nrestarts}" != "${baseline_nrestarts}"
    || -e "${ATTENDED_START_PERMIT_FILE}" || -L "${ATTENDED_START_PERMIT_FILE}" ]] || manager_approval_is_set; then
    echo "[vh:publisher-recovery] publisher state drifted while committing start evidence" >&2
    exit 78
  fi
  ln "${start_control_staging}" "${START_CONTROL_OUTPUT}"
  rm -f -- "${start_control_staging}" >/dev/null 2>&1 || true
  start_control_staging=""
  mutation_started=false
  echo "[vh:publisher-recovery] publisher reached active/running; attended permit is consumed; wrapper preflights remain to be proven by verify"
  exit 0
fi

if [[ "${COMMAND}" == "verify" ]]; then
  verification_succeeded=false
  verification_staging=""
  cleanup_verification() {
    local status=$?
    trap - EXIT HUP INT TERM
    if [[ -n "${verification_staging}" ]]; then
      rm -f -- "${verification_staging}" >/dev/null 2>&1 || status=78
      [[ ! -e "${verification_staging}" && ! -L "${verification_staging}" ]] || status=78
    fi
    if [[ "${verification_succeeded}" != "true" || "${status}" -ne 0 ]]; then
      park_internal >/dev/null 2>&1 || true
      exit 78
    fi
    exit 0
  }
  if [[ "${APPROVE_VERIFICATION_AND_ABORT}" == "true" ]]; then
    trap cleanup_verification EXIT
    trap 'exit 78' HUP INT TERM
  fi
  [[ "${APPROVE_VERIFICATION_AND_ABORT}" == "true"
    && -n "${START_CONTROL_ARTIFACT}" && -n "${CURRENT_RUN_FILE}" && -n "${RUNTIME_DIAGNOSTICS_FILE}" && -n "${OUTPUT_FILE}"
    && "${#RELAY_ORIGINS[@]}" -eq 3 ]] || {
    echo "[vh:publisher-recovery] verification requires three relays, evidence files, output, and abort approval" >&2
    exit 78
  }
  if [[ "${OUTPUT_FILE}" != /* || -e "${OUTPUT_FILE}" || -L "${OUTPUT_FILE}" ]]; then
    echo "[vh:publisher-recovery] verification output must be a new absolute path" >&2
    exit 78
  fi
  node "${GUARD_SCRIPT}" output-parent --file "${OUTPUT_FILE}" >/dev/null
  verification_staging="$(dirname "${OUTPUT_FILE}")/.${OUTPUT_FILE##*/}.pending-$$-${RANDOM}"
  start_control_json="$(node "${GUARD_SCRIPT}" start-control \
    --file "${START_CONTROL_ARTIFACT}" \
    --expected-revision "${EXPECTED_REVISION}" \
    --max-age-ms "${START_CONTROL_MAX_AGE_MS}")"
  expected_nrestarts="$(node -e 'const value=JSON.parse(process.argv[1]).nRestarts; if (!Number.isSafeInteger(value)) process.exit(78); process.stdout.write(String(value));' "${start_control_json}")"
  verify_args=(
    --expected-revision "${EXPECTED_REVISION}"
    --start-control-file "${START_CONTROL_ARTIFACT}"
    --current-run-file "${CURRENT_RUN_FILE}"
    --runtime-diagnostics-file "${RUNTIME_DIAGNOSTICS_FILE}"
    --output-file "${verification_staging}"
    --timeout-ms "${TIMEOUT_MS}"
    --max-tick-age-ms "${MAX_TICK_AGE_MS}"
    --start-control-max-age-ms "${START_CONTROL_MAX_AGE_MS}"
  )
  for origin in "${RELAY_ORIGINS[@]}"; do
    verify_args+=(--relay-origin "${origin}")
  done
  verify_active="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
  verify_sub="$(systemctl --user show "${SERVICE}" --property=SubState --value 2>/dev/null)"
  verify_nrestarts="$(systemctl --user show "${SERVICE}" --property=NRestarts --value 2>/dev/null)"
  if [[ "${verify_active}" != "active" || "${verify_sub}" != "running" || "${verify_nrestarts}" != "${expected_nrestarts}" ]]; then
    echo "[vh:publisher-recovery] publisher state changed before readback" >&2
    exit 78
  fi
  node -e '
    const { lstatSync, realpathSync } = require("node:fs");
    const path = require("node:path");
    const file = process.argv[1];
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())
      || (stat.mode & 0o777) !== 0o600
      || realpathSync(file) !== path.resolve(file)) process.exit(78);
  ' "${PUBLISHER_ENV_FILE}"
  corepack pnpm@9.7.1 --filter @vh/gun-client build >/dev/null
  (
    set +x
    set -a
    if ! source "${PUBLISHER_ENV_FILE}" >/dev/null 2>&1; then
      echo "[vh:publisher-recovery] publisher env file could not be loaded for signature verification" >&2
      exit 78
    fi
    set +a
    unset VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL VH_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL
    node "${VERIFY_SCRIPT}" "${verify_args[@]}"
  )
  verify_active="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
  verify_sub="$(systemctl --user show "${SERVICE}" --property=SubState --value 2>/dev/null)"
  verify_nrestarts="$(systemctl --user show "${SERVICE}" --property=NRestarts --value 2>/dev/null)"
  if [[ "${verify_active}" != "active" || "${verify_sub}" != "running" || "${verify_nrestarts}" != "${expected_nrestarts}" ]]; then
    echo "[vh:publisher-recovery] publisher state changed during readback" >&2
    exit 78
  fi
  ln "${verification_staging}" "${OUTPUT_FILE}"
  rm -f -- "${verification_staging}" >/dev/null 2>&1 || true
  verification_staging=""
  verification_succeeded=true
  trap - EXIT HUP INT TERM
  echo "[vh:publisher-recovery] exact-run four-route recovery readback passed"
  exit 0
fi

if [[ "${COMMAND}" == "finalize" ]]; then
  finalization_temp=""
  finalization_succeeded=false
  cleanup_finalization() {
    local status=$?
    trap - EXIT HUP INT TERM
    set +e
    [[ -z "${finalization_temp}" ]] || rm -f "${finalization_temp}"
    if [[ "${finalization_succeeded}" != "true" || "${status}" -ne 0 ]]; then
      park_internal >/dev/null 2>&1 || true
      exit 78
    fi
    exit 0
  }
  if [[ "${APPROVE_FINALIZATION_AND_ABORT}" == "true" ]]; then
    trap cleanup_finalization EXIT
    trap 'exit 78' HUP INT TERM
  fi
  [[ "${APPROVE_FINALIZATION_AND_ABORT}" == "true" && -n "${START_CONTROL_ARTIFACT}"
    && -n "${READBACK_ARTIFACT}" && -n "${WATCH_ENV_FILE}"
    && -n "${FIRST_ALERT_FILE}" && -n "${SECOND_ALERT_FILE}" && -n "${MAILBOX_ARTIFACT}"
    && -n "${FINALIZATION_OUTPUT}" ]] || {
    echo "[vh:publisher-recovery] finalization requires two alert reports, post-suppression mailbox, output, and abort approval" >&2
    exit 78
  }
  if [[ ! "${FINALIZE_WAIT_SECONDS}" =~ ^[0-9]+$ || "${FINALIZE_WAIT_SECONDS}" -le 0 || "${FINALIZE_WAIT_SECONDS}" -gt 1800 ]]; then
    echo "[vh:publisher-recovery] finalization wait must be 1..1800 seconds" >&2
    exit 78
  fi
  if ! start_control_json="$(node "${GUARD_SCRIPT}" start-control \
    --file "${START_CONTROL_ARTIFACT}" --expected-revision "${EXPECTED_REVISION}" --max-age-ms "${START_CONTROL_MAX_AGE_MS}")"; then
    exit 78
  fi
  if ! expected_nrestarts="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).nRestarts));' "${start_control_json}")"; then
    exit 78
  fi
  deadline=$((SECONDS + FINALIZE_WAIT_SECONDS))
  if [[ "${FINALIZATION_OUTPUT}" != /* ]]; then
    echo "[vh:publisher-recovery] finalization output path must be absolute" >&2
    exit 78
  fi
  if [[ -e "${FINALIZATION_OUTPUT}" || -L "${FINALIZATION_OUTPUT}" ]]; then
    echo "[vh:publisher-recovery] refusing to overwrite existing finalization evidence" >&2
    exit 78
  fi
  node "${GUARD_SCRIPT}" output-parent --file "${FINALIZATION_OUTPUT}" >/dev/null
  finalization_temp="${FINALIZATION_OUTPUT}.tmp-$$-${RANDOM}"
  finalization_passed=false
  while [[ "${SECONDS}" -lt "${deadline}" ]]; do
    current_active="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
    current_sub="$(systemctl --user show "${SERVICE}" --property=SubState --value 2>/dev/null)"
    current_nrestarts="$(systemctl --user show "${SERVICE}" --property=NRestarts --value 2>/dev/null)"
    if [[ "${current_active}" != "active" || "${current_sub}" != "running" || "${current_nrestarts}" != "${expected_nrestarts}" ]]; then
      break
    fi
    umask 077
    set -o noclobber
    if node "${GUARD_SCRIPT}" finalize \
      --file "${MAILBOX_ARTIFACT}" \
      --expected-revision "${EXPECTED_REVISION}" \
      --start-control-file "${START_CONTROL_ARTIFACT}" \
      --readback-file "${READBACK_ARTIFACT}" \
      --watch-env-file "${WATCH_ENV_FILE}" \
      --first-alert-file "${FIRST_ALERT_FILE}" \
      --second-alert-file "${SECOND_ALERT_FILE}" \
      --start-control-max-age-ms "${START_CONTROL_MAX_AGE_MS}" \
      --alert-max-age-ms "${ALERT_MAX_AGE_MS}" \
      --max-age-ms "${MAILBOX_MAX_AGE_MS}" >"${finalization_temp}" 2>/dev/null; then
      set +o noclobber
      current_active="$(systemctl --user show "${SERVICE}" --property=ActiveState --value 2>/dev/null)"
      current_sub="$(systemctl --user show "${SERVICE}" --property=SubState --value 2>/dev/null)"
      current_nrestarts="$(systemctl --user show "${SERVICE}" --property=NRestarts --value 2>/dev/null)"
      [[ "${current_active}" == "active" && "${current_sub}" == "running" && "${current_nrestarts}" == "${expected_nrestarts}" ]]
      chmod 600 "${finalization_temp}"
      ln "${finalization_temp}" "${FINALIZATION_OUTPUT}"
      # ln commits the already-private inode. A hidden-temp cleanup failure
      # after that point cannot make the final evidence ambiguous.
      rm -f "${finalization_temp}" >/dev/null 2>&1 || true
      finalization_temp=""
      finalization_passed=true
      break
    fi
    set +o noclobber
    rm -f "${finalization_temp}"
    sleep 1
  done
  [[ -z "${finalization_temp}" ]] || rm -f "${finalization_temp}"
  if [[ "${finalization_passed}" != "true" ]]; then
    echo "[vh:publisher-recovery] alert/mailbox finalization did not pass within the bounded wait; publisher parked" >&2
    exit 78
  fi
  finalization_temp=""
  finalization_succeeded=true
  trap - EXIT HUP INT TERM
  echo "[vh:publisher-recovery] recovery delivery, unchanged suppression, and post-suppression mailbox clean proof passed"
  exit 0
fi

usage
