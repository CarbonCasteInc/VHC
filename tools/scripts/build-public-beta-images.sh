#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_PLATFORM="linux/amd64"
IMAGE_PREFIX="${VH_PUBLIC_BETA_IMAGE_PREFIX:-vhc-public-beta}"
PLATFORM="${DEFAULT_PLATFORM}"
TAG=""
PROVENANCE_ENV=""
PEER_CONFIG_FILE=""
METADATA_DIR=""
BUILD_ORIGIN=false
BUILD_RELAY=false
DRY_RUN=false
PUSH=false
LOAD=true
SKIP_SMOKE=false
PRINT_TEMPLATE=false

ORIGIN_BUILD_ARG_NAMES=(
  VITE_GUN_PEERS
  VITE_GUN_PEER_CONFIG_URL
  VITE_GUN_PEER_CONFIG_PUBLIC_KEY
  VITE_GUN_PEER_MINIMUM
  VITE_GUN_PEER_QUORUM_REQUIRED
  VITE_VH_STRICT_PEER_CONFIG
  VITE_VH_ALLOW_LOCAL_MESH_PEERS
  VITE_VH_CSP_CONNECT_SRC
  VITE_VH_CSP_STRICT_CONNECT_SRC
  VITE_NEWS_EXTRACTION_SERVICE_URL
  VITE_NEWS_SYSTEM_WRITER_PIN_JSON
  VITE_VH_ANALYSIS_PIPELINE
  VITE_NEWS_RUNTIME_ENABLED
  VITE_NEWS_RUNTIME_ROLE
  VITE_NEWS_BRIDGE_ENABLED
  VITE_SYNTHESIS_BRIDGE_ENABLED
  VITE_VH_GUN_LOCAL_STORAGE
  VITE_LUMA_PROFILE
  VITE_LUMA_DEV_FALLBACK
  VITE_ATTESTATION_URL
  VITE_CONSTITUENCY_PROOF_REAL
  VITE_E2E_MODE
)

REQUIRED_NONEMPTY_ORIGIN_VARS=(
  VITE_GUN_PEER_CONFIG_PUBLIC_KEY
  VITE_GUN_PEER_MINIMUM
  VITE_GUN_PEER_QUORUM_REQUIRED
  VITE_VH_STRICT_PEER_CONFIG
  VITE_VH_ALLOW_LOCAL_MESH_PEERS
  VITE_VH_CSP_CONNECT_SRC
  VITE_VH_CSP_STRICT_CONNECT_SRC
  VITE_NEWS_SYSTEM_WRITER_PIN_JSON
  VITE_VH_ANALYSIS_PIPELINE
  VITE_NEWS_RUNTIME_ENABLED
  VITE_NEWS_RUNTIME_ROLE
  VITE_NEWS_BRIDGE_ENABLED
  VITE_SYNTHESIS_BRIDGE_ENABLED
  VITE_VH_GUN_LOCAL_STORAGE
  VITE_LUMA_PROFILE
  VITE_LUMA_DEV_FALLBACK
  VITE_CONSTITUENCY_PROOF_REAL
  VITE_E2E_MODE
)

usage() {
  cat <<'EOF'
Usage: tools/scripts/build-public-beta-images.sh [options]

Build reproducible public-beta origin and relay images. The origin build refuses
to run without a captured build-time provenance env file and signed peer config.

Options:
  --all                         Build origin and relay images (default)
  --origin                      Build only the origin image
  --relay                       Build only the relay image
  --provenance-env <path>        Shell env file containing captured VITE_* values
  --peer-config-file <path>      Signed mesh-peer-config.json to bake into origin
  --platform <platform>          Docker platform (default linux/amd64)
  --tag <tag>                    Image tag (default YYYYMMDD-main-v<sha>-amd64)
  --image-prefix <prefix>        Image prefix (default vhc-public-beta)
  --metadata-dir <path>          Build metadata output dir
  --push                        Push images instead of loading locally
  --load                        Load images locally (default)
  --skip-smoke                  Skip post-build local container smoke checks
  --dry-run                     Print docker commands without executing them
  --print-provenance-template    Print a provenance env-file template and exit
  -h, --help                    Show this help
EOF
}

