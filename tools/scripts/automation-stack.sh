#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_log_tag="automation-stack"
source "$ROOT/tools/scripts/local-stack-lib.sh"

# --- automation-stack constants ---
AUTO_DIR="${AUTO_DIR:-$ROOT/.tmp/automation-stack}"
LOCK_FILE="$AUTO_DIR/lock"
ENV_FILE="${ENV_FILE:-$ROOT/packages/e2e/.env.dev-small}"

AUTO_WEB_PORT="${AUTO_WEB_PORT:-2099}"
AUTO_RELAY_PORT="${AUTO_RELAY_PORT:-7777}"
AUTO_STORYCLUSTER_PORT="${AUTO_STORYCLUSTER_PORT:-4310}"
AUTO_SNAPSHOT_PORT="${AUTO_SNAPSHOT_PORT:-8790}"

AUTO_WEB_LOG="$AUTO_DIR/logs/web.log"
AUTO_RELAY_LOG="$AUTO_DIR/logs/relay.log"
AUTO_STORYCLUSTER_LOG="$AUTO_DIR/logs/storycluster.log"
AUTO_SNAPSHOT_LOG="$AUTO_DIR/logs/snapshot.log"

AUTO_WEB_PID="$AUTO_DIR/web.pid"
AUTO_RELAY_PID="$AUTO_DIR/relay.pid"
AUTO_STORYCLUSTER_PID="$AUTO_DIR/storycluster.pid"
AUTO_SNAPSHOT_PID="$AUTO_DIR/snapshot.pid"

AUTO_RELAY_DATA="$AUTO_DIR/relay-data"
AUTO_STORYCLUSTER_STATE="$AUTO_DIR/storycluster-state"

# --- lock ---
acquire_lock() {
  mkdir -p "$AUTO_DIR"
  if ! /usr/bin/shlock -f "$LOCK_FILE" -p $$; then
    die "Could not acquire lock ($LOCK_FILE). Another automation-stack operation may be running."
  fi
  trap 'rm -f "$LOCK_FILE"' EXIT
}

# --- rebuild detection ---
needs_rebuild() {
  local state_file="$AUTO_DIR/state.json"
  [[ -f "$state_file" ]] || return 0

  # Check web build exists
  [[ -f "$ROOT/apps/web-pwa/dist/index.html" ]] || return 0
  [[ -f "$ROOT/services/storycluster-engine/dist/server.js" ]] || return 0

  # Compare git HEAD (use $ROOT to get canonical repo HEAD, not worktree)
  local current_head state_head
  current_head="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  state_head="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$state_file','utf8')).gitHead||'')}catch{console.log('')}" 2>/dev/null || echo "")"

  if [[ "$current_head" != "$state_head" ]]; then
    info "Git HEAD changed: ${state_head:0:8} -> ${current_head:0:8}"
    return 0
  fi

  return 1
}

# --- health check ---
run_health() {
  node "$ROOT/tools/scripts/automation-stack-health.mjs" \
    --state-dir "$AUTO_DIR" \
    --snapshot-port "$AUTO_SNAPSHOT_PORT" \
    --relay-port "$AUTO_RELAY_PORT" \
    --storycluster-port "$AUTO_STORYCLUSTER_PORT" \
    --web-port "$AUTO_WEB_PORT" \
    --snapshot-pid-file "$AUTO_SNAPSHOT_PID" \
    --relay-pid-file "$AUTO_RELAY_PID" \
    --storycluster-pid-file "$AUTO_STORYCLUSTER_PID" \
    --web-pid-file "$AUTO_WEB_PID" \
    --storycluster-auth-token "$STORYCLUSTER_AUTH_TOKEN" \
    "$@"
}

# --- env loading (validated-snapshot mode only) ---
load_automation_env() {
  [[ -f "$ENV_FILE" ]] || die "Env profile not found: $ENV_FILE"

  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a

  # Validated-snapshot mode: no runtime, no bridge, snapshot-driven
  export VITE_E2E_MODE=false
  export VITE_VH_ANALYSIS_PIPELINE=false
  export VITE_NEWS_RUNTIME_ENABLED=false
  export VITE_NEWS_RUNTIME_ROLE=consumer
  export VITE_NEWS_BRIDGE_ENABLED=false
  export VITE_SYNTHESIS_BRIDGE_ENABLED=false
  export VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL="http://127.0.0.1:${AUTO_SNAPSHOT_PORT}/snapshot.json"
  export VITE_GUN_PEERS="[\"http://localhost:${AUTO_RELAY_PORT}/gun\"]"
  export VH_STORYCLUSTER_VECTOR_BACKEND=memory
}

# --- kill all automation services ---
kill_automation_services() {
  kill_pid_file "$AUTO_WEB_PID"
  kill_pid_file "$AUTO_RELAY_PID"
  kill_pid_file "$AUTO_STORYCLUSTER_PID"
  kill_pid_file "$AUTO_SNAPSHOT_PID"
  kill_port "$AUTO_WEB_PORT"
  kill_port "$AUTO_RELAY_PORT"
  kill_port "$AUTO_STORYCLUSTER_PORT"
  kill_port "$AUTO_SNAPSHOT_PORT"
}

# --- subcommands ---

