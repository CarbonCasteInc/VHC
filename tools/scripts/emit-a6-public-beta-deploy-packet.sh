#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSPECT_JSON=""
NEW_ORIGIN_IMAGE=""
NEW_RELAY_IMAGE=""
EXPECTED_ORIGIN_REVISION=""
EXPECTED_RELAY_REVISION=""
ANALYSIS_TARGET="http://127.0.0.1:3001"
ORIGIN_NAME="vhc-public-origin"
RELAY_NAMES="vhc-relay-a,vhc-relay-b,vhc-relay-c"
OUTPUT_FILE=""
INCLUDE_RECREATE=false
RELAY_ONLY=false

usage() {
  cat <<'EOF'
Usage: tools/scripts/emit-a6-public-beta-deploy-packet.sh [options]

Emit a secret-safe A6 public-beta deploy packet from captured docker inspect JSON.
The script prints commands only; it never changes production state.

Required:
  --inspect-json <path>       docker inspect JSON for origin and relay containers
  --new-relay-image <image>   Rebuilt relay image tag/digest to deploy
  --new-origin-image <image>  Rebuilt origin image tag/digest to deploy (full mode)

Required with --include-recreate-commands:
  --expected-origin-revision <sha>
                              Release commit expected from origin /healthz after deploy
  --expected-relay-revision <sha>
                              Release commit required from the relay OCI label in relay-only mode

Options:
  --analysis-target <url>     Corrected origin analysis target (default http://127.0.0.1:3001)
  --origin-name <name>        Origin container name (default vhc-public-origin)
  --relay-names <a,b,c>       Relay container names (default vhc-relay-a,vhc-relay-b,vhc-relay-c)
  --relay-only                Emit an origin-free, exactly-three-relay rolling packet
  --include-recreate-commands Include docker rm/run commands in the packet
  --output <path>             Write packet to a file instead of stdout
  -h, --help                  Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --inspect-json)
      INSPECT_JSON="${2:-}"
      shift 2
      ;;
    --new-origin-image)
      NEW_ORIGIN_IMAGE="${2:-}"
      shift 2
      ;;
    --new-relay-image)
      NEW_RELAY_IMAGE="${2:-}"
      shift 2
      ;;
    --expected-origin-revision)
      EXPECTED_ORIGIN_REVISION="${2:-}"
      shift 2
      ;;
    --expected-relay-revision)
      EXPECTED_RELAY_REVISION="${2:-}"
      shift 2
      ;;
    --analysis-target)
      ANALYSIS_TARGET="${2:-}"
      shift 2
      ;;
    --origin-name)
      ORIGIN_NAME="${2:-}"
      shift 2
      ;;
    --relay-names)
      RELAY_NAMES="${2:-}"
      shift 2
      ;;
    --include-recreate-commands)
      INCLUDE_RECREATE=true
      shift
      ;;
    --relay-only)
      RELAY_ONLY=true
      shift
      ;;
    --output)
      OUTPUT_FILE="${2:-}"
      shift 2
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

if [[ ! -r "${INSPECT_JSON}" ]]; then
  echo "--inspect-json is required and must be readable" >&2
  exit 66
fi
if [[ -z "${NEW_RELAY_IMAGE}" ]]; then
  echo "--new-relay-image is required" >&2
  exit 64