print_provenance_template() {
  cat <<'EOF'
# Captured from the currently deployed public-beta origin image/build.
# Keep this file outside git. Values are consumed as build-time inputs.
VITE_GUN_PEERS=
VITE_GUN_PEER_CONFIG_URL=
VITE_GUN_PEER_CONFIG_PUBLIC_KEY=
VITE_GUN_PEER_MINIMUM=3
VITE_GUN_PEER_QUORUM_REQUIRED=2
VITE_VH_STRICT_PEER_CONFIG=true
VITE_VH_ALLOW_LOCAL_MESH_PEERS=false
VITE_VH_CSP_CONNECT_SRC=
VITE_VH_CSP_STRICT_CONNECT_SRC=true
VITE_NEWS_EXTRACTION_SERVICE_URL=
VITE_NEWS_SYSTEM_WRITER_PIN_JSON=
VITE_VH_ANALYSIS_PIPELINE=true
VITE_NEWS_RUNTIME_ENABLED=true
VITE_NEWS_RUNTIME_ROLE=consumer
VITE_NEWS_BRIDGE_ENABLED=true
VITE_SYNTHESIS_BRIDGE_ENABLED=true
VITE_VH_GUN_LOCAL_STORAGE=false
VITE_LUMA_PROFILE=public-beta
VITE_LUMA_DEV_FALLBACK=false
VITE_ATTESTATION_URL=
VITE_CONSTITUENCY_PROOF_REAL=true
VITE_E2E_MODE=false
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      BUILD_ORIGIN=true
      BUILD_RELAY=true
      shift
      ;;
    --origin)
      BUILD_ORIGIN=true
      shift
      ;;
    --relay)
      BUILD_RELAY=true
      shift
      ;;
    --provenance-env)
      PROVENANCE_ENV="${2:-}"
      shift 2
      ;;
    --peer-config-file)
      PEER_CONFIG_FILE="${2:-}"
      shift 2
      ;;
    --platform)
      PLATFORM="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --image-prefix)
      IMAGE_PREFIX="${2:-}"
      shift 2
      ;;
    --metadata-dir)
      METADATA_DIR="${2:-}"
      shift 2
      ;;
    --push)
      PUSH=true
      LOAD=false
      shift
      ;;
    --load)
      LOAD=true
      PUSH=false
      shift
      ;;
    --skip-smoke)
      SKIP_SMOKE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --print-provenance-template)
      PRINT_TEMPLATE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

if [[ "${PRINT_TEMPLATE}" == "true" ]]; then
  print_provenance_template
  exit 0
fi

if [[ "${BUILD_ORIGIN}" == "false" && "${BUILD_RELAY}" == "false" ]]; then
  BUILD_ORIGIN=true
  BUILD_RELAY=true
fi

if [[ -z "${PLATFORM}" ]]; then
  echo "--platform must not be empty" >&2
  exit 64
fi

GIT_SHA="$(git -C "${ROOT}" rev-parse HEAD)"
GIT_SHA_SHORT="$(git -C "${ROOT}" rev-parse --short=8 HEAD)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ -z "${TAG}" ]]; then
  TAG="$(date -u +%Y%m%d)-main-v${GIT_SHA_SHORT}-amd64"
fi
if [[ -z "${METADATA_DIR}" ]]; then
  METADATA_DIR="${ROOT}/.tmp/public-beta-image-build/${TAG}"
fi

ORIGIN_IMAGE="${IMAGE_PREFIX}-origin:${TAG}"
RELAY_IMAGE="${IMAGE_PREFIX}-relay:${TAG}"

quote_cmd() {
  printf '%q ' "$@"
  printf '\n'
}

run_cmd() {
  printf '+ '
  quote_cmd "$@"
  if [[ "${DRY_RUN}" != "true" ]]; then
    "$@"
  fi
}

require_file() {
  local file="$1"
  local label="$2"
  if [[ ! -r "${file}" ]]; then
    echo "${label} is required and must be readable: ${file}" >&2
    exit 66
  fi
}

require_origin_provenance() {
  require_file "${PROVENANCE_ENV}" "--provenance-env"
  require_file "${PEER_CONFIG_FILE}" "--peer-config-file"

  set -a
  # shellcheck disable=SC1090
  source "${PROVENANCE_ENV}"
  set +a

  local missing=()
  local name
  for name in "${ORIGIN_BUILD_ARG_NAMES[@]}"; do
    if [[ -z "${!name+x}" ]]; then
      missing+=("${name}")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    printf 'Origin provenance file is missing required names: %s\n' "${missing[*]}" >&2
    exit 78
  fi

  for name in "${REQUIRED_NONEMPTY_ORIGIN_VARS[@]}"; do
    if [[ -z "${!name}" ]]; then
      printf 'Origin provenance variable must not be empty: %s\n' "${name}" >&2
      exit 78
    fi
  done

  export VH_PUBLIC_ORIGIN_MESH_PEER_CONFIG_BASE64
  VH_PUBLIC_ORIGIN_MESH_PEER_CONFIG_BASE64="$(base64 < "${PEER_CONFIG_FILE}" | tr -d '\n')"
  if [[ -z "${VH_PUBLIC_ORIGIN_MESH_PEER_CONFIG_BASE64}" ]]; then
    echo "Peer config base64 encoding produced an empty value" >&2
    exit 78
  fi
}

