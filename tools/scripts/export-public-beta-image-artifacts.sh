#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_PLATFORM="linux/amd64"
PLATFORM="${DEFAULT_PLATFORM}"
ORIGIN_IMAGE=""
RELAY_IMAGE=""
OUTPUT_DIR=""
REMOTE_DIR=""
SSH_HOST="humble@ccibootstrap"
SOURCE_REVISION=""
SKIP_REVISION_CHECK=false

usage() {
  cat <<'EOF'
Usage: tools/scripts/export-public-beta-image-artifacts.sh [options]

Export already-built public-beta origin and relay Docker images as tarballs,
write checksums and a secret-safe A6 image-load packet. This script is local
only: it does not SSH, scp, docker load on A6, restart containers, or start
publisher writes.

Required:
  --origin-image <image>      Local origin image tag/digest to export
  --relay-image <image>       Local relay image tag/digest to export

Options:
  --output-dir <path>         Artifact output dir (default .tmp/public-beta-image-artifacts/<origin-tag>)
  --remote-dir <path>         Remote staging dir in emitted packet (default /tmp/vhc-public-beta-images/<output-dir-basename>)
  --ssh-host <host>           SSH target used in emitted packet (default humble@ccibootstrap)
  --platform <platform>       Required image platform (default linux/amd64)
  --source-revision <sha>     Required OCI revision label (default current git HEAD)
  --skip-revision-check       Do not require a matching OCI revision label
  -h, --help                  Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --origin-image)
      ORIGIN_IMAGE="${2:-}"
      shift 2
      ;;
    --relay-image)
      RELAY_IMAGE="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="${2:-}"
      shift 2
      ;;
    --ssh-host)
      SSH_HOST="${2:-}"
      shift 2
      ;;
    --platform)
      PLATFORM="${2:-}"
      shift 2
      ;;
    --source-revision)
      SOURCE_REVISION="${2:-}"
      shift 2
      ;;
    --skip-revision-check)
      SKIP_REVISION_CHECK=true
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

if [[ -z "${ORIGIN_IMAGE}" || -z "${RELAY_IMAGE}" ]]; then
  echo "--origin-image and --relay-image are required" >&2
  exit 64
fi
if [[ -z "${PLATFORM}" ]]; then
  echo "--platform must not be empty" >&2
  exit 64
fi
if [[ "${SKIP_REVISION_CHECK}" != "true" && -z "${SOURCE_REVISION}" ]]; then
  SOURCE_REVISION="$(git -C "${ROOT}" rev-parse HEAD)"
fi

safe_name() {
  printf '%s' "$1" | sed -E 's#[^A-Za-z0-9._-]+#_#g'
}

bash_quote() {
  printf '%q' "$1"
}