do_ensure() {
  mkdir -p "$AUTO_DIR/logs"
  acquire_lock

  if ! needs_rebuild; then
    info "Stack HEAD matches, checking health..."
    if run_health --write-state >/dev/null 2>&1; then
      info "Stack is healthy, nothing to do."
      exit 0
    fi
    info "Stack unhealthy, rebuilding..."
  fi

  load_automation_env
  kill_automation_services

  info "Building storycluster-engine..."
  pnpm --filter @vh/storycluster-engine build > "$AUTO_DIR/logs/storycluster-build.log" 2>&1

  # Build web for vite preview
  info "Building web-pwa..."
  pnpm --filter @vh/web-pwa build > "$AUTO_DIR/logs/web-build.log" 2>&1

  # Start storycluster for publisher-canary / daemon-first remote clustering
  mkdir -p "$AUTO_STORYCLUSTER_STATE"
  info "Starting StoryCluster on :${AUTO_STORYCLUSTER_PORT}"
  : > "$AUTO_STORYCLUSTER_LOG"
  export VH_STORYCLUSTER_SERVER_PORT="$AUTO_STORYCLUSTER_PORT"
  export VH_STORYCLUSTER_SERVER_AUTH_TOKEN="$STORYCLUSTER_AUTH_TOKEN"
  export VH_STORYCLUSTER_STATE_DIR="$AUTO_STORYCLUSTER_STATE"
  spawn_detached \
    "$AUTO_STORYCLUSTER_PID" \
    "$AUTO_STORYCLUSTER_LOG" \
    node \
    --loader \
    "$STORYCLUSTER_LOADER_PATH" \
    tools/scripts/start-storycluster-local.mjs
  wait_for_http \
    "http://127.0.0.1:${AUTO_STORYCLUSTER_PORT}/ready" \
    "$READY_TIMEOUT_SECS" \
    -H "authorization: Bearer ${STORYCLUSTER_AUTH_TOKEN}" \
    || die "StoryCluster did not become ready in ${READY_TIMEOUT_SECS}s (log: $AUTO_STORYCLUSTER_LOG)"

  # Start snapshot server
  info "Starting validated snapshot server on :${AUTO_SNAPSHOT_PORT}"
  : > "$AUTO_SNAPSHOT_LOG"
  export VH_VALIDATED_SNAPSHOT_PORT="$AUTO_SNAPSHOT_PORT"
  spawn_detached \
    "$AUTO_SNAPSHOT_PID" \
    "$AUTO_SNAPSHOT_LOG" \
    node \
    packages/e2e/src/live/daemon-feed-validated-snapshot-server.mjs
  wait_for_http "http://127.0.0.1:${AUTO_SNAPSHOT_PORT}/health" "$READY_TIMEOUT_SECS" \
    || die "Snapshot server did not become ready in ${READY_TIMEOUT_SECS}s (log: $AUTO_SNAPSHOT_LOG)"

  # Start relay
  mkdir -p "$AUTO_RELAY_DATA"
  info "Starting Gun relay on :${AUTO_RELAY_PORT}"
  : > "$AUTO_RELAY_LOG"
  export GUN_PORT="$AUTO_RELAY_PORT"
  export GUN_FILE="$AUTO_RELAY_DATA"
  spawn_detached \
    "$AUTO_RELAY_PID" \
    "$AUTO_RELAY_LOG" \
    node \
    infra/relay/server.js
  wait_for_http "http://127.0.0.1:${AUTO_RELAY_PORT}" "$READY_TIMEOUT_SECS" \
    || die "Relay did not become ready in ${READY_TIMEOUT_SECS}s (log: $AUTO_RELAY_LOG)"

  # Start web preview
  info "Starting web preview on :${AUTO_WEB_PORT}"
  : > "$AUTO_WEB_LOG"
  spawn_detached \
    "$AUTO_WEB_PID" \
    "$AUTO_WEB_LOG" \
    pnpm \
    --filter \
    @vh/web-pwa \
    exec \
    vite \
    preview \
    --host \
    127.0.0.1 \
    --port \
    "$AUTO_WEB_PORT" \
    --strictPort
  wait_for_http "http://127.0.0.1:${AUTO_WEB_PORT}/" "$READY_TIMEOUT_SECS" \
    || die "Web preview did not become ready in ${READY_TIMEOUT_SECS}s (log: $AUTO_WEB_LOG)"

  # Write state
  local current_head
  current_head="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  run_health --write-state --git-head "$current_head" || true

  info "Automation stack ready"
  info "Web:      http://127.0.0.1:${AUTO_WEB_PORT}/"
  info "Relay:    http://127.0.0.1:${AUTO_RELAY_PORT}/gun"
  info "Cluster:  http://127.0.0.1:${AUTO_STORYCLUSTER_PORT}/cluster"
  info "Snapshot: http://127.0.0.1:${AUTO_SNAPSHOT_PORT}/health"
}

do_restart() {
  rm -f "$AUTO_DIR/state.json"
  do_ensure
}

do_stop() {
  acquire_lock
  kill_automation_services
  rm -f "$AUTO_DIR/state.json"
  info "Automation stack stopped"
}

do_status() {
  run_health --write-state
}

# --- dispatch ---
case "${1:-ensure}" in
  ensure)     do_ensure ;;
  restart)    do_restart ;;
  stop)       do_stop ;;
  status)     do_status ;;
  *)
    die "Usage: $0 [ensure|restart|stop|status]"
    ;;
esac
