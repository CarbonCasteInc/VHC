#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_log_tag="live-local-stack"
source "$ROOT/tools/scripts/local-stack-lib.sh"

ENV_FILE="${ENV_FILE:-$ROOT/packages/e2e/.env.dev-small}"
STACK_MODE_FILE="${STACK_MODE_FILE:-/tmp/vh-local-stack.mode}"
STACK_ANALYSIS_MODE_FILE="${STACK_ANALYSIS_MODE_FILE:-/tmp/vh-local-stack.analysis.mode}"
STACK_MODE="${VH_LOCAL_STACK_FEED_MODE:-}"
if [[ -z "$STACK_MODE" && -f "$STACK_MODE_FILE" ]]; then
  STACK_MODE="$(cat "$STACK_MODE_FILE")"
fi
STACK_MODE="${STACK_MODE:-fixture}"
STACK_ANALYSIS_MODE="${VH_LOCAL_STACK_ANALYSIS_MODE:-}"
if [[ -z "$STACK_ANALYSIS_MODE" && -f "$STACK_ANALYSIS_MODE_FILE" ]]; then
  STACK_ANALYSIS_MODE="$(cat "$STACK_ANALYSIS_MODE_FILE")"
fi
STACK_ANALYSIS_MODE="${STACK_ANALYSIS_MODE:-remote}"

WEB_PORT="${WEB_PORT:-2048}"
RELAY_PORT="${RELAY_PORT:-7777}"
STORYCLUSTER_PORT="${STORYCLUSTER_PORT:-4310}"
FIXTURE_PORT="${FIXTURE_PORT:-8788}"
SNAPSHOT_PORT="${SNAPSHOT_PORT:-8790}"
ANALYSIS_STUB_PORT="${ANALYSIS_STUB_PORT:-9040}"

WEB_LOG="${WEB_LOG:-/tmp/vh-local-web.log}"
RELAY_LOG="${RELAY_LOG:-/tmp/vh-local-relay.log}"
DAEMON_LOG="${DAEMON_LOG:-/tmp/vh-local-news-daemon.log}"
STORYCLUSTER_LOG="${STORYCLUSTER_LOG:-/tmp/vh-local-storycluster.log}"
FIXTURE_LOG="${FIXTURE_LOG:-/tmp/vh-local-fixture-feed.log}"
SNAPSHOT_LOG="${SNAPSHOT_LOG:-/tmp/vh-local-validated-snapshot.log}"
ANALYSIS_STUB_LOG="${ANALYSIS_STUB_LOG:-/tmp/vh-local-analysis-stub.log}"

WEB_PID_FILE="${WEB_PID_FILE:-/tmp/vh-local-web.pid}"
RELAY_PID_FILE="${RELAY_PID_FILE:-/tmp/vh-local-relay.pid}"
DAEMON_PID_FILE="${DAEMON_PID_FILE:-/tmp/vh-local-news-daemon.pid}"
STORYCLUSTER_PID_FILE="${STORYCLUSTER_PID_FILE:-/tmp/vh-local-storycluster.pid}"
FIXTURE_PID_FILE="${FIXTURE_PID_FILE:-/tmp/vh-local-fixture-feed.pid}"
SNAPSHOT_PID_FILE="${SNAPSHOT_PID_FILE:-/tmp/vh-local-validated-snapshot.pid}"
ANALYSIS_STUB_PID_FILE="${ANALYSIS_STUB_PID_FILE:-/tmp/vh-local-analysis-stub.pid}"

RELAY_DATA_PATH="${RELAY_DATA_PATH:-$ROOT/.tmp/live-local-stack/relay-data}"
STORYCLUSTER_STATE_DIR="${STORYCLUSTER_STATE_DIR:-$ROOT/.tmp/live-local-stack/storycluster-state}"

artifact_root_has_snapshot() {
  local artifact_root="$1"
  [[ -d "$artifact_root" ]] || return 1
  [[ -n "$(find "$artifact_root" -maxdepth 2 -name published-store-snapshot.json -print -quit 2>/dev/null)" ]]
}

