#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/packages/e2e/.env.dev-small}"
WEB_PORT="${WEB_PORT:-2048}"
RELAY_PORT="${RELAY_PORT:-7777}"
WEB_LOG="${WEB_LOG:-/tmp/vh-local-web.log}"
RELAY_LOG="${RELAY_LOG:-/tmp/vh-local-relay.log}"
WEB_PID_FILE="${WEB_PID_FILE:-/tmp/vh-local-web.pid}"
RELAY_PID_FILE="${RELAY_PID_FILE:-/tmp/vh-local-relay.pid}"
READY_TIMEOUT_SECS="${READY_TIMEOUT_SECS:-45}"

info() { echo "[live-local-stack] $*"; }
warn() { echo "[live-local-stack][warn] $*" >&2; }
die() { echo "[live-local-stack][error] $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

read_pid_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    cat "$file"
  fi
}

is_pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

kill_pid_file() {
  local file="$1"
  local pid
  pid="$(read_pid_file "$file" || true)"
  if is_pid_alive "$pid"; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 0.5
    if is_pid_alive "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$file"
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    info "Stopping existing process(es) on tcp:${port}"
    xargs kill <<<"$pids" >/dev/null 2>&1 || true
  fi
}

wait_for_http() {
  local url="$1"
  local timeout="$2"
  local started
  started="$(date +%s)"
  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( $(date +%s) - started >= timeout )); then
      return 1
    fi
    sleep 1
  done
}

load_profile_env() {
  [[ -f "$ENV_FILE" ]] || die "Env profile not found: $ENV_FILE"
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a

  export VITE_E2E_MODE=false
  export VITE_INVITE_ONLY_ENABLED=false
  export VITE_VH_ANALYSIS_PIPELINE=true
  export VITE_VH_BIAS_TABLE_V2=true
  export VITE_NEWS_RUNTIME_ENABLED=true
  export VITE_NEWS_RUNTIME_ROLE=ingester
  export VITE_NEWS_BRIDGE_ENABLED=true
  export VITE_NEWS_POLL_INTERVAL_MS="${VITE_NEWS_POLL_INTERVAL_MS:-10000}"
  export VITE_GUN_PEERS="${VITE_GUN_PEERS:-[\"http://localhost:${RELAY_PORT}/gun\"]}"
  export VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS="${VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS:-90000}"
  export ANALYSIS_RELAY_UPSTREAM_URL="${ANALYSIS_RELAY_UPSTREAM_URL:-https://api.openai.com/v1/chat/completions}"
  export ANALYSIS_RELAY_API_KEY="${ANALYSIS_RELAY_API_KEY:-${OPENAI_API_KEY:-}}"
  export ANALYSIS_RELAY_MODEL="${ANALYSIS_RELAY_MODEL:-${VITE_ANALYSIS_MODEL:-gpt-5-nano}}"

  [[ -n "${ANALYSIS_RELAY_API_KEY:-}" ]] \
    || die "Missing ANALYSIS_RELAY_API_KEY (or OPENAI_API_KEY). Analysis will not materialize."
}

start_relay() {
  info "Starting local Gun relay on :${RELAY_PORT}"
  nohup bash -lc "cd \"$ROOT\" && exec env GUN_PORT=\"$RELAY_PORT\" node infra/relay/server.js" \
    >"$RELAY_LOG" 2>&1 < /dev/null &
  echo "$!" > "$RELAY_PID_FILE"
}

start_web() {
  info "Starting web-pwa on :${WEB_PORT} with live profile env"
  nohup bash -lc "cd \"$ROOT\" && exec pnpm --filter @vh/web-pwa dev --port \"$WEB_PORT\" --strictPort" \
    >"$WEB_LOG" 2>&1 < /dev/null &
  echo "$!" > "$WEB_PID_FILE"
}

stack_up() {
  require_cmd pnpm
  require_cmd node
  require_cmd curl
  require_cmd lsof

  load_profile_env

  kill_pid_file "$WEB_PID_FILE"
  kill_pid_file "$RELAY_PID_FILE"
  kill_port "$WEB_PORT"
  kill_port "$RELAY_PORT"

  start_relay
  start_web

  wait_for_http "http://localhost:${WEB_PORT}/" "$READY_TIMEOUT_SECS" \
    || die "Web server did not become ready in ${READY_TIMEOUT_SECS}s (log: $WEB_LOG)"

  info "Stack ready"
  info "App URL:  http://localhost:${WEB_PORT}/"
  info "Relay:    http://localhost:${RELAY_PORT}/gun"
  info "Web log:  $WEB_LOG"
  info "Relay log:$RELAY_LOG"
}

stack_down() {
  kill_pid_file "$WEB_PID_FILE"
  kill_pid_file "$RELAY_PID_FILE"
  kill_port "$WEB_PORT"
  kill_port "$RELAY_PORT"
  info "Stack stopped"
}

stack_status() {
  local web_pid relay_pid
  web_pid="$(read_pid_file "$WEB_PID_FILE" || true)"
  relay_pid="$(read_pid_file "$RELAY_PID_FILE" || true)"

  if is_pid_alive "$web_pid"; then
    info "web-pwa running (pid=$web_pid, port=${WEB_PORT})"
  else
    warn "web-pwa not running"
  fi

  if is_pid_alive "$relay_pid"; then
    info "relay running (pid=$relay_pid, port=${RELAY_PORT})"
  else
    warn "relay not running"
  fi
}

stack_smoke() {
  load_profile_env
  (
    cd "$ROOT/packages/e2e"
    CI=1 pnpm exec playwright test --config=playwright.live.config.ts \
      src/live/vote-mutation.live.spec.ts src/live/three-user-convergence.live.spec.ts
    CI=1 VH_LIVE_MATRIX_STABILITY_RUNS=1 pnpm test:live:matrix:strict:stability
  )
}

case "${1:-up}" in
  up) stack_up ;;
  down) stack_down ;;
  status) stack_status ;;
  smoke) stack_smoke ;;
  *)
    die "Usage: $0 [up|down|status|smoke]"
    ;;
esac
