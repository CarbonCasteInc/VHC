#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${VH_STORYCLUSTER_ENV_FILE:-${HOME}/.config/vhc/storycluster.env}"

if [[ -r "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

IMAGE="${VH_STORYCLUSTER_QDRANT_IMAGE:-qdrant/qdrant:v1.13.6}"
CONTAINER="${VH_STORYCLUSTER_QDRANT_CONTAINER:-vh-storycluster-qdrant}"
STORAGE_DIR="${VH_STORYCLUSTER_QDRANT_STORAGE_DIR:-${HOME}/.local/state/vhc/storycluster-qdrant/storage}"
HTTP_PORT="${VH_STORYCLUSTER_QDRANT_HTTP_PORT:-6333}"
GRPC_PORT="${VH_STORYCLUSTER_QDRANT_GRPC_PORT:-6334}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[vh:storycluster:qdrant] docker is required" >&2
  exit 78
fi

mkdir -p "${STORAGE_DIR}"

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "[vh:storycluster:qdrant] pulling image ${IMAGE}"
  docker pull "${IMAGE}"
fi

if docker ps -aq --filter "name=^/${CONTAINER}$" | grep -q .; then
  echo "[vh:storycluster:qdrant] removing existing container ${CONTAINER}"
  docker rm -f "${CONTAINER}" >/dev/null
fi

args=(
  run
  --name "${CONTAINER}"
  --rm
  --publish "127.0.0.1:${HTTP_PORT}:6333"
  --publish "127.0.0.1:${GRPC_PORT}:6334"
  --volume "${STORAGE_DIR}:/qdrant/storage"
)

if [[ -n "${VH_STORYCLUSTER_QDRANT_API_KEY:-}" ]]; then
  export QDRANT__SERVICE__API_KEY="${VH_STORYCLUSTER_QDRANT_API_KEY}"
  args+=(--env QDRANT__SERVICE__API_KEY)
fi

echo "[vh:storycluster:qdrant] starting ${CONTAINER} on 127.0.0.1:${HTTP_PORT}"
exec docker "${args[@]}" "${IMAGE}"