fi
if [[ "${RELAY_ONLY}" == "true" ]]; then
  if [[ -n "${NEW_ORIGIN_IMAGE}" ]]; then
    echo "--new-origin-image is forbidden with --relay-only" >&2
    exit 64
  fi
  if [[ "${RELAY_NAMES}" != "vhc-relay-a,vhc-relay-b,vhc-relay-c" ]]; then
    echo "--relay-only requires exactly vhc-relay-a,vhc-relay-b,vhc-relay-c" >&2
    exit 64
  fi
  if [[ -z "${EXPECTED_RELAY_REVISION}" ]]; then
    echo "--expected-relay-revision is required with --relay-only" >&2
    exit 64
  fi
  if [[ ! "${EXPECTED_RELAY_REVISION}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
    echo "--expected-relay-revision must be a full lowercase git object id" >&2
    exit 64
  fi
elif [[ -z "${NEW_ORIGIN_IMAGE}" ]]; then
  echo "--new-origin-image is required unless --relay-only is set" >&2
  exit 64
fi
if [[ "${RELAY_ONLY}" != "true" && "${INCLUDE_RECREATE}" == "true" && -z "${EXPECTED_ORIGIN_REVISION}" ]]; then
  echo "--expected-origin-revision is required with --include-recreate-commands" >&2
  exit 64
fi

emit_packet() {
  INSPECT_JSON="${INSPECT_JSON}" \
  NEW_ORIGIN_IMAGE="${NEW_ORIGIN_IMAGE}" \
  NEW_RELAY_IMAGE="${NEW_RELAY_IMAGE}" \
  EXPECTED_ORIGIN_REVISION="${EXPECTED_ORIGIN_REVISION}" \
  EXPECTED_RELAY_REVISION="${EXPECTED_RELAY_REVISION}" \
  ANALYSIS_TARGET="${ANALYSIS_TARGET}" \
  ORIGIN_NAME="${ORIGIN_NAME}" \
  RELAY_NAMES="${RELAY_NAMES}" \
  INCLUDE_RECREATE="${INCLUDE_RECREATE}" \
  RELAY_ONLY="${RELAY_ONLY}" \
  node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';

const inspectJson = process.env.INSPECT_JSON;
const newOriginImage = process.env.NEW_ORIGIN_IMAGE;
const newRelayImage = process.env.NEW_RELAY_IMAGE;
const expectedOriginRevision = process.env.EXPECTED_ORIGIN_REVISION || '';
const expectedRelayRevision = process.env.EXPECTED_RELAY_REVISION || '';
const analysisTarget = process.env.ANALYSIS_TARGET;
const originName = process.env.ORIGIN_NAME;
const relayNames = (process.env.RELAY_NAMES || '').split(',').map((name) => name.trim()).filter(Boolean);
const includeRecreate = process.env.INCLUDE_RECREATE === 'true';
const relayOnly = process.env.RELAY_ONLY === 'true';
const relayMemoryLimit = process.env.VH_RELAY_DOCKER_MEMORY_LIMIT || '2304m';
const relayHeapThresholdDefaults = ['850000000', '1000000000', '1150000000'];
const relayHeapThresholdByName = new Map(relayNames.map((name, index) => [
  name,
  relayHeapThresholdDefaults[index] ?? relayHeapThresholdDefaults.at(-1),
]));
const containers = JSON.parse(readFileSync(inspectJson, 'utf8'));

function cleanName(container) {
  return String(container?.Name || '').replace(/^\//, '');
}

const byName = new Map(containers.map((container) => [cleanName(container), container]));
const requiredNames = relayOnly ? relayNames : [originName, ...relayNames];
const missing = requiredNames.filter((name) => !byName.has(name));
if (missing.length > 0) {
  console.error(`inspect JSON missing required containers: ${missing.join(', ')}`);
  process.exit(78);
}

function envNames(container) {
  return (container?.Config?.Env || [])
    .map((entry) => String(entry).split('=', 1)[0])
    .filter(Boolean)
    .sort();
}

function networkNames(container) {
  return Object.keys(container?.NetworkSettings?.Networks || {}).sort();
}

function portFlags(container) {
  const bindings = container?.HostConfig?.PortBindings || {};
  const flags = [];
  for (const [containerPort, hostBindings] of Object.entries(bindings)) {
    for (const binding of hostBindings || []) {
      const hostIp = binding.HostIp ? `${binding.HostIp}:` : '';
      flags.push(`-p ${hostIp}${binding.HostPort}:${containerPort}`);
    }
  }
  return flags;
}

function relayHostPort(container) {
  const gunPort = envValue(container, 'GUN_PORT').trim() || '7777';
  if (container?.HostConfig?.NetworkMode === 'host') {
    return gunPort;
  }
  const bindings = container?.HostConfig?.PortBindings || {};
  const candidates = [
    ...(bindings[`${gunPort}/tcp`] || []),
    ...(gunPort === '7777' ? [] : (bindings['7777/tcp'] || [])),
  ];
  const binding = candidates.find((entry) => entry?.HostPort);
  return binding?.HostPort ? String(binding.HostPort).trim() : '';
}

function relayLocalOrigin(name) {
  const port = relayHostPort(byName.get(name));
  return port ? `http://127.0.0.1:${port}` : '';
}

function mountFlags(container) {
  const flags = [];
  for (const mount of container?.Mounts || []) {
    if (!mount.Source || !mount.Destination) continue;
    const mode = mount.RW === false ? 'ro' : (mount.Mode || 'rw');
    flags.push(`-v ${mount.Source}:${mount.Destination}:${mode}`);
  }
  return flags;
}

function envMap(container) {
  const out = new Map();
  for (const entry of container?.Config?.Env || []) {
    const text = String(entry);
    const index = text.indexOf('=');
    if (index <= 0) continue;
    out.set(text.slice(0, index), text.slice(index + 1));
  }
  return out;
}

function envValue(container, name) {
  return envMap(container).get(name) || '';
}

function gunFileDestination(container) {
  const gunFile = envValue(container, 'GUN_FILE').trim();
  if (!gunFile || gunFile === 'data') return '/app/data';
  if (gunFile.startsWith('/')) return gunFile.replace(/\/+$/, '') || '/';
  return `/app/${gunFile.replace(/^\.?\//, '').replace(/\/+$/, '')}`;
}

function dataMount(container) {
  const destination = gunFileDestination(container);
  return (container?.Mounts || []).find((mount) => mount.Destination === destination) || null;
}

function capturedRelayTopology(container) {
  const portBindings = Object.entries(container?.HostConfig?.PortBindings || {})
    .map(([containerPort, bindings]) => ({
      container_port: containerPort,
      host_bindings: (bindings || [])
        .map((binding) => ({
          host_ip: String(binding?.HostIp || ''),
          host_port: String(binding?.HostPort || ''),
        }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    }))
    .sort((left, right) => left.container_port.localeCompare(right.container_port));
  const mounts = (container?.Mounts || [])
    .map((mount) => ({
      type: String(mount?.Type || ''),
      source: String(mount?.Source || ''),
      destination: String(mount?.Destination || ''),
      mode: String(mount?.Mode || ''),
      rw: mount?.RW !== false,
      propagation: String(mount?.Propagation || ''),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    image_id: String(container?.Image || ''),
    image_ref: String(container?.Config?.Image || ''),
    user: String(container?.Config?.User || ''),
    restart: {
      name: String(container?.HostConfig?.RestartPolicy?.Name || ''),
      maximum_retry_count: Number(container?.HostConfig?.RestartPolicy?.MaximumRetryCount || 0),
    },
    memory: Number(container?.HostConfig?.Memory || 0),
    memory_swap: Number(container?.HostConfig?.MemorySwap || 0),
    network_mode: String(container?.HostConfig?.NetworkMode || ''),
    networks: networkNames(container),
    port_bindings: portBindings,
    mounts,
  };
}

function capturedRelayTopologyBase64(container) {
  return Buffer.from(JSON.stringify(capturedRelayTopology(container)), 'utf8').toString('base64');
}

function restartFlag(container, options = {}) {
  if (options.forceRelaySelfRecovery) {
    return '--restart on-failure:5';
  }
  const name = container?.HostConfig?.RestartPolicy?.Name;
  if (!name || name === 'no') return '';
  const maximumRetryCount = container?.HostConfig?.RestartPolicy?.MaximumRetryCount;
  if (name === 'on-failure' && Number(maximumRetryCount) > 0) {
    return `--restart on-failure:${maximumRetryCount}`;
  }
  return `--restart ${name}`;
}

function memoryFlags(options = {}) {
  return options.forceRelaySelfRecovery
    ? [`--memory ${relayMemoryLimit}`, `--memory-swap ${relayMemoryLimit}`]
    : [];
}

function primaryNetworkFlag(container) {
  const names = networkNames(container);
  return names.length > 0 ? `--network ${names[0]}` : '';
}

function shellJoin(parts) {
  return parts.filter(Boolean).join(' \\\n  ');
}

function envEnsureLine(envPath, name, value) {
  return `grep -q '^${name}=' ${envPath} || printf '%s\\n' '${name}=${value}' >> ${envPath}`;
}

function envSetLine(envPath, name, value) {
  return `awk 'BEGIN{done=0} /^${name}=/{print "${name}=${value}"; done=1; next} {print} END{if(!done) print "${name}=${value}"}' ${envPath} > ${envPath}.tmp && mv ${envPath}.tmp ${envPath}`;
}

function relayDefaultHeapThreshold(name) {
  return relayHeapThresholdByName.get(name) ?? '1100000000';
}

function relayDefaultEarlyHeapThreshold(name) {
  if (name.endsWith('-a')) return '500000000';
  if (name.endsWith('-b')) return '520000000';
  if (name.endsWith('-c')) return '540000000';
  return '500000000';
}

function relayDefaultEarlyHeapThresholdList(name) {
  if (name.endsWith('-a')) return '500000000,700000000';
  if (name.endsWith('-b')) return '520000000,720000000';
  if (name.endsWith('-c')) return '540000000,740000000';
  return '500000000,700000000';
}

function relayEarlyHeapThresholdParts(name) {
  const parts = relayDefaultEarlyHeapThresholdList(name).split(',');
  return {
    first: parts[0],
    second: parts[1] || '',
  };
}

function envCaptureCommand(name, rewriteAnalysisTarget = false, relay = false) {
  const envPath = `/tmp/vhc-public-beta-deploy/${name}.env`;
  const relayDefaults = relay ? [
    envEnsureLine(envPath, 'VH_RELAY_RESOURCE_WATCHDOG_ENABLED', 'true'),
    envEnsureLine(envPath, 'VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS', '2000'),
    envSetLine(envPath, 'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES', relayDefaultHeapThreshold(name)),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES', '150000000'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES', '250000000'),
    envEnsureLine(envPath, 'VH_RELAY_DIAGNOSTIC_DIR', '/data/diagnostics'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED', 'true'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_ENABLED', 'true'),
    envSetLine(envPath, 'VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES', relayDefaultEarlyHeapThreshold(name)),
    envSetLine(envPath, 'VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST', relayDefaultEarlyHeapThresholdList(name)),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_POST_HEAP_SNAPSHOT_TRANSIENT_SUPPRESSION_INTERVALS', '2'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_EXIT_GRACE_MS', '30000'),
    envEnsureLine(envPath, 'VH_RELAY_STARTUP_JITTER_MAX_MS', '5000'),
    envEnsureLine(envPath, 'VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY', '2'),
    envEnsureLine(envPath, 'VH_RELAY_CRITICAL_WRITE_READBACK_QUEUE_LIMIT', '16'),
    envEnsureLine(envPath, 'VH_RELAY_CRITICAL_WRITE_READBACK_QUEUE_TIMEOUT_MS', '1000'),
    envEnsureLine(envPath, 'VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES', 'false'),
    envEnsureLine(envPath, 'VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES', 'false'),
    envEnsureLine(envPath, 'VH_RELAY_GUN_GRAPH_SCAN_ENABLED', 'false'),
    envEnsureLine(envPath, 'VH_RELAY_GUN_GRAPH_SCAN_INTERVAL_MS', '60000'),
    envEnsureLine(envPath, 'VH_RELAY_GUN_GRAPH_SCAN_BATCH_SIZE', '1000'),
    envEnsureLine(envPath, 'VH_RELAY_GUN_GRAPH_SCAN_MAX_SOULS', '250000'),
    envEnsureLine(envPath, 'VH_RELAY_GUN_GRAPH_SCAN_MAX_DURATION_MS', '5000'),
  ] : [];
  if (!rewriteAnalysisTarget) {
    return [
      `sudo docker inspect ${name} --format '{{range .Config.Env}}{{println .}}{{end}}' > ${envPath}`,
      ...relayDefaults,
      `chmod 600 ${envPath}`,
    ].join('\n');
  }
  return [
    `sudo docker inspect ${name} --format '{{range .Config.Env}}{{println .}}{{end}}' > ${envPath}.current`,
    `awk 'BEGIN{done=0} /^VH_PUBLIC_ORIGIN_STATIC_DIR=/{next} /^VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH=/{next} /^VH_PUBLIC_ORIGIN_BUILD_REVISION=/{next} /^VH_PUBLIC_ORIGIN_BUILD_CREATED=/{next} /^VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=/{print "VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=${analysisTarget}"; done=1; next} {print} END{if(!done) print "VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=${analysisTarget}"}' ${envPath}.current > ${envPath}`,
    ...relayDefaults,
    `chmod 600 ${envPath}`,
    `rm -f ${envPath}.current`,
  ].join('\n');
}

function escapeExtendedRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function privateDeployWorkDirSetupLines() {
  return [
    'umask 077',
    'if [[ -L /tmp/vhc-public-beta-deploy || ( -e /tmp/vhc-public-beta-deploy && ! -d /tmp/vhc-public-beta-deploy ) ]]; then echo "relay_packet_private_dir_unsafe" >&2; exit 78; fi',
    'install -d -m 700 /tmp/vhc-public-beta-deploy',
    'if ! relay_packet_private_dir_mode="$(stat -c \'%a\' /tmp/vhc-public-beta-deploy 2>/dev/null || stat -f \'%Lp\' /tmp/vhc-public-beta-deploy 2>/dev/null)"; then echo "relay_packet_private_dir_unsafe" >&2; exit 78; fi',
    'if [[ ! -O /tmp/vhc-public-beta-deploy || "${relay_packet_private_dir_mode}" != "700" ]]; then echo "relay_packet_private_dir_unsafe" >&2; exit 78; fi',
  ];
}

function relayDiagnosticEvidenceCommand(name) {
  const container = byName.get(name);
  const mount = dataMount(container);
  const source = mount?.Source;
  if (!source) return `echo "skip ${name}: no relay data mount captured" >&2`;
  const diagnosticsDir = `${source.replace(/\/+$/, '')}/diagnostics`;
  const outDir = '/tmp/vhc-public-beta-deploy/relay-diagnostics-evidence';
  const tarPath = `${outDir}/${name}-diagnostics-safe.tar`;
  return [
    `if sudo test -d ${shellSingleQuote(diagnosticsDir)}; then`,
    `  sudo tar --exclude='*.heapsnapshot' --exclude='*.heapprofile' -C ${shellSingleQuote(diagnosticsDir)} -cf ${shellSingleQuote(tarPath)} .`,
    `  if sudo tar -tf ${shellSingleQuote(tarPath)} | grep -E '\\.(heapsnapshot|heapprofile)$'; then`,
    `    echo "forbidden heap artifact included in ${name} diagnostics evidence tar" >&2`,
    '    exit 78',
    '  fi',
    `else echo "skip ${name}: diagnostics dir not present"; fi`,
  ].join('\n');
}

function runCommandFor(name, image, forceRelayUser = false) {
  const container = byName.get(name);
  const envPath = `/tmp/vhc-public-beta-deploy/${name}.env`;
  const parts = [
    'sudo docker run -d',
    `--name ${name}`,
    restartFlag(container, { forceRelaySelfRecovery: forceRelayUser }),
    ...memoryFlags({ forceRelaySelfRecovery: forceRelayUser }),
    primaryNetworkFlag(container),
    forceRelayUser ? '--user "$(id -u humble):$(id -g humble)"' : '',
    `--env-file ${envPath}`,
    ...portFlags(container),
    ...mountFlags(container),
    image,
  ];
  return shellJoin(parts);
}

function relayOnlyRunCommandFor(name, image) {
  const container = byName.get(name);
  const envPath = `/tmp/vhc-public-beta-deploy/${name}.env`;
  const memory = Number(container?.HostConfig?.Memory || 0);
  const memorySwap = Number(container?.HostConfig?.MemorySwap || 0);
  const user = String(container?.Config?.User || '').trim();
  const parts = [
    'sudo docker run -d',
    `--name ${name}`,
    restartFlag(container),
    memory > 0 ? `--memory ${memory}` : '',
    memorySwap > 0 ? `--memory-swap ${memorySwap}` : '',
    primaryNetworkFlag(container),
    user ? `--user ${shellSingleQuote(user)}` : '',
    `--env-file ${envPath}`,
    ...portFlags(container),
    ...mountFlags(container),
    shellSingleQuote(image),
  ];
  return shellJoin(parts);
}

function relayOnlyVerifierFunction() {
  return [
    'assert_publisher_parked() {',
    '  local active sub result status',
    '  if ! active="$(systemctl --user show vh-news-aggregator.service --property=ActiveState --value 2>/dev/null)"; then echo "publisher_parked_state_unavailable" >&2; return 78; fi',
    '  if ! sub="$(systemctl --user show vh-news-aggregator.service --property=SubState --value 2>/dev/null)"; then echo "publisher_parked_state_unavailable" >&2; return 78; fi',
    '  if ! result="$(systemctl --user show vh-news-aggregator.service --property=Result --value 2>/dev/null)"; then echo "publisher_parked_state_unavailable" >&2; return 78; fi',
    '  if ! status="$(systemctl --user show vh-news-aggregator.service --property=ExecMainStatus --value 2>/dev/null)"; then echo "publisher_parked_state_unavailable" >&2; return 78; fi',
    '  if [[ "${active}" != "failed" || "${sub}" != "failed" || "${result}" != "exit-code" || "${status}" != "78" ]]; then',
    '    echo "publisher_not_exactly_parked_exit_78" >&2',
    '    return 78',
    '  fi',
    '}',
    '',
    'assert_live_topology_parity() {',
    '  local name="$1"',
    '  local expected_base64="$2"',
    '  local expected_env="/tmp/vhc-public-beta-deploy/${name}.env"',
    '  local observed="/tmp/vhc-public-beta-deploy/${name}.prestage.inspect.json"',
    '  if ! sudo docker inspect "${name}" > "${observed}" 2>/dev/null; then',
    '    echo "${name}: live_topology_unavailable" >&2',
    '    return 78',
    '  fi',
    '  chmod 600 "${observed}" || return 78',
    '  if ! EXPECTED_TOPOLOGY_BASE64="${expected_base64}" OBSERVED_INSPECT="${observed}" EXPECTED_ENV="${expected_env}" python3 <<\'PY\'',
    'import base64, json, os, sys',
    'def normalize(container):',
    '    bindings = container.get("HostConfig", {}).get("PortBindings") or {}',
    '    ports = []',
    '    for container_port, host_bindings in bindings.items():',
    '        normalized = [{"host_ip": str(item.get("HostIp") or ""), "host_port": str(item.get("HostPort") or "")} for item in (host_bindings or [])]',
    '        normalized.sort(key=lambda item: json.dumps(item, sort_keys=True))',
    '        ports.append({"container_port": container_port, "host_bindings": normalized})',
    '    ports.sort(key=lambda item: item["container_port"])',
    '    mounts = []',
    '    for mount in container.get("Mounts") or []:',
    '        mounts.append({"type": str(mount.get("Type") or ""), "source": str(mount.get("Source") or ""), "destination": str(mount.get("Destination") or ""), "mode": str(mount.get("Mode") or ""), "rw": mount.get("RW") is not False, "propagation": str(mount.get("Propagation") or "")})',
    '    mounts.sort(key=lambda item: json.dumps(item, sort_keys=True))',
    '    host = container.get("HostConfig") or {}',
    '    config = container.get("Config") or {}',
    '    restart = host.get("RestartPolicy") or {}',
    '    networks = sorted((container.get("NetworkSettings", {}).get("Networks") or {}).keys())',
    '    return {"image_id": str(container.get("Image") or ""), "image_ref": str(config.get("Image") or ""), "user": str(config.get("User") or ""), "restart": {"name": str(restart.get("Name") or ""), "maximum_retry_count": int(restart.get("MaximumRetryCount") or 0)}, "memory": int(host.get("Memory") or 0), "memory_swap": int(host.get("MemorySwap") or 0), "network_mode": str(host.get("NetworkMode") or ""), "networks": networks, "port_bindings": ports, "mounts": mounts}',
    'try:',
    '    expected = json.loads(base64.b64decode(os.environ["EXPECTED_TOPOLOGY_BASE64"]).decode("utf-8"))',
    '    observed_payload = json.load(open(os.environ["OBSERVED_INSPECT"], encoding="utf-8"))',
    '    if not isinstance(observed_payload, list) or len(observed_payload) != 1: raise ValueError("closed")',
    '    with open(os.environ["EXPECTED_ENV"], encoding="utf-8") as handle: expected_env = sorted(handle.read().splitlines())',
    '    observed_env = sorted(str(item) for item in ((observed_payload[0].get("Config") or {}).get("Env") or []))',
    '    if normalize(observed_payload[0]) != expected or observed_env != expected_env: raise ValueError("closed")',
    'except Exception:',
    '    raise SystemExit(78)',
    'PY',
    '  then',
    '    echo "${name}: captured_live_topology_parity_failed" >&2',
    '    return 78',
    '  fi',
    '}',
    '',
    'assert_relay_prestate() {',
    '  local name="$1"',
    '  local origin="$2"',
    '  local phase="$3"',
    '  local ready="/tmp/vhc-public-beta-deploy/${name}.${phase}.readyz.json"',
    '  local metrics="/tmp/vhc-public-beta-deploy/${name}.${phase}.metrics"',
    '  if [[ "$(sudo docker inspect "${name}" --format \'{{.State.Running}}\' 2>/dev/null)" != "true" ]]; then echo "${name}: prestage_not_running" >&2; return 78; fi',
    '  if [[ "$(sudo docker inspect "${name}" --format \'{{.State.OOMKilled}}\' 2>/dev/null)" != "false" ]]; then echo "${name}: prestage_oom_state_failed" >&2; return 78; fi',
    '  if ! curl -fsS --max-time 5 "${origin}/readyz" > "${ready}" 2>/dev/null; then echo "${name}: prestage_readiness_failed" >&2; return 78; fi',
    '  if ! curl -fsS --max-time 5 "${origin}/metrics" > "${metrics}" 2>/dev/null; then echo "${name}: prestage_metrics_failed" >&2; return 78; fi',
    '  chmod 600 "${ready}" "${metrics}" || return 78',
    '  if ! awk \'BEGIN{trip=0;uptime=0;rss=0} $1 ~ /^vh_relay_resource_watchdog_trips_total/ {trip+=1; if (trip > 1 || NF != 2 || $1 !~ /^vh_relay_resource_watchdog_trips_total(\\{[^}]*\\})?$/ || $2 !~ /^[0-9]+([.][0-9]+)?$/ || $2 + 0 != 0) exit 1; next} $1 ~ /^vh_relay_uptime_seconds/ {uptime+=1; if (uptime > 1 || NF != 2 || $1 != "vh_relay_uptime_seconds" || $2 !~ /^[0-9]+$/) exit 1; next} $1 ~ /^vh_relay_process_rss_bytes/ {rss+=1; if (rss > 1 || NF != 2 || $1 != "vh_relay_process_rss_bytes" || $2 !~ /^[0-9]+([.][0-9]+)?$/ || $2 + 0 <= 0) exit 1; next} END{if(uptime != 1 || rss != 1) exit 1}\' "${metrics}"; then',
    '    echo "${name}: preexisting_relay_metrics_invalid_or_watchdog_nonzero" >&2',
    '    return 78',
    '  fi',
    '}',
    '',
    'verify_exact_missing_key() {',
    '  local origin="$1"',
    '  local route="$2"',
    '  local query="$3"',
    '  local expected_error="$4"',
    '  local story_id="$5"',
    '  local label="$6"',
    '  local body="/tmp/vhc-public-beta-deploy/${label}.missing.json"',
    '  local status',
    '  if ! status="$(curl --silent --show-error --max-time 10 --output "${body}" --write-out "%{http_code}" "${origin}${route}?${query}")"; then',
    '    echo "${label}: exact missing-key request failed" >&2',
    '    return 78',
    '  fi',
    '  chmod 600 "${body}" || return 78',
    '  if [[ "${status}" != "404" ]]; then',
    '    echo "${label}: expected exact missing-key HTTP 404, got ${status}" >&2',
    '    return 78',
    '  fi',
    '  if ! python3 - "${body}" "${expected_error}" "${story_id}" <<\'PY\'',
    'import json, sys',
    'path, expected_error, story_id = sys.argv[1:]',
    'try:',
    '    with open(path, "r", encoding="utf-8") as handle: payload = json.load(handle)',
    '    if payload != {"ok": False, "error": expected_error, "story_id": story_id}: raise ValueError("closed")',
    'except Exception:',
    '    raise SystemExit(78)',
    'PY',
    '  then',
    '    echo "${label}: exact_missing_key_contract_mismatch" >&2',
    '    return 78',
    '  fi',
    '}',
    '',
    'verify_relay_only_runtime() {',
    '  local name="$1"',
    '  local origin="$2"',
    '  local data_destination="$3"',
    '  local expected_revision="$4"',
    '  local missing_story_id="vh-s1b-exact-missing-${expected_revision}-${name}"',
    '  local ready="/tmp/vhc-public-beta-deploy/${name}.readyz.json"',
    '  local health="/tmp/vhc-public-beta-deploy/${name}.healthz.json"',
    '  local metrics="/tmp/vhc-public-beta-deploy/${name}.metrics"',
    '  local attempt=1',
    '  while [[ "${attempt}" -le 60 ]]; do',
    '    if curl -fsS --max-time 5 "${origin}/readyz" > "${ready}"; then break; fi',
    '    if [[ "${attempt}" -eq 60 ]]; then echo "${name}: /readyz failed; stop before the next relay" >&2; return 78; fi',
    '    sleep 1',
    '    attempt=$((attempt + 1))',
    '  done',
    '  curl -fsS --max-time 5 "${origin}/healthz" > "${health}" || return 78',
    '  if ! python3 - "${ready}" "${health}" <<\'PY\'',
    'import json, sys',
    'ready, health = (json.load(open(path, encoding="utf-8")) for path in sys.argv[1:])',
    'if ready.get("ok") is not True or ready.get("service") != "vh-relay": raise SystemExit("relay readyz contract failed")',
    'if health.get("ok") is not True or health.get("service") != "vh-relay": raise SystemExit("relay healthz contract failed")',
    'PY',
    '  then return 78; fi',
    '  test "$(sudo docker inspect "${name}" --format \'{{.State.Running}}\')" = "true" || return 78',
    '  test "$(sudo docker inspect "${name}" --format \'{{.State.OOMKilled}}\')" = "false" || return 78',
    '  sudo docker exec "${name}" test -s "${data_destination}/news-latest-index-snapshot.json" || return 78',
    '  sudo docker exec "${name}" test -s "${data_destination}/news-synthesis-lifecycle-snapshot.json" || return 78',
    '  sudo docker exec "${name}" test -s "${data_destination}/topic-synthesis-latest-snapshot.json" || return 78',
    '  sudo sha256sum -c "/tmp/vhc-public-beta-deploy/${name}.snapshots.sha256" || return 78',
    '  curl -fsS --max-time 5 "${origin}/metrics" > "${metrics}" || return 78',
    '  if ! awk \'BEGIN{trip=0;uptime=0;rss=0} $1 ~ /^vh_relay_resource_watchdog_trips_total/ {trip+=1; if (trip > 1 || NF != 2 || $1 !~ /^vh_relay_resource_watchdog_trips_total(\\{[^}]*\\})?$/ || $2 !~ /^[0-9]+([.][0-9]+)?$/ || $2 + 0 != 0) exit 1; next} $1 ~ /^vh_relay_uptime_seconds/ {uptime+=1; if (uptime > 1 || NF != 2 || $1 != "vh_relay_uptime_seconds" || $2 !~ /^[0-9]+$/) exit 1; next} $1 ~ /^vh_relay_process_rss_bytes/ {rss+=1; if (rss > 1 || NF != 2 || $1 != "vh_relay_process_rss_bytes" || $2 !~ /^[0-9]+([.][0-9]+)?$/ || $2 + 0 <= 0) exit 1; next} END{if(uptime != 1 || rss != 1) exit 1}\' "${metrics}"; then',
    '    echo "${name}: relay_metrics_invalid_or_watchdog_nonzero" >&2',
    '    return 78',
    '  fi',
    '  LC_ALL=C sort "/tmp/vhc-public-beta-deploy/${name}.env" > "/tmp/vhc-public-beta-deploy/${name}.env.expected" || return 78',
    '  sudo docker inspect "${name}" --format \'{{range .Config.Env}}{{println .}}{{end}}\' | LC_ALL=C sort > "/tmp/vhc-public-beta-deploy/${name}.env.observed" || return 78',
    '  chmod 600 "/tmp/vhc-public-beta-deploy/${name}.env.expected" "/tmp/vhc-public-beta-deploy/${name}.env.observed" || return 78',
    '  if ! cmp -s "/tmp/vhc-public-beta-deploy/${name}.env.expected" "/tmp/vhc-public-beta-deploy/${name}.env.observed"; then',
    '    echo "${name}: environment differs from captured prestate; values withheld" >&2',
    '    return 78',
    '  fi',
    '  verify_exact_missing_key "${origin}" "/vh/news/story" "story_id=${missing_story_id}&readback=exact" "news-story-not-found" "${missing_story_id}" "${name}.story" || return 78',
    '  verify_exact_missing_key "${origin}" "/vh/news/latest-index" "story_id=${missing_story_id}" "news-latest-index-not-found" "${missing_story_id}" "${name}.latest-index" || return 78',
    '  verify_exact_missing_key "${origin}" "/vh/news/hot-index" "story_id=${missing_story_id}" "news-hot-index-not-found" "${missing_story_id}" "${name}.hot-index" || return 78',
    '  verify_exact_missing_key "${origin}" "/vh/news/synthesis-lifecycle" "story_id=${missing_story_id}&readback=exact" "news-synthesis-lifecycle-not-found" "${missing_story_id}" "${name}.synthesis-lifecycle" || return 78',
    '  echo "[relay-only] ${name}: readiness, liveness, snapshots, OOM/watchdog, env parity, and four exact missing-key contracts pass"',
    '}',
  ].join('\n');
}

function rollingRelayVerifierFunction() {
  return [
    'verify_rolling_relay() {',
    '  local name="$1"',
    '  local origin="$2"',
    '  local data_destination="$3"',
    '  local first_threshold="$4"',
    '  local second_threshold="$5"',
    '  local metrics="/tmp/vhc-public-beta-deploy/${name}.metrics"',
    '  local latest="/tmp/vhc-public-beta-deploy/${name}.latest-index.json"',
    '  echo "[rolling-relay] waiting for ${name} readyz at ${origin}"',
    '  local attempt=1',
    '  while [[ "${attempt}" -le 60 ]]; do',
    '    if curl -fsS "${origin}/readyz" > "/tmp/vhc-public-beta-deploy/${name}.readyz.json"; then',
    '      break',
    '    fi',
    '    if [[ "${attempt}" -eq 60 ]]; then',
    '      echo "${name}: /readyz did not pass after 60s; stop before touching the next relay" >&2',
    '      exit 78',
    '    fi',
    '    sleep 1',
    '    attempt=$((attempt + 1))',
    '  done',
    '  sudo docker exec "${name}" test -f "${data_destination}/news-latest-index-snapshot.json"',
    '  sudo docker exec "${name}" test -f "${data_destination}/news-synthesis-lifecycle-snapshot.json"',
    '  sudo docker exec "${name}" test -f "${data_destination}/topic-synthesis-latest-snapshot.json"',
    '  curl -fsS "${origin}/vh/news/latest-index?limit=1&scan_limit=3&persist=false" > "${latest}"',
    '  python3 - "${latest}" "${name}" <<\'PY\'',
    'import json, sys',
    'path, name = sys.argv[1], sys.argv[2]',
    'with open(path, "r", encoding="utf-8") as handle:',
    '    payload = json.load(handle)',
    'if payload.get("ok") is not True:',
    '    raise SystemExit(f"{name}: latest-index snapshot reload returned ok={payload.get(\'ok\')}")',
    'record_count = payload.get("record_count")',
    'records = payload.get("records")',
    'if not isinstance(record_count, int) or record_count <= 0:',
    '    raise SystemExit(f"{name}: latest-index snapshot reload record_count={record_count}")',
    'if not isinstance(records, dict) or not records:',
    '    raise SystemExit(f"{name}: latest-index snapshot reload records empty")',
    'print(json.dumps({"relay": name, "latest_index_snapshot_reload": "pass", "record_count": record_count}, sort_keys=True))',
    'PY',
    '  test "$(sudo docker exec "${name}" printenv VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST)" = "${first_threshold},${second_threshold}"',
    '  test "$(sudo docker exec "${name}" printenv VH_RELAY_WATCHDOG_POST_HEAP_SNAPSHOT_TRANSIENT_SUPPRESSION_INTERVALS)" = "2"',
    '  local metrics_attempt=1',
    '  while [[ "${metrics_attempt}" -le 60 ]]; do',
    '    curl -fsS "${origin}/metrics" > "${metrics}"',
    '    if grep -F "vh_relay_watchdog_early_heap_snapshot_threshold_bytes{threshold_index=\\"1\\",threshold_bytes=\\"${first_threshold}\\"} ${first_threshold}" "${metrics}" >/dev/null \\',
    '      && grep -F "vh_relay_watchdog_early_heap_snapshot_threshold_bytes{threshold_index=\\"2\\",threshold_bytes=\\"${second_threshold}\\"} ${second_threshold}" "${metrics}" >/dev/null \\',
    '      && grep -F "vh_relay_watchdog_transient_breach_suppression_samples_remaining" "${metrics}" >/dev/null \\',
    '      && awk \'/^vh_relay_resource_watchdog_trips_total/ { if ($NF != 0) exit 1 }\' "${metrics}"; then',
    '      if grep -q \'^vh_relay_gun_graph_scan_enabled 1$\' "${metrics}"; then',
    '        if grep -E \'^vh_relay_gun_graph_scan_age_ms [0-9]+$\' "${metrics}" >/dev/null \\',
    '          && grep -F \'vh_relay_gun_graph_scan_truncated 0\' "${metrics}" >/dev/null; then',
    '          break',
    '        fi',
    '      else',
    '        break',
    '      fi',
    '    fi',
    '    if [[ "${metrics_attempt}" -eq 60 ]]; then',
    '      echo "${name}: metrics did not advertise expected threshold/suppression/graph health within 60s" >&2',
    '      exit 78',
    '    fi',
    '    sleep 1',
    '    metrics_attempt=$((metrics_attempt + 1))',
    '  done',
    '  echo "[rolling-relay] ${name} verified; quorum-safe to proceed to the next relay"',
    '}',
  ].join('\n');
}

const blockers = [];
for (const name of relayNames) {
  const container = byName.get(name);
  const mount = dataMount(container);
  const destination = gunFileDestination(container);
  if (!mount) {
    blockers.push(`${name}: missing ${destination} mount for GUN_FILE`);
  } else if (mount.Type !== 'bind') {
    blockers.push(`${name}: ${destination} mount is ${mount.Type}, expected bind`);
  } else if (!mount.Source.includes(`/vhc-${name}/data`) && !mount.Source.endsWith(`/${name}/data`)) {
    blockers.push(`${name}: ${destination} source is unusual: ${mount.Source}`);
  }
  if (!relayLocalOrigin(name)) {
    blockers.push(`${name}: missing host port binding for relay readyz/metrics verification`);
  }
  if (relayOnly && networkNames(container).length !== 1) {
    blockers.push(`${name}: relay-only recovery requires exactly one captured network`);
  }
}

const lines = [];
const psPattern = requiredNames.map(escapeExtendedRegex).join('|');
lines.push(relayOnly ? '# A6 S1B Relay-Only Recovery Packet' : '# A6 Public-Beta Deploy Packet');
lines.push('');
lines.push('Generated from captured `docker inspect` JSON. This packet is secret-safe: it records env var names and uses host-side env-file capture commands without printing values.');
if (relayOnly) {
  lines.push('Status: `WAITING_FOR_LOU`. Generation is repo-side preparation only; no command in this packet is authorized until Lou explicitly corrects the relay-restart boundary and approves the exact reviewed packet.');
  lines.push('Scope is exactly `vhc-relay-a`, `vhc-relay-b`, then `vhc-relay-c`. Origin and publisher deployment are excluded. The publisher must remain parked throughout.');
}
lines.push('');
lines.push('## Images');
lines.push('');
if (!relayOnly) lines.push(`- new origin image: \`${newOriginImage}\``);
lines.push(`- new relay image: \`${newRelayImage}\``);
if (relayOnly) {
  lines.push(`- expected relay revision: \`${expectedRelayRevision}\``);
  lines.push('- required relay platform: `linux/amd64`');
} else {
  lines.push(`- expected origin revision: \`${expectedOriginRevision || 'not asserted'}\``);
  lines.push(`- corrected analysis target: \`${analysisTarget}\``);
}
lines.push('');
lines.push('## Current Containers');
lines.push('');
for (const name of requiredNames) {
  const container = byName.get(name);
  const dataDestination = relayNames.includes(name) ? gunFileDestination(container) : null;
  lines.push(`### ${name}`);
  lines.push('');
  lines.push(`- current image tag: \`${container.Config?.Image || 'unknown'}\``);
  lines.push(`- current image id: \`${container.Image || 'unknown'}\``);
  lines.push(`- networks: \`${networkNames(container).join(', ') || 'none'}\``);
  lines.push(`- env names: \`${envNames(container).join(', ')}\``);
  if (dataDestination) lines.push(`- GUN_FILE destination: \`${dataDestination}\``);
  lines.push(`- mounts: \`${mountFlags(container).join(' ; ') || 'none'}\``);
  lines.push('');
}
if (blockers.length > 0) {
  lines.push('## Packet Blockers');
  lines.push('');
  for (const blocker of blockers) lines.push(`- ${blocker}`);
  lines.push('');
  lines.push('Do not deploy until every blocker is resolved in the capture input.');
  console.log(lines.join('\n'));
  process.exit(78);
}

lines.push('## Read-Only Precheck');
lines.push('');
lines.push('```bash');
lines.push('set -euo pipefail');
if (relayOnly) lines.push(...privateDeployWorkDirSetupLines());
lines.push(`sudo docker ps --format "{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}" | grep -E ${shellSingleQuote(psPattern)}`);
lines.push('python3 <<\'PY\'');
lines.push('import json, os, time');
lines.push('SNAPSHOTS = {');
for (const name of relayNames) {
  const source = dataMount(byName.get(name)).Source;
  lines.push(`  "${name}": "${source}",`);
}
lines.push('}');
lines.push('REQUIRED = {');
lines.push('  "news-latest-index-snapshot.json": "vh-news-latest-index-relay-snapshot-v1",');
lines.push('  "news-synthesis-lifecycle-snapshot.json": "vh-news-synthesis-lifecycle-relay-snapshot-v1",');
lines.push('  "topic-synthesis-latest-snapshot.json": "vh-topic-synthesis-latest-relay-snapshot-v1",');
lines.push('}');
lines.push('now = time.time() * 1000');
lines.push('for relay, root in SNAPSHOTS.items():');
lines.push('    if not os.path.isdir(root): raise SystemExit(f"{relay}: data dir missing: {root}")');
lines.push('    if not os.access(root, os.W_OK): raise SystemExit(f"{relay}: data dir not writable by current user: {root}")');
lines.push('for relay, root in SNAPSHOTS.items():');
lines.push('    for filename, schema in REQUIRED.items():');
lines.push('        path = os.path.join(root, filename)');
lines.push('        st = os.stat(path)');
lines.push('        if st.st_size <= 0: raise SystemExit(f"{relay}:{filename}: empty")');
lines.push('        with open(path, "r", encoding="utf-8") as handle: payload = json.load(handle)');
lines.push('        if payload.get("schema_version") != schema: raise SystemExit(f"{relay}:{filename}: bad schema {payload.get(\'schema_version\')}")');
lines.push('        if filename == "news-latest-index-snapshot.json":');
lines.push('            entries = payload.get("entries")');
lines.push('            if not isinstance(entries, list) or len(entries) == 0: raise SystemExit(f"{relay}:{filename}: entries={len(entries) if isinstance(entries, list) else \'n/a\'}")');
lines.push('            newest = max((entry.get("record", {}).get("latest_activity_at") or entry.get("story", {}).get("cluster_window_end") or 0) for entry in entries)');
lines.push('            print(json.dumps({"relay": relay, "file": filename, "size": st.st_size, "mtime": st.st_mtime, "cached_at": payload.get("cached_at"), "entry_count": len(entries), "newest_entry_age_ms": now - newest}, sort_keys=True))');
lines.push('        else:');
lines.push('            print(json.dumps({"relay": relay, "file": filename, "size": st.st_size, "mtime": st.st_mtime, "cached_at": payload.get("cached_at")}, sort_keys=True))');
lines.push('PY');
if (relayOnly) {
  for (const name of relayNames) {
    const origin = relayLocalOrigin(name);
    lines.push(`test "$(sudo docker inspect ${name} --format '{{.State.Running}}')" = "true"`);
    lines.push(`test "$(sudo docker inspect ${name} --format '{{.State.OOMKilled}}')" = "false"`);
    lines.push(`curl -fsS --max-time 5 ${shellSingleQuote(`${origin}/readyz`)} > /tmp/vhc-public-beta-deploy/${name}.initial.readyz.json`);
    lines.push(`curl -fsS --max-time 5 ${shellSingleQuote(`${origin}/metrics`)} > /tmp/vhc-public-beta-deploy/${name}.initial.metrics`);
    lines.push(`chmod 600 /tmp/vhc-public-beta-deploy/${name}.initial.readyz.json /tmp/vhc-public-beta-deploy/${name}.initial.metrics`);
    lines.push(`if ! awk 'BEGIN{trip=0;uptime=0;rss=0} $1 ~ /^vh_relay_resource_watchdog_trips_total/ {trip+=1; if (trip > 1 || NF != 2 || $1 !~ /^vh_relay_resource_watchdog_trips_total(\\{[^}]*\\})?$/ || $2 !~ /^[0-9]+([.][0-9]+)?$/ || $2 + 0 != 0) exit 1; next} $1 ~ /^vh_relay_uptime_seconds/ {uptime+=1; if (uptime > 1 || NF != 2 || $1 != "vh_relay_uptime_seconds" || $2 !~ /^[0-9]+$/) exit 1; next} $1 ~ /^vh_relay_process_rss_bytes/ {rss+=1; if (rss > 1 || NF != 2 || $1 != "vh_relay_process_rss_bytes" || $2 !~ /^[0-9]+([.][0-9]+)?$/ || $2 + 0 <= 0) exit 1; next} END{if(uptime != 1 || rss != 1) exit 1}' /tmp/vhc-public-beta-deploy/${name}.initial.metrics; then echo "${name}: preexisting_relay_metrics_invalid_or_watchdog_nonzero" >&2; exit 78; fi`);
  }
  lines.push("if ! publisher_active_state=\"$(systemctl --user show vh-news-aggregator.service --property=ActiveState --value 2>/dev/null)\"; then echo \"publisher_parked_state_unavailable\" >&2; exit 78; fi");
  lines.push("if ! publisher_sub_state=\"$(systemctl --user show vh-news-aggregator.service --property=SubState --value 2>/dev/null)\"; then echo \"publisher_parked_state_unavailable\" >&2; exit 78; fi");
  lines.push("if ! publisher_result=\"$(systemctl --user show vh-news-aggregator.service --property=Result --value 2>/dev/null)\"; then echo \"publisher_parked_state_unavailable\" >&2; exit 78; fi");
  lines.push("if ! publisher_exec_status=\"$(systemctl --user show vh-news-aggregator.service --property=ExecMainStatus --value 2>/dev/null)\"; then echo \"publisher_parked_state_unavailable\" >&2; exit 78; fi");
  lines.push('if [[ "${publisher_active_state}" != "failed" || "${publisher_sub_state}" != "failed" || "${publisher_result}" != "exit-code" || "${publisher_exec_status}" != "78" ]]; then echo "publisher_not_exactly_parked_exit_78" >&2; exit 78; fi');
}
lines.push('```');
lines.push('');
lines.push('Abort if any relay data dir is empty, not a bind mount, not writable by `humble`, has a missing snapshot, has a schema mismatch, or has an empty/non-list latest-index entries array.');
lines.push('');

lines.push('## Safe Relay Diagnostics Evidence Capture');
lines.push('');
lines.push('Relay `.heapsnapshot` and `.heapprofile` artifacts are host-private and may contain heap object strings. Use this command when collecting shareable diagnostics; it excludes heap artifacts and fails closed if any appear in the tar manifest. Share `.heap-summary.json` and redacted summaries only unless a separate secret-review approval authorizes raw heap artifacts.');
lines.push('');
lines.push('```bash');
lines.push('set -euo pipefail');
if (relayOnly) lines.push(...privateDeployWorkDirSetupLines());
lines.push('install -d -m 700 /tmp/vhc-public-beta-deploy/relay-diagnostics-evidence');
for (const name of relayNames) {
  lines.push(relayDiagnosticEvidenceCommand(name));
}
lines.push('```');
lines.push('');

lines.push('## Env Capture');
lines.push('');
lines.push('```bash');
lines.push('set -euo pipefail');
if (relayOnly) lines.push(...privateDeployWorkDirSetupLines());
else lines.push('install -d -m 700 /tmp/vhc-public-beta-deploy');
for (const name of relayNames) {
  lines.push(envCaptureCommand(name, false, !relayOnly));
  if (relayOnly) {
    const source = dataMount(byName.get(name)).Source.replace(/\/+$/, '');
    lines.push(`sudo sha256sum ${shellSingleQuote(`${source}/news-latest-index-snapshot.json`)} ${shellSingleQuote(`${source}/news-synthesis-lifecycle-snapshot.json`)} ${shellSingleQuote(`${source}/topic-synthesis-latest-snapshot.json`)} > /tmp/vhc-public-beta-deploy/${name}.snapshots.sha256`);
    lines.push(`chmod 600 /tmp/vhc-public-beta-deploy/${name}.snapshots.sha256`);
  }
}
if (!relayOnly) lines.push(envCaptureCommand(originName, true));
lines.push('```');
lines.push('');

if (relayOnly) {
  lines.push('## Relay Image Preflight');
  lines.push('');
  lines.push('This read-only gate must pass before any container removal. It proves the locally loaded relay image is the reviewed commit and the A6 architecture; a tag match alone is insufficient.');
  lines.push('');
  lines.push('```bash');
  lines.push('set -euo pipefail');
  lines.push(`relay_image_platform="$(sudo docker image inspect ${shellSingleQuote(newRelayImage)} --format '{{.Os}}/{{.Architecture}}')"`);
  lines.push('if [[ "${relay_image_platform}" != "linux/amd64" ]]; then echo "relay image platform mismatch: ${relay_image_platform}" >&2; exit 78; fi');
  lines.push(`relay_image_revision="$(sudo docker image inspect ${shellSingleQuote(newRelayImage)} --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"`);
  lines.push(`if [[ "\${relay_image_revision}" != ${shellSingleQuote(expectedRelayRevision)} ]]; then echo "relay image revision mismatch" >&2; exit 78; fi`);
  lines.push('```');
  lines.push('');
}

if (includeRecreate) {
  if (relayOnly) {
    lines.push('## Approval-Gated Relay-Only Rolling Recovery');
    lines.push('');
    lines.push('Hard authority gate: do not run this section until Lou explicitly approves replacing the contradictory no-relay-restart boundary for this exact reviewed revision. Approval is limited to A, then B, then C; it does not authorize origin, publisher, data, quorum, timeout, recipient, provider, pager, or monitor mutation.');
    lines.push('');
    lines.push('Each relay is verified before the next is touched. A fresh live/captured topology comparison and authenticated zero-trip prestate run for that relay, then the publisher must still be exactly `failed/failed`, `Result=exit-code`, `ExecMainStatus=78` as the final gate before removal. An absent watchdog-trip row is semantic zero only when exactly one valid uptime row and one positive process-RSS row authenticate the payload. Any precondition refusal exits `78` without remove, run, or rollback; only the mutation-started latch at the removal boundary enables recovery. After runtime verification, the publisher is checked again before GO. Any failure after mutation begins immediately recreates only the current relay from its captured immutable image id, verifies readiness/topology/snapshot/OOM state, and exits `78`. Never continue to the next relay after rollback.');
    lines.push('');
    lines.push('```bash');
    lines.push('set -euo pipefail');
    lines.push(...privateDeployWorkDirSetupLines());
    lines.push(relayOnlyVerifierFunction());
    lines.push('');
    for (const name of relayNames) {
      const container = byName.get(name);
      const dataDestination = gunFileDestination(container);
      const origin = relayLocalOrigin(name);
      const rollbackImage = container.Image || container.Config?.Image || '<captured-relay-image-id>';
      const expectedTopology = capturedRelayTopologyBase64(container);
      const rollbackTopology = capturedRelayTopology(container);
      rollbackTopology.image_id = rollbackImage;
      rollbackTopology.image_ref = rollbackImage;
      const rollbackTopologyBase64 = Buffer.from(JSON.stringify(rollbackTopology), 'utf8').toString('base64');
      const stage = name.endsWith('-a') ? 'A' : name.endsWith('-b') ? 'B' : 'C';
      lines.push(`# Stage ${stage}: re-prove parked publisher and exact live/captured prestate, then replace only ${name}.`);
      lines.push('if ! {');
      lines.push(`  assert_live_topology_parity ${shellSingleQuote(name)} ${shellSingleQuote(expectedTopology)} &&`);
      lines.push(`  assert_relay_prestate ${shellSingleQuote(name)} ${shellSingleQuote(origin)} ${shellSingleQuote(`prestage-${stage.toLowerCase()}`)} &&`);
      lines.push('  assert_publisher_parked');
      lines.push('}; then');
      lines.push(`  echo "${name}: pre_mutation_refused_no_change" >&2`);
      lines.push('  exit 78');
      lines.push('fi');
      lines.push('relay_mutation_started=true');
      lines.push('if ! {');
      lines.push(`  sudo docker rm -f ${name} &&`);
      lines.push(`${relayOnlyRunCommandFor(name, newRelayImage)} &&`.split('\n').map((line) => `  ${line}`).join('\n'));
      lines.push(`  test "$(sudo docker inspect ${name} --format '{{.Config.Image}}')" = ${shellSingleQuote(newRelayImage)} &&`);
      lines.push(`  test "$(sudo docker image inspect "$(sudo docker inspect ${name} --format '{{.Image}}')" --format '{{.Os}}/{{.Architecture}}')" = "linux/amd64" &&`);
      lines.push(`  test "$(sudo docker image inspect "$(sudo docker inspect ${name} --format '{{.Image}}')" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = ${shellSingleQuote(expectedRelayRevision)} &&`);
      lines.push(`  verify_relay_only_runtime ${shellSingleQuote(name)} ${shellSingleQuote(origin)} ${shellSingleQuote(dataDestination)} ${shellSingleQuote(expectedRelayRevision)} &&`);
      lines.push('  assert_publisher_parked');
      lines.push('}; then');
      lines.push('  if [[ "${relay_mutation_started}" != "true" ]]; then echo "relay_mutation_latch_missing" >&2; exit 78; fi');
      lines.push(`  echo "${name}: verification failed; rolling back only this relay and stopping" >&2`);
      lines.push(`  if sudo docker inspect ${name} >/dev/null 2>&1; then`);
      lines.push(`    if ! sudo docker rm -f ${name} >/dev/null 2>&1; then echo "${name}: rollback_remove_failed" >&2; exit 78; fi`);
      lines.push('  fi');
      lines.push(`  if ! ${relayOnlyRunCommandFor(name, rollbackImage)} >/tmp/vhc-public-beta-deploy/${name}.rollback.start.out 2>&1; then`);
      lines.push(`    if ! chmod 600 /tmp/vhc-public-beta-deploy/${name}.rollback.start.out; then echo "${name}: rollback_evidence_permission_failed" >&2; exit 78; fi`);
      lines.push(`    echo "${name}: rollback_start_failed" >&2`);
      lines.push('    exit 78');
      lines.push('  fi');
      lines.push(`  if ! chmod 600 /tmp/vhc-public-beta-deploy/${name}.rollback.start.out; then echo "${name}: rollback_evidence_permission_failed" >&2; exit 78; fi`);
      lines.push('  rollback_attempt=1');
      lines.push('  rollback_ready=false');
      lines.push('  while [[ "${rollback_attempt}" -le 60 ]]; do');
      lines.push(`    if curl -fsS --max-time 5 ${shellSingleQuote(`${origin}/readyz`)} >/tmp/vhc-public-beta-deploy/${name}.rollback.readyz.json 2>/dev/null; then rollback_ready=true; break; fi`);
      lines.push('    sleep 1; rollback_attempt=$((rollback_attempt + 1))');
      lines.push('  done');
      lines.push(`  if [[ "\${rollback_ready}" != "true" ]]; then echo "${name}: rollback_readiness_failed" >&2; exit 78; fi`);
      lines.push(`  if ! assert_live_topology_parity ${shellSingleQuote(name)} ${shellSingleQuote(rollbackTopologyBase64)}; then echo "${name}: rollback_topology_failed" >&2; exit 78; fi`);
      lines.push(`  if [[ "$(sudo docker inspect ${name} --format '{{.State.OOMKilled}}' 2>/dev/null)" != "false" ]]; then echo "${name}: rollback_oom_state_failed" >&2; exit 78; fi`);
      lines.push(`  if ! sudo sha256sum -c /tmp/vhc-public-beta-deploy/${name}.snapshots.sha256 >/tmp/vhc-public-beta-deploy/${name}.rollback.snapshots.check 2>&1; then echo "${name}: rollback_snapshot_integrity_failed" >&2; exit 78; fi`);
      lines.push(`  if ! chmod 600 /tmp/vhc-public-beta-deploy/${name}.rollback.readyz.json /tmp/vhc-public-beta-deploy/${name}.rollback.snapshots.check; then echo "${name}: rollback_evidence_permission_failed" >&2; exit 78; fi`);
      lines.push(`  echo "${name}: rollback_completed_closed" >&2`);
      lines.push('  exit 78');
      lines.push('fi');
      lines.push('relay_mutation_started=false');
      lines.push(`echo "${name}: GO for next relay"`);
      lines.push('');
    }
    lines.push('```');
    lines.push('');
    lines.push('## Hard Stop Conditions');
    lines.push('');
    lines.push('- Stop before container removal on absent explicit Lou approval, wrong commit/revision, non-`linux/amd64` image, publisher state other than exact failed/failed exit 78, missing relay, any live/captured image/env/mount/network/port/restart/user/memory drift, unreadable or changed snapshot, pre-existing OOM/watchdog trip, unauthenticated or malformed metrics, or non-green readiness. A pre-mutation refusal does not invoke rollback.');
    lines.push('- After mutation begins, roll back the current relay and stop on publisher transition/resume during verification, readiness/health failure, environment mismatch, snapshot checksum drift, OOM/watchdog trip, wrong image id/revision/platform, or any of the four exact missing-key probes returning anything other than its closed 404 body. Unexpected bodies remain private; only a closed reason code may print.');
    lines.push('- Never batch removals, skip A/B/C order, continue after rollback, clear data, alter quorum/timeouts, start the publisher, recreate origin, or use the generic packet executor for this action.');
    lines.push('');
    lines.push('## Post-Run Decision');
    lines.push('');
    lines.push('A successful rolling image replacement proves only the relay-side exact-readback route surface. Keep the publisher parked and return the captured evidence for independent review. A separate Lou-approved recovery packet is required before any publisher reset/start or S1B live-green claim.');
  } else {
  lines.push('## Relay Deploy');
  lines.push('');
  lines.push('Run one relay at a time while the publisher is live. The packet verifies `/readyz`, snapshot-backed latest-index reload, per-relay early-capture thresholds, suppression config, graph-scan health when enabled, and zero watchdog trips before executing the next relay removal. Stop immediately on any failure; do not batch the relay recreates.');
  lines.push('');
  lines.push('```bash');
  lines.push('set -euo pipefail');
  lines.push(rollingRelayVerifierFunction());
  lines.push('');
  for (const name of relayNames) {
    const dataDestination = gunFileDestination(byName.get(name));
    const origin = relayLocalOrigin(name);
    const thresholds = relayEarlyHeapThresholdParts(name);
    lines.push(`# Recreate ${name}; wait for this relay to verify before touching the next relay.`);
    lines.push(`sudo docker rm -f ${name}`);
    lines.push(runCommandFor(name, newRelayImage, true));
    lines.push(`sudo docker inspect ${name} --format '{{.Config.Image}} {{.Image}}'`);
    lines.push(`verify_rolling_relay ${shellSingleQuote(name)} ${shellSingleQuote(origin)} ${shellSingleQuote(dataDestination)} ${shellSingleQuote(thresholds.first)} ${shellSingleQuote(thresholds.second)}`);
    lines.push('');
  }
  lines.push('```');
  lines.push('');
  lines.push('## Origin Deploy');
  lines.push('');
  lines.push('Deploy origin only after all relays prove the #638 image and safe persist probes pass.');
  lines.push('');
  lines.push('```bash');
  lines.push('set -euo pipefail');
  lines.push(`sudo docker rm -f ${originName}`);
  lines.push(runCommandFor(originName, newOriginImage, false));
  lines.push(`sudo docker inspect ${originName} --format '{{.Config.Image}} {{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}'`);
  lines.push(`origin_revision="$(sudo docker inspect ${originName} --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"`);
  lines.push(`if [[ "\${origin_revision}" != ${shellSingleQuote(expectedOriginRevision)} ]]; then`);
  lines.push(`  echo "${originName}: revision label \${origin_revision} did not match expected ${expectedOriginRevision}" >&2`);
  lines.push('  exit 78');
  lines.push('fi');
  lines.push('origin_healthz=/tmp/vhc-public-beta-deploy/origin.healthz.json');
  lines.push('origin_attempt=1');
  lines.push('while [[ "${origin_attempt}" -le 60 ]]; do');
  lines.push('  if curl -fsS http://127.0.0.1:8080/healthz > "${origin_healthz}"; then');
  lines.push('    break');
  lines.push('  fi');
  lines.push('  if [[ "${origin_attempt}" -eq 60 ]]; then');
  lines.push('    echo "origin /healthz did not pass after 60s" >&2');
  lines.push('    exit 78');
  lines.push('  fi');
  lines.push('  sleep 1');
  lines.push('  origin_attempt=$((origin_attempt + 1))');
  lines.push('done');
  lines.push(`python3 - "\${origin_healthz}" ${shellSingleQuote(expectedOriginRevision)} <<'PY'`);
  lines.push('import json, sys');
  lines.push('path, expected = sys.argv[1], sys.argv[2]');
  lines.push('with open(path, "r", encoding="utf-8") as handle: payload = json.load(handle)');
  lines.push('if payload.get("ok") is not True: raise SystemExit(f"origin healthz ok={payload.get(\'ok\')}")');
  lines.push('if payload.get("service") != "vh-public-beta-origin": raise SystemExit(f"origin service={payload.get(\'service\')}")');
  lines.push('if payload.get("static_dir_present") is not True: raise SystemExit("origin static dir missing")');
  lines.push('if payload.get("peer_config_present") is not True: raise SystemExit("origin peer config missing")');
  lines.push('if str(payload.get("build_revision") or "") != expected: raise SystemExit(f"origin build_revision={payload.get(\'build_revision\')} expected={expected}")');
  lines.push('print(json.dumps({"origin_healthz": "pass", "build_revision": payload.get("build_revision"), "relay_proxy_target_count": payload.get("relay_proxy_target_count")}, sort_keys=True))');
  lines.push('PY');
  lines.push('```');
  lines.push('');
  lines.push('## Rollback');
  lines.push('');
  lines.push('```bash');
  lines.push('set -euo pipefail');
  for (const name of relayNames) {
    const container = byName.get(name);
    lines.push(`sudo docker rm -f ${name}`);
    lines.push(runCommandFor(name, container.Config?.Image || '<captured-relay-image>', true));
  }
  const origin = byName.get(originName);
  lines.push(`sudo docker rm -f ${originName}`);
  lines.push(runCommandFor(originName, origin.Config?.Image || '<captured-origin-image>', false));
  lines.push('```');
  }
} else {
  lines.push('## Recreate Commands Omitted');
  lines.push('');
  lines.push(relayOnly
    ? 'This packet intentionally omits `docker rm`/`docker run` commands. The repo-only artifact remains `WAITING_FOR_LOU`; re-run with `--include-recreate-commands` only after the relay-restart boundary is explicitly corrected and the exact revision is approved.'
    : 'This packet intentionally omits `docker rm`/`docker run` commands. Re-run with `--include-recreate-commands` after operator approval to print the destructive deploy and rollback sections.');
}

console.log(lines.join('\n'));
NODE
}

if [[ -n "${OUTPUT_FILE}" ]]; then
  mkdir -p "$(dirname "${OUTPUT_FILE}")"
  emit_packet > "${OUTPUT_FILE}"
else
  emit_packet
fi
