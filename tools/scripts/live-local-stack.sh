#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/packages/e2e/.env.dev-small}"
STACK_MODE="${VH_LOCAL_STACK_FEED_MODE:-fixture}"

WEB_PORT="${WEB_PORT:-2048}"
RELAY_PORT="${RELAY_PORT:-7777}"
STORYCLUSTER_PORT="${STORYCLUSTER_PORT:-4310}"
FIXTURE_PORT="${FIXTURE_PORT:-8788}"

WEB_LOG="${WEB_LOG:-/tmp/vh-local-web.log}"
RELAY_LOG="${RELAY_LOG:-/tmp/vh-local-relay.log}"
DAEMON_LOG="${DAEMON_LOG:-/tmp/vh-local-news-daemon.log}"
STORYCLUSTER_LOG="${STORYCLUSTER_LOG:-/tmp/vh-local-storycluster.log}"
FIXTURE_LOG="${FIXTURE_LOG:-/tmp/vh-local-fixture-feed.log}"

WEB_PID_FILE="${WEB_PID_FILE:-/tmp/vh-local-web.pid}"
RELAY_PID_FILE="${RELAY_PID_FILE:-/tmp/vh-local-relay.pid}"
DAEMON_PID_FILE="${DAEMON_PID_FILE:-/tmp/vh-local-news-daemon.pid}"
STORYCLUSTER_PID_FILE="${STORYCLUSTER_PID_FILE:-/tmp/vh-local-storycluster.pid}"
FIXTURE_PID_FILE="${FIXTURE_PID_FILE:-/tmp/vh-local-fixture-feed.pid}"

RELAY_DATA_PATH="${RELAY_DATA_PATH:-$ROOT/.tmp/live-local-stack/relay-data}"
STORYCLUSTER_STATE_DIR="${STORYCLUSTER_STATE_DIR:-$ROOT/.tmp/live-local-stack/storycluster-state}"
STORYCLUSTER_AUTH_TOKEN="${STORYCLUSTER_AUTH_TOKEN:-vh-local-storycluster-token}"
STORYCLUSTER_LOADER_PATH="${STORYCLUSTER_LOADER_PATH:-$ROOT/tools/node/esm-resolve-loader.mjs}"
READY_TIMEOUT_SECS="${READY_TIMEOUT_SECS:-45}"
DAEMON_READY_TIMEOUT_SECS="${DAEMON_READY_TIMEOUT_SECS:-90}"

info() { echo "[live-local-stack] $*"; }
warn() { echo "[live-local-stack][warn] $*" >&2; }
die() { echo "[live-local-stack][error] $*" >&2; exit 1; }

spawn_detached() {
  local pid_file="$1"
  local log_file="$2"
  shift 2
  node "$ROOT/tools/scripts/spawn-detached.mjs" "$pid_file" "$ROOT" "$log_file" "$@"
}

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
    sleep 0.5
    pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      xargs kill -9 <<<"$pids" >/dev/null 2>&1 || true
    fi
  fi
}

