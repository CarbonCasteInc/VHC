#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${VH_STORYCLUSTER_ENV_FILE:-${HOME}/.config/vhc/storycluster.env}"

if [[ -r "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

CONTAINER="${VH_STORYCLUSTER_QDRANT_CONTAINER:-vh-storycluster-qdrant}"

if command -v docker >/dev/null 2>&1 && docker ps -q --filter "name=^/${CONTAINER}$" | grep -q .; then
  docker stop "${CONTAINER}" >/dev/null
fi