file_bytes() {
  wc -c < "$1" | tr -d '[:space:]'
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

inspect_image() {
  local label="$1"
  local image="$2"
  local line id os_name arch revision created
  line="$(docker image inspect "${image}" --format '{{.Id}}|{{.Os}}|{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Created}}')"
  IFS='|' read -r id os_name arch revision created <<<"${line}"
  if [[ "${revision}" == "<no value>" ]]; then
    revision=""
  fi
  local actual_platform="${os_name}/${arch}"
  if [[ "${actual_platform}" != "${PLATFORM}" ]]; then
    printf '%s image platform mismatch: expected %s, got %s (%s)\n' "${label}" "${PLATFORM}" "${actual_platform}" "${image}" >&2
    exit 78
  fi
  if [[ "${SKIP_REVISION_CHECK}" != "true" && "${revision}" != "${SOURCE_REVISION}" ]]; then
    printf '%s image revision mismatch: expected %s, got %s (%s)\n' "${label}" "${SOURCE_REVISION}" "${revision:-<empty>}" "${image}" >&2
    exit 78
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "${id}" "${os_name}" "${arch}" "${revision}" "${created}"
}

if [[ -z "${OUTPUT_DIR}" ]]; then
  OUTPUT_DIR="${ROOT}/.tmp/public-beta-image-artifacts/$(safe_name "${ORIGIN_IMAGE}")"
fi
if [[ "${OUTPUT_DIR}" != /* ]]; then
  OUTPUT_DIR="${ROOT}/${OUTPUT_DIR}"
fi
if [[ -z "${REMOTE_DIR}" ]]; then
  REMOTE_DIR="/tmp/vhc-public-beta-images/$(basename "${OUTPUT_DIR}")"
fi

mkdir -p "${OUTPUT_DIR}"
chmod 700 "${OUTPUT_DIR}"

origin_file="$(safe_name "${ORIGIN_IMAGE}").tar"
relay_file="$(safe_name "${RELAY_IMAGE}").tar"
origin_tar="${OUTPUT_DIR}/${origin_file}"
relay_tar="${OUTPUT_DIR}/${relay_file}"
checksums_file="${OUTPUT_DIR}/SHA256SUMS"
manifest_file="${OUTPUT_DIR}/artifact-manifest.json"
packet_file="${OUTPUT_DIR}/a6-image-load-packet.md"

origin_meta="$(inspect_image "origin" "${ORIGIN_IMAGE}")"
IFS=$'\t' read -r origin_id origin_os origin_arch origin_revision origin_created <<<"${origin_meta}"
relay_meta="$(inspect_image "relay" "${RELAY_IMAGE}")"
IFS=$'\t' read -r relay_id relay_os relay_arch relay_revision relay_created <<<"${relay_meta}"

docker save -o "${origin_tar}.tmp" "${ORIGIN_IMAGE}"
mv "${origin_tar}.tmp" "${origin_tar}"
chmod 600 "${origin_tar}"
docker save -o "${relay_tar}.tmp" "${RELAY_IMAGE}"
mv "${relay_tar}.tmp" "${relay_tar}"
chmod 600 "${relay_tar}"

(
  cd "${OUTPUT_DIR}"
  shasum -a 256 "${origin_file}" "${relay_file}" > "${checksums_file}"
)
chmod 600 "${checksums_file}"

origin_sha="$(awk -v file="${origin_file}" '$2 == file {print $1}' "${checksums_file}")"
relay_sha="$(awk -v file="${relay_file}" '$2 == file {print $1}' "${checksums_file}")"

ARTIFACT_SCHEMA="vh-public-beta-local-image-artifact-manifest-v1" \
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
SOURCE_REVISION_VALUE="${SOURCE_REVISION}" \
PLATFORM_VALUE="${PLATFORM}" \
ORIGIN_IMAGE="${ORIGIN_IMAGE}" \
ORIGIN_FILE="${origin_tar}" \
ORIGIN_BYTES="$(file_bytes "${origin_tar}")" \
ORIGIN_MODE="$(file_mode "${origin_tar}")" \
ORIGIN_SHA="${origin_sha}" \
ORIGIN_ID="${origin_id}" \
ORIGIN_OS="${origin_os}" \
ORIGIN_ARCH="${origin_arch}" \
ORIGIN_REVISION="${origin_revision}" \
ORIGIN_CREATED="${origin_created}" \
RELAY_IMAGE="${RELAY_IMAGE}" \
RELAY_FILE="${relay_tar}" \
RELAY_BYTES="$(file_bytes "${relay_tar}")" \
RELAY_MODE="$(file_mode "${relay_tar}")" \
RELAY_SHA="${relay_sha}" \
RELAY_ID="${relay_id}" \
RELAY_OS="${relay_os}" \
RELAY_ARCH="${relay_arch}" \
RELAY_REVISION="${relay_revision}" \
RELAY_CREATED="${relay_created}" \
node --input-type=module > "${manifest_file}" <<'NODE'
const env = process.env;
const image = (kind) => ({
  image: env[`${kind}_IMAGE`],
  file: env[`${kind}_FILE`],
  bytes: Number(env[`${kind}_BYTES`]),
  mode: env[`${kind}_MODE`],
  sha256: env[`${kind}_SHA`],
  image_id: env[`${kind}_ID`],
  os: env[`${kind}_OS`],
  architecture: env[`${kind}_ARCH`],
  revision: env[`${kind}_REVISION`],
  created: env[`${kind}_CREATED`],
});

console.log(JSON.stringify({
  schema_version: env.ARTIFACT_SCHEMA,
  generated_at: env.GENERATED_AT,
  source_revision: env.SOURCE_REVISION_VALUE || null,
  revision_check_skipped: !env.SOURCE_REVISION_VALUE,
  platform: env.PLATFORM_VALUE,
  production_actions_performed: false,
  images: [image('ORIGIN'), image('RELAY')],
  load_command: 'docker load -i <tar-file>',
  approval_required_before_host_load_or_deploy: true,
}, null, 2));
NODE
chmod 600 "${manifest_file}"

{
  cat <<EOF
# A6 Public-Beta Image Load Packet

This packet is approval-required. It only loads Docker images onto A6; it does not recreate, restart, or stop any containers.

## Local Artifacts

- ${ORIGIN_IMAGE}: \`${origin_tar}\`
  - sha256: \`${origin_sha}\`
  - platform: \`${origin_os}/${origin_arch}\`
  - revision: \`${origin_revision:-<empty>}\`
- ${RELAY_IMAGE}: \`${relay_tar}\`
  - sha256: \`${relay_sha}\`
  - platform: \`${relay_os}/${relay_arch}\`
  - revision: \`${relay_revision:-<empty>}\`

## Approval-Only Commands

\`\`\`bash
set -euo pipefail
SSH_HOST=$(bash_quote "${SSH_HOST}")
REMOTE_DIR=$(bash_quote "${REMOTE_DIR}")
ssh "\${SSH_HOST}" "mkdir -p \${REMOTE_DIR} && chmod 700 \${REMOTE_DIR}"
scp $(bash_quote "${origin_tar}") "\${SSH_HOST}:\${REMOTE_DIR}/${origin_file}"
scp $(bash_quote "${relay_tar}") "\${SSH_HOST}:\${REMOTE_DIR}/${relay_file}"
scp $(bash_quote "${checksums_file}") "\${SSH_HOST}:\${REMOTE_DIR}/SHA256SUMS"
ssh "\${SSH_HOST}" "cd \${REMOTE_DIR} && sha256sum -c SHA256SUMS"
ssh "\${SSH_HOST}" "docker load -i \${REMOTE_DIR}/${origin_file}"
ssh "\${SSH_HOST}" "docker load -i \${REMOTE_DIR}/${relay_file}"
ssh "\${SSH_HOST}" 'docker image inspect ${ORIGIN_IMAGE} ${RELAY_IMAGE} --format "{{.RepoTags}} {{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels \"org.opencontainers.image.revision\"}}"'
\`\`\`

## Abort Criteria

- Abort if \`sha256sum -c SHA256SUMS\` fails.
- Abort if either loaded image is not \`${PLATFORM}\`.
- Abort if either loaded image revision is not \`${SOURCE_REVISION:-<revision-check-skipped>}\`.
- Loading images is not approval to restart relays, deploy origin, start publisher writes, run latest-index HTTP probes, or re-enable monitors.
EOF
} > "${packet_file}"
chmod 600 "${packet_file}"

cat <<EOF
artifact_dir=${OUTPUT_DIR}
origin_tar=${origin_tar}
relay_tar=${relay_tar}
checksums=${checksums_file}
manifest=${manifest_file}
load_packet=${packet_file}
origin_sha256=${origin_sha}
relay_sha256=${relay_sha}
EOF