resolve_publisher_canary_artifact_root() {
  if [[ -n "${VH_VALIDATED_SNAPSHOT_ARTIFACT_ROOT:-}" ]]; then
    printf '%s\n' "$VH_VALIDATED_SNAPSHOT_ARTIFACT_ROOT"
    return 0
  fi

  local current_candidate="$ROOT/.tmp/daemon-feed-publisher-canary"
  if artifact_root_has_snapshot "$current_candidate"; then
    printf '%s\n' "$current_candidate"
    return 0
  fi

  local main_worktree
  main_worktree="$(
    git -C "$ROOT" worktree list --porcelain 2>/dev/null \
      | awk '/^worktree / { wt=$0; sub(/^worktree /, "", wt) } /^branch refs\/heads\/main$/ { print wt; exit }'
  )"
  if [[ -n "$main_worktree" ]]; then
    local main_candidate="$main_worktree/.tmp/daemon-feed-publisher-canary"
    if artifact_root_has_snapshot "$main_candidate"; then
      printf '%s\n' "$main_candidate"
      return 0
    fi
  fi

  printf '%s\n' "$current_candidate"
}

validate_stack_mode() {
  case "$STACK_MODE" in
    fixture|public|validated-snapshot) ;;
    *)
      die "Unsupported VH_LOCAL_STACK_FEED_MODE: $STACK_MODE (expected fixture, public, or validated-snapshot)"
      ;;
  esac
  case "$STACK_ANALYSIS_MODE" in
    remote|stub) ;;
    *)
      die "Unsupported VH_LOCAL_STACK_ANALYSIS_MODE: $STACK_ANALYSIS_MODE (expected remote or stub)"
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
    VITE_VH_GUN_LOCAL_STORAGE \
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
  export VITE_GUN_PEERS="[\"http://127.0.0.1:${RELAY_PORT}/gun\"]"
  export VH_GUN_PEERS="${VH_GUN_PEERS:-$VITE_GUN_PEERS}"
  export VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS="${VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS:-7500}"
  export VITE_VH_GUN_PUT_ACK_TIMEOUT_MS="${VITE_VH_GUN_PUT_ACK_TIMEOUT_MS:-3000}"
  export VITE_VH_GUN_READ_TIMEOUT_MS="${VITE_VH_GUN_READ_TIMEOUT_MS:-4000}"
  export VITE_VH_GUN_LOCAL_STORAGE="${VITE_VH_GUN_LOCAL_STORAGE:-false}"
  export VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS="${VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS:-8000}"
  export VITE_VH_ANALYSIS_PENDING_READ_TIMEOUT_MS="${VITE_VH_ANALYSIS_PENDING_READ_TIMEOUT_MS:-500}"
  export VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS="${VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS:-90000}"
  export VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS="${VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS:-3}"
  export VITE_NEWS_BRIDGE_REFRESH_BACKOFF_MS="${VITE_NEWS_BRIDGE_REFRESH_BACKOFF_MS:-500}"
  export ANALYSIS_RELAY_UPSTREAM_URL="${ANALYSIS_RELAY_UPSTREAM_URL:-https://api.openai.com/v1/chat/completions}"
  export ANALYSIS_RELAY_API_KEY="${ANALYSIS_RELAY_API_KEY:-${OPENAI_API_KEY:-}}"
  export ANALYSIS_RELAY_MODEL="${ANALYSIS_RELAY_MODEL:-${VITE_ANALYSIS_MODEL:-gpt-5-nano}}"

  if [[ "$STACK_MODE" != 'validated-snapshot' && "$STACK_ANALYSIS_MODE" == 'stub' ]]; then
    export VH_DAEMON_FEED_ANALYSIS_STUB_PORT="$ANALYSIS_STUB_PORT"
    export ANALYSIS_RELAY_UPSTREAM_URL="http://127.0.0.1:${ANALYSIS_STUB_PORT}/v1/chat/completions"
    export ANALYSIS_RELAY_API_KEY="fixture-analysis-stub-key"
    export ANALYSIS_RELAY_MODEL="fixture-analysis-stub"
    export VH_BUNDLE_SYNTHESIS_ENABLED="${VH_BUNDLE_SYNTHESIS_ENABLED:-true}"
    export VH_BUNDLE_SYNTHESIS_UPSTREAM_URL="$ANALYSIS_RELAY_UPSTREAM_URL"
    export VH_BUNDLE_SYNTHESIS_API_KEY="$ANALYSIS_RELAY_API_KEY"
    export VH_BUNDLE_SYNTHESIS_MODEL="${VH_BUNDLE_SYNTHESIS_MODEL:-fixture-analysis-stub}"
    export VH_BUNDLE_SYNTHESIS_TIMEOUT_MS="${VH_BUNDLE_SYNTHESIS_TIMEOUT_MS:-15000}"
    export VH_BUNDLE_SYNTHESIS_RATE_PER_MIN="${VH_BUNDLE_SYNTHESIS_RATE_PER_MIN:-240}"
    export VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH="${VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH:-512}"
    export VH_ANALYSIS_EVAL_ARTIFACTS_ENABLED="${VH_ANALYSIS_EVAL_ARTIFACTS_ENABLED:-true}"
    export VH_ANALYSIS_EVAL_ARTIFACT_DIR="${VH_ANALYSIS_EVAL_ARTIFACT_DIR:-$ROOT/.tmp/analysis-eval-artifacts}"
  fi

  export VH_STORYCLUSTER_REMOTE_URL="http://127.0.0.1:${STORYCLUSTER_PORT}/cluster"
  export VH_STORYCLUSTER_REMOTE_HEALTH_URL="http://127.0.0.1:${STORYCLUSTER_PORT}/ready"
  export VH_STORYCLUSTER_REMOTE_TIMEOUT_MS="${VH_STORYCLUSTER_REMOTE_TIMEOUT_MS:-180000}"
  export VH_STORYCLUSTER_REMOTE_AUTH_TOKEN="$STORYCLUSTER_AUTH_TOKEN"
  export VH_STORYCLUSTER_REMOTE_AUTH_HEADER='authorization'
  export VH_STORYCLUSTER_REMOTE_AUTH_SCHEME='Bearer'
  export VH_STORYCLUSTER_TEXT_MODEL="${VH_STORYCLUSTER_TEXT_MODEL:-gpt-4o-mini}"
  export VH_STORYCLUSTER_OPENAI_TIMEOUT_MS="${VH_STORYCLUSTER_OPENAI_TIMEOUT_MS:-120000}"
  export VH_NEWS_DAEMON_HOLDER_ID="${VH_NEWS_DAEMON_HOLDER_ID:-vh-local-news-daemon}"

  if [[ "$STACK_MODE" == 'fixture' ]]; then
    export VH_DAEMON_FEED_USE_FIXTURE_FEED=true
    export VH_STORYCLUSTER_USE_TEST_PROVIDER=true
    export VH_ARTICLE_TEXT_EXTRA_ALLOWLIST_DOMAINS="${VH_ARTICLE_TEXT_EXTRA_ALLOWLIST_DOMAINS:-127.0.0.1,localhost}"
    unset VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST
    export VITE_NEWS_POLL_INTERVAL_MS="${VITE_NEWS_POLL_INTERVAL_MS:-1800000}"
    export VITE_NEWS_FEED_SOURCES="$(fixture_feed_sources_json)"
  else
    unset VH_DAEMON_FEED_USE_FIXTURE_FEED
    unset VH_STORYCLUSTER_USE_TEST_PROVIDER
    unset VH_ARTICLE_TEXT_EXTRA_ALLOWLIST_DOMAINS
    unset VITE_NEWS_FEED_SOURCES
    if [[ "$STACK_MODE" == 'public' ]]; then
      export VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST="${VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST:-8}"
    else
      unset VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST
    fi
    export VITE_NEWS_POLL_INTERVAL_MS="${VITE_NEWS_POLL_INTERVAL_MS:-300000}"
  fi

  if [[ "$STACK_MODE" == 'validated-snapshot' ]]; then
    export VITE_NEWS_RUNTIME_ENABLED=false
    export VITE_NEWS_RUNTIME_ROLE=consumer
    export VITE_NEWS_BRIDGE_ENABLED=false
    export VITE_SYNTHESIS_BRIDGE_ENABLED=false
    export VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL="http://127.0.0.1:${SNAPSHOT_PORT}/snapshot.json"
    export VH_VALIDATED_SNAPSHOT_ARTIFACT_ROOT="$(resolve_publisher_canary_artifact_root)"
  else
    unset VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL
  fi

  if [[ "$STACK_MODE" != 'validated-snapshot' ]]; then
    [[ -n "${ANALYSIS_RELAY_API_KEY:-}" ]] \
      || die "Missing ANALYSIS_RELAY_API_KEY (or OPENAI_API_KEY). Analysis will not materialize."
  fi
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
    VH_STORYCLUSTER_TEXT_MODEL="${VH_STORYCLUSTER_TEXT_MODEL:-gpt-4o-mini}" \
    VH_STORYCLUSTER_OPENAI_TIMEOUT_MS="${VH_STORYCLUSTER_OPENAI_TIMEOUT_MS:-120000}" \
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

