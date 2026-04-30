#!/usr/bin/env bash
# Shared helpers for VHC local stack scripts.
# Callers must set $_log_tag before sourcing this file.
# Callers must set $ROOT to the repo root before sourcing this file.

_LIB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# --- shared constants ---
STORYCLUSTER_AUTH_TOKEN="${STORYCLUSTER_AUTH_TOKEN:-vh-local-storycluster-token}"
STORYCLUSTER_LOADER_PATH="${STORYCLUSTER_LOADER_PATH:-$_LIB_ROOT/tools/node/esm-resolve-loader.mjs}"
READY_TIMEOUT_SECS="${READY_TIMEOUT_SECS:-45}"
DAEMON_READY_TIMEOUT_SECS="${DAEMON_READY_TIMEOUT_SECS:-90}"

# --- logging ---
info() { echo "[${_log_tag:-stack}] $*"; }
warn() { echo "[${_log_tag:-stack}][warn] $*" >&2; }
die()  { echo "[${_log_tag:-stack}][error] $*" >&2; exit 1; }

# --- process management ---
spawn_detached_with_cwd() {
  local spawn_cwd="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3
  node "$_LIB_ROOT/tools/scripts/spawn-detached.mjs" "$pid_file" "$spawn_cwd" "$log_file" "$@"
}

spawn_detached() {
  local pid_file="$1"
  local log_file="$2"
  shift 2
  spawn_detached_with_cwd "$_LIB_ROOT" "$pid_file" "$log_file" "$@"
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
    kill "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
    sleep 0.5
    if is_pid_alive "$pid"; then
      kill -9 "-$pid" >/dev/null 2>&1 || kill -9 "$pid" >/dev/null 2>&1 || true
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

# --- wait helpers ---
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

probe_bindable_tcp_port() {
  local port="$1"
  node -e '
    const net = require("node:net");
    const port = Number(process.argv[1]);
    const server = net.createServer();
    const finish = (code) => {
      try {
        server.close(() => process.exit(code));
      } catch {
        process.exit(code);
      }
    };
    server.once("error", () => finish(1));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => finish(0));
  ' "$port" >/dev/null 2>&1
}

resolve_bindable_tcp_port() {
  local preferred_port="$1"
  local fallback_base="$2"
  local probe_count="$3"
  local label="${4:-port}"
  local candidate_port

  if probe_bindable_tcp_port "$preferred_port"; then
    echo "$preferred_port"
    return 0
  fi

  warn "Preferred ${label} tcp:${preferred_port} is not bindable; probing fallback ports"
  for (( offset=0; offset<probe_count; offset+=1 )); do
    candidate_port=$(( fallback_base + offset ))
    if [[ "$candidate_port" -eq "$preferred_port" ]]; then
      continue
    fi
    if probe_bindable_tcp_port "$candidate_port"; then
      info "Using fallback ${label} tcp:${candidate_port}"
      echo "$candidate_port"
      return 0
    fi
  done

  return 1
}