wait_for_http() {
  local url="$1"
  local timeout="$2"
  local -a curl_args=()
  if (( $# > 2 )); then
    curl_args=("${@:3}")
  fi
  local started
  started="$(date +%s)"
  while true; do
    if (( ${#curl_args[@]} > 0 )); then
      if curl -fsS "${curl_args[@]}" "$url" >/dev/null 2>&1; then
        return 0
      fi
    elif curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( $(date +%s) - started >= timeout )); then
      return 1
    fi
    sleep 1
  done
}

wait_for_log() {
  local file="$1"
  local pattern="$2"
  local timeout="$3"
  local started
  started="$(date +%s)"
  while true; do
    if [[ -f "$file" ]] && grep -Eq "$pattern" "$file"; then
      return 0
    fi
    if (( $(date +%s) - started >= timeout )); then
      return 1
    fi
    sleep 1
  done
}

validate_stack_mode() {
  case "$STACK_MODE" in
    fixture|public) ;;
    *)
      die "Unsupported VH_LOCAL_STACK_FEED_MODE: $STACK_MODE (expected fixture or public)"
      ;;
  esac
}

fixture_feed_sources_json() {
  cat <<JSON
[{"id":"guardian-us","name":"The Guardian US","displayName":"The Guardian","rssUrl":"http://127.0.0.1:${FIXTURE_PORT}/rss/guardian-us","perspectiveTag":"progressive","iconKey":"guardian","enabled":true},{"id":"cbs-politics","name":"CBS News Politics","displayName":"CBS News","rssUrl":"http://127.0.0.1:${FIXTURE_PORT}/rss/cbs-politics","perspectiveTag":"progressive","iconKey":"cbs","enabled":true},{"id":"bbc-us-canada","name":"BBC US & Canada","displayName":"BBC","rssUrl":"http://127.0.0.1:${FIXTURE_PORT}/rss/bbc-us-canada","perspectiveTag":"international-wire","iconKey":"bbc","enabled":true},{"id":"nypost-politics","name":"New York Post Politics","displayName":"New York Post","rssUrl":"http://127.0.0.1:${FIXTURE_PORT}/rss/nypost-politics","perspectiveTag":"conservative","iconKey":"nypost","enabled":true},{"id":"fox-latest","name":"Fox News","displayName":"Fox News","rssUrl":"http://127.0.0.1:${FIXTURE_PORT}/rss/fox-latest","perspectiveTag":"conservative","iconKey":"fox","enabled":true}]
JSON
}

load_profile_env() {
  validate_stack_mode
  [[ -f "$ENV_FILE" ]] || die "Env profile not found: $ENV_FILE"

  unset \
    VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS \
    VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS \
    VITE_NEWS_BRIDGE_REFRESH_BACKOFF_MS \
    VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS \
    VITE_VH_GUN_PUT_ACK_TIMEOUT_MS \
    VITE_VH_GUN_READ_TIMEOUT_MS \
    VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS \
    VITE_VH_ANALYSIS_PENDING_READ_TIMEOUT_MS \
    ANALYSIS_RELAY_MODEL

  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a

  export VITE_E2E_MODE=false
  export VITE_VH_ANALYSIS_PIPELINE=true
  export VITE_NEWS_RUNTIME_ENABLED=false
  export VITE_NEWS_RUNTIME_ROLE=consumer
  export VITE_NEWS_BRIDGE_ENABLED=true
  export VITE_GUN_PEERS="[\"http://localhost:${RELAY_PORT}/gun\"]"
  export VH_GUN_PEERS="${VH_GUN_PEERS:-$VITE_GUN_PEERS}"
  export VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS="${VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS:-7500}"
  export VITE_VH_GUN_PUT_ACK_TIMEOUT_MS="${VITE_VH_GUN_PUT_ACK_TIMEOUT_MS:-3000}"
  export VITE_VH_GUN_READ_TIMEOUT_MS="${VITE_VH_GUN_READ_TIMEOUT_MS:-4000}"
  export VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS="${VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS:-8000}"
  export VITE_VH_ANALYSIS_PENDING_READ_TIMEOUT_MS="${VITE_VH_ANALYSIS_PENDING_READ_TIMEOUT_MS:-500}"
  export VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS="${VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS:-90000}"
  export VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS="${VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS:-3}"
  export VITE_NEWS_BRIDGE_REFRESH_BACKOFF_MS="${VITE_NEWS_BRIDGE_REFRESH_BACKOFF_MS:-500}"
  export ANALYSIS_RELAY_UPSTREAM_URL="${ANALYSIS_RELAY_UPSTREAM_URL:-https://api.openai.com/v1/chat/completions}"
  export ANALYSIS_RELAY_API_KEY="${ANALYSIS_RELAY_API_KEY:-${OPENAI_API_KEY:-}}"
  export ANALYSIS_RELAY_MODEL="${ANALYSIS_RELAY_MODEL:-${VITE_ANALYSIS_MODEL:-gpt-5-nano}}"

  export VH_STORYCLUSTER_REMOTE_URL="http://127.0.0.1:${STORYCLUSTER_PORT}/cluster"
  export VH_STORYCLUSTER_REMOTE_HEALTH_URL="http://127.0.0.1:${STORYCLUSTER_PORT}/ready"
  export VH_STORYCLUSTER_REMOTE_TIMEOUT_MS="${VH_STORYCLUSTER_REMOTE_TIMEOUT_MS:-180000}"
  export VH_STORYCLUSTER_REMOTE_AUTH_TOKEN="$STORYCLUSTER_AUTH_TOKEN"
  export VH_STORYCLUSTER_REMOTE_AUTH_HEADER='authorization'
  export VH_STORYCLUSTER_REMOTE_AUTH_SCHEME='Bearer'
  export VH_NEWS_DAEMON_HOLDER_ID="${VH_NEWS_DAEMON_HOLDER_ID:-vh-local-news-daemon}"

  if [[ "$STACK_MODE" == 'fixture' ]]; then
    export VH_DAEMON_FEED_USE_FIXTURE_FEED=true
    export VH_STORYCLUSTER_USE_TEST_PROVIDER=true
    export VITE_NEWS_POLL_INTERVAL_MS="${VITE_NEWS_POLL_INTERVAL_MS:-5000}"
    export VITE_NEWS_FEED_SOURCES="$(fixture_feed_sources_json)"
  else
    unset VH_DAEMON_FEED_USE_FIXTURE_FEED
    unset VH_STORYCLUSTER_USE_TEST_PROVIDER
    unset VITE_NEWS_FEED_SOURCES
    export VITE_NEWS_POLL_INTERVAL_MS="${VITE_NEWS_POLL_INTERVAL_MS:-10000}"
  fi

  [[ -n "${ANALYSIS_RELAY_API_KEY:-}" ]] \
    || die "Missing ANALYSIS_RELAY_API_KEY (or OPENAI_API_KEY). Analysis will not materialize."
}

start_storycluster() {
  mkdir -p "$(dirname "$STORYCLUSTER_STATE_DIR")"
  if [[ "$STACK_MODE" == 'fixture' ]]; then
    rm -rf "$STORYCLUSTER_STATE_DIR"
  fi
  info "Building and starting local StoryCluster on :${STORYCLUSTER_PORT}"
  pnpm --filter @vh/storycluster-engine build > /tmp/vh-local-storycluster-build.log 2>&1
  : > "$STORYCLUSTER_LOG"
  env \
    VH_STORYCLUSTER_USE_TEST_PROVIDER="${VH_STORYCLUSTER_USE_TEST_PROVIDER:-false}" \
    VH_STORYCLUSTER_VECTOR_BACKEND=memory \
    VH_STORYCLUSTER_STATE_DIR="$STORYCLUSTER_STATE_DIR" \
    VH_STORYCLUSTER_SERVER_PORT="$STORYCLUSTER_PORT" \
    VH_STORYCLUSTER_SERVER_AUTH_TOKEN="$STORYCLUSTER_AUTH_TOKEN" \
    node "$ROOT/tools/scripts/spawn-detached.mjs" \
    "$STORYCLUSTER_PID_FILE" \
    "$ROOT" \
    "$STORYCLUSTER_LOG" \
    node \
    --loader \
    "$STORYCLUSTER_LOADER_PATH" \
    "$ROOT/tools/scripts/start-storycluster-local.mjs"
}

start_fixture_feed() {
  info "Starting fixture feed server on :${FIXTURE_PORT}"
  : > "$FIXTURE_LOG"
  env VH_DAEMON_FEED_FIXTURE_PORT="$FIXTURE_PORT" \
    node "$ROOT/tools/scripts/spawn-detached.mjs" \
    "$FIXTURE_PID_FILE" \
    "$ROOT" \
    "$FIXTURE_LOG" \
    node \
    packages/e2e/src/live/daemon-feed-fixtures.mjs
}

start_relay() {
  mkdir -p "$(dirname "$RELAY_DATA_PATH")"
  rm -rf "$RELAY_DATA_PATH"
  info "Starting local Gun relay on :${RELAY_PORT}"
  : > "$RELAY_LOG"
  env GUN_PORT="$RELAY_PORT" GUN_FILE="$RELAY_DATA_PATH" \
    node "$ROOT/tools/scripts/spawn-detached.mjs" \
    "$RELAY_PID_FILE" \
    "$ROOT" \
    "$RELAY_LOG" \
    node \
    infra/relay/server.js
}

start_web() {
  info "Starting web-pwa on :${WEB_PORT} with local bundle-consumer wiring"
  : > "$WEB_LOG"
  spawn_detached \
    "$WEB_PID_FILE" \
    "$WEB_LOG" \
    pnpm \
    --filter \
    @vh/web-pwa \
    dev \
    --host \
    127.0.0.1 \
    --port \
    "$WEB_PORT" \
    --strictPort
}

start_daemon() {
  info "Starting news-aggregator daemon (canonical ingester)"
  : > "$DAEMON_LOG"
  spawn_detached \
    "$DAEMON_PID_FILE" \
    "$DAEMON_LOG" \
    pnpm \
    --filter \
    @vh/news-aggregator \
    daemon
}

stack_up() {
  require_cmd pnpm
  require_cmd node
  require_cmd curl
  require_cmd lsof

  load_profile_env

  kill_pid_file "$WEB_PID_FILE"
  kill_pid_file "$RELAY_PID_FILE"
  kill_pid_file "$DAEMON_PID_FILE"
  kill_pid_file "$STORYCLUSTER_PID_FILE"
  kill_pid_file "$FIXTURE_PID_FILE"
  kill_port "$WEB_PORT"
  kill_port "$RELAY_PORT"
  kill_port "$STORYCLUSTER_PORT"
  kill_port "$FIXTURE_PORT"

  start_storycluster
  wait_for_http \
    "http://127.0.0.1:${STORYCLUSTER_PORT}/ready" \
    "$READY_TIMEOUT_SECS" \
    -H "authorization: Bearer ${STORYCLUSTER_AUTH_TOKEN}" \
    || die "StoryCluster did not become ready in ${READY_TIMEOUT_SECS}s (log: $STORYCLUSTER_LOG)"

  if [[ "$STACK_MODE" == 'fixture' ]]; then
    start_fixture_feed
    wait_for_http "http://127.0.0.1:${FIXTURE_PORT}/health" "$READY_TIMEOUT_SECS" \
      || die "Fixture feed did not become ready in ${READY_TIMEOUT_SECS}s (log: $FIXTURE_LOG)"
  fi

  start_relay
  wait_for_http "http://127.0.0.1:${RELAY_PORT}" "$READY_TIMEOUT_SECS" \
    || die "Relay did not become ready in ${READY_TIMEOUT_SECS}s (log: $RELAY_LOG)"

  start_daemon
  wait_for_log "$DAEMON_LOG" "\\[vh:news-daemon\\] runtime started" "$DAEMON_READY_TIMEOUT_SECS" \
    || die "News daemon runtime did not start in ${DAEMON_READY_TIMEOUT_SECS}s (log: $DAEMON_LOG)"

  start_web
  wait_for_http "http://127.0.0.1:${WEB_PORT}/" "$READY_TIMEOUT_SECS" \
    || die "Web server did not become ready in ${READY_TIMEOUT_SECS}s (log: $WEB_LOG)"
  wait_for_http "http://127.0.0.1:${WEB_PORT}/api/analyze/config" "$READY_TIMEOUT_SECS" \
    || die "Analysis relay config route did not become ready in ${READY_TIMEOUT_SECS}s (log: $WEB_LOG)"

  info "Stack ready"
  info "Mode:     ${STACK_MODE}"
  info "App URL:  http://127.0.0.1:${WEB_PORT}/"
  info "Relay:    http://127.0.0.1:${RELAY_PORT}/gun"
  info "Cluster:  http://127.0.0.1:${STORYCLUSTER_PORT}/cluster"
  if [[ "$STACK_MODE" == 'fixture' ]]; then
    info "Feed:     http://127.0.0.1:${FIXTURE_PORT}/ (fixture bundled-feed mode)"
  else
    info "Feed:     public/admitted source surface"
  fi
  info "Daemon log:$DAEMON_LOG"
  info "Web log:  $WEB_LOG"
  info "Relay log:$RELAY_LOG"
}

stack_down() {
  kill_pid_file "$WEB_PID_FILE"
  kill_pid_file "$RELAY_PID_FILE"
  kill_pid_file "$DAEMON_PID_FILE"
  kill_pid_file "$STORYCLUSTER_PID_FILE"
  kill_pid_file "$FIXTURE_PID_FILE"
  kill_port "$WEB_PORT"
  kill_port "$RELAY_PORT"
  kill_port "$STORYCLUSTER_PORT"
  kill_port "$FIXTURE_PORT"
  info "Stack stopped"
}

stack_status() {
  info "mode=${STACK_MODE}"
  for label in \
    "web-pwa:$WEB_PID_FILE:${WEB_PORT}" \
    "relay:$RELAY_PID_FILE:${RELAY_PORT}" \
    "news-daemon:$DAEMON_PID_FILE:-" \
    "storycluster:$STORYCLUSTER_PID_FILE:${STORYCLUSTER_PORT}" \
    "fixture-feed:$FIXTURE_PID_FILE:${FIXTURE_PORT}"; do
    IFS=':' read -r name pid_file port <<<"$label"
    local_pid="$(read_pid_file "$pid_file" || true)"
    if is_pid_alive "$local_pid"; then
      if [[ "$name" == 'fixture-feed' && "$STACK_MODE" != 'fixture' ]]; then
        continue
      fi
      if [[ "$port" == '-' ]]; then
        info "$name running (pid=$local_pid)"
      else
        info "$name running (pid=$local_pid, port=$port)"
      fi
    else
      if [[ "$name" == 'fixture-feed' && "$STACK_MODE" != 'fixture' ]]; then
        continue
      fi
      warn "$name not running"
    fi
  done
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