start_validated_snapshot_server() {
  info "Starting validated snapshot server on :${SNAPSHOT_PORT}"
  : > "$SNAPSHOT_LOG"
  env VH_VALIDATED_SNAPSHOT_PORT="$SNAPSHOT_PORT" \
    node "$ROOT/tools/scripts/spawn-detached.mjs" \
    "$SNAPSHOT_PID_FILE" \
    "$ROOT" \
    "$SNAPSHOT_LOG" \
    node \
    packages/e2e/src/live/daemon-feed-validated-snapshot-server.mjs
}

start_analysis_stub() {
  info "Starting deterministic analysis stub on :${ANALYSIS_STUB_PORT}"
  : > "$ANALYSIS_STUB_LOG"
  env VH_DAEMON_FEED_ANALYSIS_STUB_PORT="$ANALYSIS_STUB_PORT" \
    node "$ROOT/tools/scripts/spawn-detached.mjs" \
    "$ANALYSIS_STUB_PID_FILE" \
    "$ROOT" \
    "$ANALYSIS_STUB_LOG" \
    node \
    packages/e2e/src/live/daemon-feed-analysis-stub.mjs
}

start_relay() {
  mkdir -p "$(dirname "$RELAY_DATA_PATH")"
  if [[ "$STACK_MODE" == 'public' && "${VH_LOCAL_STACK_RESET_RELAY:-false}" != 'true' ]]; then
    info "Preserving public relay data at $RELAY_DATA_PATH (set VH_LOCAL_STACK_RESET_RELAY=true to reset)"
  else
    rm -rf \
      "$RELAY_DATA_PATH" \
      "$RELAY_DATA_PATH"-* \
      "$ROOT/data" \
      "$ROOT/radata" \
      "$ROOT/packages/gun-client/radata" \
      "$ROOT/packages/e2e/radata" \
      "$ROOT/services/news-aggregator/radata"
  fi
  info "Starting local Gun relay on :${RELAY_PORT}"
  : > "$RELAY_LOG"
  env GUN_PORT="$RELAY_PORT" GUN_FILE="$RELAY_DATA_PATH" GUN_RADISK="${GUN_RADISK:-true}" \
    node "$ROOT/tools/scripts/spawn-detached.mjs" \
    "$RELAY_PID_FILE" \
    "$ROOT" \
    "$RELAY_LOG" \
    node \
    --max-old-space-size="${GUN_MAX_OLD_SPACE_SIZE:-8192}" \
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
  env \
    VH_BUNDLE_SYNTHESIS_ENABLED="${VH_BUNDLE_SYNTHESIS_ENABLED:-}" \
    VH_BUNDLE_SYNTHESIS_UPSTREAM_URL="${VH_BUNDLE_SYNTHESIS_UPSTREAM_URL:-}" \
    VH_BUNDLE_SYNTHESIS_API_KEY="${VH_BUNDLE_SYNTHESIS_API_KEY:-}" \
    VH_BUNDLE_SYNTHESIS_MODEL="${VH_BUNDLE_SYNTHESIS_MODEL:-}" \
    VH_BUNDLE_SYNTHESIS_MAX_TOKENS="${VH_BUNDLE_SYNTHESIS_MAX_TOKENS:-}" \
    VH_BUNDLE_SYNTHESIS_TIMEOUT_MS="${VH_BUNDLE_SYNTHESIS_TIMEOUT_MS:-}" \
    VH_BUNDLE_SYNTHESIS_RATE_PER_MIN="${VH_BUNDLE_SYNTHESIS_RATE_PER_MIN:-}" \
    VH_BUNDLE_SYNTHESIS_TEMPERATURE="${VH_BUNDLE_SYNTHESIS_TEMPERATURE:-}" \
    VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH="${VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH:-}" \
    VH_BUNDLE_SYNTHESIS_PIPELINE_VERSION="${VH_BUNDLE_SYNTHESIS_PIPELINE_VERSION:-}" \
    VH_ANALYSIS_EVAL_ARTIFACTS_ENABLED="${VH_ANALYSIS_EVAL_ARTIFACTS_ENABLED:-}" \
    VH_ANALYSIS_EVAL_ARTIFACT_DIR="${VH_ANALYSIS_EVAL_ARTIFACT_DIR:-}" \
    VH_ARTICLE_TEXT_EXTRA_ALLOWLIST_DOMAINS="${VH_ARTICLE_TEXT_EXTRA_ALLOWLIST_DOMAINS:-}" \
    node "$ROOT/tools/scripts/spawn-detached.mjs" \
    "$DAEMON_PID_FILE" \
    "$ROOT" \
    "$DAEMON_LOG" \
    pnpm \
    --filter \
    @vh/news-aggregator \
    daemon
}

