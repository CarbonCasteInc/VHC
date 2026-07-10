#!/usr/bin/env bash

# Shared fail-closed checks for the production publisher installer, ExecStart,
# and attended recovery controller. Callers must enable `set -euo pipefail`.

vh_publisher_is_full_revision() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]
}

vh_publisher_require_full_revision() {
  local revision="${1:-}"
  if ! vh_publisher_is_full_revision "${revision}"; then
    echo "[vh:publisher-recovery] expected revision must be a full lowercase commit id" >&2
    return 78
  fi
}

vh_publisher_require_exact_checkout() {
  local repo_root="${1:-}"
  local expected_revision="${2:-}"
  local observed_revision tracked_status

  vh_publisher_require_full_revision "${expected_revision}" || return $?
  if [[ -z "${repo_root}" || ! -d "${repo_root}" ]]; then
    echo "[vh:publisher-recovery] repository checkout is unavailable" >&2
    return 78
  fi
  if ! observed_revision="$(command git -C "${repo_root}" rev-parse --verify HEAD 2>/dev/null)"; then
    echo "[vh:publisher-recovery] unable to resolve checkout revision" >&2
    return 78
  fi
  if [[ "${observed_revision}" != "${expected_revision}" ]]; then
    echo "[vh:publisher-recovery] checkout revision does not match the reviewed revision" >&2
    return 78
  fi
  if ! tracked_status="$(command git -C "${repo_root}" status --porcelain=v1 --untracked-files=no 2>/dev/null)"; then
    echo "[vh:publisher-recovery] unable to verify tracked checkout cleanliness" >&2
    return 78
  fi
  if [[ -n "${tracked_status}" ]]; then
    echo "[vh:publisher-recovery] tracked checkout is dirty" >&2
    return 78
  fi
}
