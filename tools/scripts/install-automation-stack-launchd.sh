#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST_SRC="$ROOT/tools/launchd/com.vhc.automation-stack.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.vhc.automation-stack.plist"
LABEL="com.vhc.automation-stack"
DOMAIN_TARGET="gui/$(id -u)"

info() { echo "[automation-stack-launchd] $*"; }
die()  { echo "[automation-stack-launchd][error] $*" >&2; exit 1; }

do_install() {
  [[ -f "$PLIST_SRC" ]] || die "Source plist not found: $PLIST_SRC"
  mkdir -p "$(dirname "$PLIST_DST")"
  mkdir -p "$ROOT/.tmp/automation-stack/logs"

  info "Installing plist to $PLIST_DST"
  sed \
    -e "s|__REPO_ROOT__|${ROOT}|g" \
    -e "s|__HOME_DIR__|${HOME}|g" \
    "$PLIST_SRC" > "$PLIST_DST"

  # Remove existing agent if loaded (ignore errors on fresh install)
  launchctl bootout "$DOMAIN_TARGET/$LABEL" 2>/dev/null || true

  info "Bootstrapping agent..."
  launchctl bootstrap "$DOMAIN_TARGET" "$PLIST_DST"
  launchctl enable "$DOMAIN_TARGET/$LABEL"

  info "Agent installed and enabled."
  info "Label:  $LABEL"
  info "Plist:  $PLIST_DST"
  info "Verify: launchctl print $DOMAIN_TARGET/$LABEL"
}

do_uninstall() {
  info "Removing agent $LABEL"
  launchctl bootout "$DOMAIN_TARGET/$LABEL" 2>/dev/null || true
  rm -f "$PLIST_DST"
  info "Agent removed."
}

case "${1:-install}" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  *)
    die "Usage: $0 [install|uninstall]"
    ;;
esac