kill_news_daemon_processes() {
  local pids
  pids="$(
    ps -axo pid=,comm=,command= \
      | awk '$2 == "node" && (index($0, "@vh/news-aggregator daemon") || index($0, "dist/daemon.js")) { print $1 }' \
      | tr '\n' ' '
  )"
  if [[ -z "${pids// }" ]]; then
    return
  fi

  info "Stopping orphaned news-aggregator daemon process(es): ${pids}"
  # shellcheck disable=SC2086
  kill $pids >/dev/null 2>&1 || true
  sleep 0.5
  pids="$(
    ps -axo pid=,comm=,command= \
      | awk '$2 == "node" && (index($0, "@vh/news-aggregator daemon") || index($0, "dist/daemon.js")) { print $1 }' \
      | tr '\n' ' '
  )"
  if [[ -n "${pids// }" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids >/dev/null 2>&1 || true
  fi
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
  kill_news_daemon_processes
  kill_pid_file "$STORYCLUSTER_PID_FILE"
  kill_pid_file "$FIXTURE_PID_FILE"
  kill_pid_file "$SNAPSHOT_PID_FILE"
  kill_pid_file "$ANALYSIS_STUB_PID_FILE"
  kill_port "$WEB_PORT"
  kill_port "$RELAY_PORT"
  kill_port "$STORYCLUSTER_PORT"
  kill_port "$FIXTURE_PORT"
  kill_port "$SNAPSHOT_PORT"
  kill_port "$ANALYSIS_STUB_PORT"

  if [[ "$STACK_MODE" != 'validated-snapshot' ]]; then
    start_storycluster
    wait_for_http \
      "http://127.0.0.1:${STORYCLUSTER_PORT}/ready" \
      "$READY_TIMEOUT_SECS" \
      -H "authorization: Bearer ${STORYCLUSTER_AUTH_TOKEN}" \
      || die "StoryCluster did not become ready in ${READY_TIMEOUT_SECS}s (log: $STORYCLUSTER_LOG)"
  fi

  if [[ "$STACK_MODE" == 'fixture' ]]; then
    start_fixture_feed
    wait_for_http "http://127.0.0.1:${FIXTURE_PORT}/health" "$READY_TIMEOUT_SECS" \
      || die "Fixture feed did not become ready in ${READY_TIMEOUT_SECS}s (log: $FIXTURE_LOG)"
  elif [[ "$STACK_MODE" == 'validated-snapshot' ]]; then
    start_validated_snapshot_server
    wait_for_http "http://127.0.0.1:${SNAPSHOT_PORT}/health" "$READY_TIMEOUT_SECS" \
      || die "Validated snapshot server did not become ready in ${READY_TIMEOUT_SECS}s (log: $SNAPSHOT_LOG)"
  fi

  if [[ "$STACK_MODE" != 'validated-snapshot' && "$STACK_ANALYSIS_MODE" == 'stub' ]]; then
    start_analysis_stub
    wait_for_http "http://127.0.0.1:${ANALYSIS_STUB_PORT}/health" "$READY_TIMEOUT_SECS" \
      || die "Analysis stub did not become ready in ${READY_TIMEOUT_SECS}s (log: $ANALYSIS_STUB_LOG)"
  fi

  start_relay
  wait_for_http "http://127.0.0.1:${RELAY_PORT}" "$READY_TIMEOUT_SECS" \
    || die "Relay did not become ready in ${READY_TIMEOUT_SECS}s (log: $RELAY_LOG)"

  if [[ "$STACK_MODE" != 'validated-snapshot' ]]; then
    start_daemon
    wait_for_log "$DAEMON_LOG" "\\[vh:news-daemon\\] runtime started" "$DAEMON_READY_TIMEOUT_SECS" \
      || die "News daemon runtime did not start in ${DAEMON_READY_TIMEOUT_SECS}s (log: $DAEMON_LOG)"
  fi

  start_web
  wait_for_http "http://127.0.0.1:${WEB_PORT}/" "$READY_TIMEOUT_SECS" \
    || die "Web server did not become ready in ${READY_TIMEOUT_SECS}s (log: $WEB_LOG)"
  if [[ "$STACK_MODE" != 'validated-snapshot' ]]; then
    wait_for_http "http://127.0.0.1:${WEB_PORT}/api/analyze/config" "$READY_TIMEOUT_SECS" \
      || die "Analysis relay config route did not become ready in ${READY_TIMEOUT_SECS}s (log: $WEB_LOG)"
  fi

  info "Stack ready"
  info "Mode:     ${STACK_MODE}"
  info "Analysis: ${STACK_ANALYSIS_MODE}"
  printf '%s\n' "$STACK_MODE" > "$STACK_MODE_FILE"
  printf '%s\n' "$STACK_ANALYSIS_MODE" > "$STACK_ANALYSIS_MODE_FILE"
  info "App URL:  http://127.0.0.1:${WEB_PORT}/"
  info "Relay:    http://127.0.0.1:${RELAY_PORT}/gun"
  if [[ "$STACK_MODE" == 'fixture' ]]; then
    info "Cluster:  http://127.0.0.1:${STORYCLUSTER_PORT}/cluster"
    info "Feed:     http://127.0.0.1:${FIXTURE_PORT}/ (fixture bundled-feed mode)"
  elif [[ "$STACK_MODE" == 'validated-snapshot' ]]; then
    info "Feed:     http://127.0.0.1:${SNAPSHOT_PORT}/snapshot.json (rolling publisher-canary snapshot stream)"
    info "Snapshot: $SNAPSHOT_LOG"
  else
    info "Cluster:  http://127.0.0.1:${STORYCLUSTER_PORT}/cluster"
    info "Feed:     public/admitted source surface"
  fi
  if [[ "$STACK_MODE" != 'validated-snapshot' ]]; then
    info "Daemon log:$DAEMON_LOG"
    if [[ "$STACK_ANALYSIS_MODE" == 'stub' ]]; then
      info "Analysis stub: http://127.0.0.1:${ANALYSIS_STUB_PORT}/health"
      info "Analysis log: $ANALYSIS_STUB_LOG"
    fi
  fi
  info "Web log:  $WEB_LOG"
  info "Relay log:$RELAY_LOG"
}

stack_down() {
  kill_pid_file "$WEB_PID_FILE"
  kill_pid_file "$RELAY_PID_FILE"
  kill_pid_file "$DAEMON_PID_FILE"
  kill_pid_file "$STORYCLUSTER_PID_FILE"
  kill_pid_file "$FIXTURE_PID_FILE"
  kill_pid_file "$SNAPSHOT_PID_FILE"
  kill_pid_file "$ANALYSIS_STUB_PID_FILE"
  kill_port "$WEB_PORT"
  kill_port "$RELAY_PORT"
  kill_port "$STORYCLUSTER_PORT"
  kill_port "$FIXTURE_PORT"
  kill_port "$SNAPSHOT_PORT"
  kill_port "$ANALYSIS_STUB_PORT"
  rm -f "$STACK_MODE_FILE"
  rm -f "$STACK_ANALYSIS_MODE_FILE"
  info "Stack stopped"
}

stack_status() {
  info "mode=${STACK_MODE}"
  info "analysis=${STACK_ANALYSIS_MODE}"
  for label in \
    "web-pwa:$WEB_PID_FILE:${WEB_PORT}" \
    "relay:$RELAY_PID_FILE:${RELAY_PORT}" \
    "news-daemon:$DAEMON_PID_FILE:-" \
    "storycluster:$STORYCLUSTER_PID_FILE:${STORYCLUSTER_PORT}" \
    "fixture-feed:$FIXTURE_PID_FILE:${FIXTURE_PORT}" \
    "validated-snapshot:$SNAPSHOT_PID_FILE:${SNAPSHOT_PORT}" \
    "analysis-stub:$ANALYSIS_STUB_PID_FILE:${ANALYSIS_STUB_PORT}"; do
    IFS=':' read -r name pid_file port <<<"$label"
    local_pid="$(read_pid_file "$pid_file" || true)"
    if is_pid_alive "$local_pid"; then
      if [[ "$STACK_MODE" == 'validated-snapshot' && ( "$name" == 'news-daemon' || "$name" == 'storycluster' || "$name" == 'fixture-feed' ) ]]; then
        continue
      fi
      if [[ "$name" == 'fixture-feed' && "$STACK_MODE" != 'fixture' ]]; then
        continue
      fi
      if [[ "$name" == 'validated-snapshot' && "$STACK_MODE" != 'validated-snapshot' ]]; then
        continue
      fi
      if [[ "$name" == 'analysis-stub' && ( "$STACK_MODE" == 'validated-snapshot' || "$STACK_ANALYSIS_MODE" != 'stub' ) ]]; then
        continue
      fi
      if [[ "$port" == '-' ]]; then
        info "$name running (pid=$local_pid)"
      else
        info "$name running (pid=$local_pid, port=$port)"
      fi
    else
      if [[ "$STACK_MODE" == 'validated-snapshot' && ( "$name" == 'news-daemon' || "$name" == 'storycluster' || "$name" == 'fixture-feed' ) ]]; then
        continue
      fi
      if [[ "$name" == 'fixture-feed' && "$STACK_MODE" != 'fixture' ]]; then
        continue
      fi
      if [[ "$name" == 'validated-snapshot' && "$STACK_MODE" != 'validated-snapshot' ]]; then
        continue
      fi
      if [[ "$name" == 'analysis-stub' && ( "$STACK_MODE" == 'validated-snapshot' || "$STACK_ANALYSIS_MODE" != 'stub' ) ]]; then
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
