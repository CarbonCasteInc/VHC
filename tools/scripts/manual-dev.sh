#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

info() { echo "[manual-dev] $*"; }
warn() { echo "[manual-dev][warn] $*" >&2; }

usage() {
  cat <<'EOF'
Usage: ./tools/scripts/manual-dev.sh [up|down|status|smoke]

This wrapper now delegates to the canonical local live stack so manual testing
uses the same story-bundler wiring as the browser gates.

Defaults:
  - fixture-backed bundled-feed mode

Overrides:
  - VH_LOCAL_STACK_FEED_MODE=public ./tools/scripts/manual-dev.sh up
EOF
}

command_name="${1:-up}"
case "$command_name" in
  up|down|status|smoke) ;;
  *)
    usage
    warn "Unsupported command: $command_name"
    exit 1
    ;;
esac

if [[ -n "${PORT:-}" && -z "${WEB_PORT:-}" ]]; then
  export WEB_PORT="$PORT"
fi

info "Delegating to tools/scripts/live-local-stack.sh (${command_name})"
exec bash "$ROOT/tools/scripts/live-local-stack.sh" "$command_name"