common_build_args() {
  printf '%s\n' \
    --platform "${PLATFORM}" \
    --label "org.opencontainers.image.revision=${GIT_SHA}" \
    --label "org.opencontainers.image.created=${BUILD_DATE}"
  if [[ "${PUSH}" == "true" ]]; then
    printf '%s\n' --push
  elif [[ "${LOAD}" == "true" ]]; then
    printf '%s\n' --load
  fi
}

build_origin() {
  require_origin_provenance
  mkdir -p "${METADATA_DIR}"
  local args=()
  while IFS= read -r item; do
    args+=("${item}")
  done < <(common_build_args)
  local name
  for name in "${ORIGIN_BUILD_ARG_NAMES[@]}"; do
    export "${name}"
    args+=(--build-arg "${name}")
  done
  args+=(--build-arg VH_PUBLIC_ORIGIN_MESH_PEER_CONFIG_BASE64)
  args+=(--build-arg "VCS_REF=${GIT_SHA}")
  args+=(--build-arg "BUILD_DATE=${BUILD_DATE}")
  args+=(--metadata-file "${METADATA_DIR}/origin-build-metadata.json")
  args+=(-f "${ROOT}/infra/origin/Dockerfile" -t "${ORIGIN_IMAGE}" "${ROOT}")
  run_cmd docker buildx build "${args[@]}"
}

build_relay() {
  mkdir -p "${METADATA_DIR}"
  local args=()
  while IFS= read -r item; do
    args+=("${item}")
  done < <(common_build_args)
  args+=(--metadata-file "${METADATA_DIR}/relay-build-metadata.json")
  args+=(-f "${ROOT}/infra/relay/Dockerfile" -t "${RELAY_IMAGE}" "${ROOT}/infra/relay")
  run_cmd docker buildx build "${args[@]}"
}

smoke_origin() {
  if [[ "${DRY_RUN}" == "true" || "${SKIP_SMOKE}" == "true" || "${LOAD}" != "true" ]]; then
    return
  fi
  local cid
  cid="$(docker run -d --rm -P \
    -e HOST=0.0.0.0 \
    -e VH_PUBLIC_ORIGIN_RELAY_TARGET=http://127.0.0.1:9 \
    -e VH_PUBLIC_ORIGIN_ANALYSIS_TARGET="${VH_PUBLIC_BETA_SMOKE_ANALYSIS_TARGET:-http://127.0.0.1:3001}" \
    "${ORIGIN_IMAGE}")"
  trap 'docker rm -f "${cid}" >/dev/null 2>&1 || true' RETURN
  local port
  port="$(docker port "${cid}" 8080/tcp | awk -F: 'NR==1 {print $NF}')"
  for _ in 1 2 3 4 5; do
    if curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null; then
      break
    fi
    sleep 1
  done
  curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null
  if [[ -n "${VH_PUBLIC_BETA_SMOKE_ANALYSIS_TARGET:-}" ]]; then
    curl -fsS "http://127.0.0.1:${port}/api/analyze/health" >/dev/null
  fi
}

smoke_relay() {
  if [[ "${DRY_RUN}" == "true" || "${SKIP_SMOKE}" == "true" || "${LOAD}" != "true" ]]; then
    return
  fi
  local tmp cid port
  tmp="$(mktemp -d)"
  cid="$(docker run -d --rm -P \
    -e NODE_ENV=production \
    -e GUN_HOST=0.0.0.0 \
    -e GUN_FILE=/data \
    -e GUN_RADISK=true \
    -v "${tmp}:/data" \
    "${RELAY_IMAGE}")"
  trap 'docker rm -f "${cid}" >/dev/null 2>&1 || true; rm -rf "${tmp}"' RETURN
  port="$(docker port "${cid}" 7777/tcp | awk -F: 'NR==1 {print $NF}')"
  for _ in 1 2 3 4 5; do
    if curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null; then
      break
    fi
    sleep 1
  done
  curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null
}

if [[ "${BUILD_ORIGIN}" == "true" ]]; then
  build_origin
  smoke_origin
fi
if [[ "${BUILD_RELAY}" == "true" ]]; then
  build_relay
  smoke_relay
fi

cat <<EOF
Build plan complete.
origin_image=${ORIGIN_IMAGE}
relay_image=${RELAY_IMAGE}
platform=${PLATFORM}
metadata_dir=${METADATA_DIR}
EOF
