#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSPECT_JSON=""
NEW_ORIGIN_IMAGE=""
NEW_RELAY_IMAGE=""
ANALYSIS_TARGET="http://127.0.0.1:3001"
ORIGIN_NAME="vhc-public-origin"
RELAY_NAMES="vhc-relay-a,vhc-relay-b,vhc-relay-c"
OUTPUT_FILE=""
INCLUDE_RECREATE=false

usage() {
  cat <<'EOF'
Usage: tools/scripts/emit-a6-public-beta-deploy-packet.sh [options]

Emit a secret-safe A6 public-beta deploy packet from captured docker inspect JSON.
The script prints commands only; it never changes production state.

Required:
  --inspect-json <path>       docker inspect JSON for origin and relay containers
  --new-origin-image <image>  Rebuilt origin image tag/digest to deploy
  --new-relay-image <image>   Rebuilt relay image tag/digest to deploy

Options:
  --analysis-target <url>     Corrected origin analysis target (default http://127.0.0.1:3001)
  --origin-name <name>        Origin container name (default vhc-public-origin)
  --relay-names <a,b,c>       Relay container names (default vhc-relay-a,vhc-relay-b,vhc-relay-c)
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
if [[ -z "${NEW_ORIGIN_IMAGE}" || -z "${NEW_RELAY_IMAGE}" ]]; then
  echo "--new-origin-image and --new-relay-image are required" >&2
  exit 64
fi

emit_packet() {
  INSPECT_JSON="${INSPECT_JSON}" \
  NEW_ORIGIN_IMAGE="${NEW_ORIGIN_IMAGE}" \
  NEW_RELAY_IMAGE="${NEW_RELAY_IMAGE}" \
  ANALYSIS_TARGET="${ANALYSIS_TARGET}" \
  ORIGIN_NAME="${ORIGIN_NAME}" \
  RELAY_NAMES="${RELAY_NAMES}" \
  INCLUDE_RECREATE="${INCLUDE_RECREATE}" \
  node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';

const inspectJson = process.env.INSPECT_JSON;
const newOriginImage = process.env.NEW_ORIGIN_IMAGE;
const newRelayImage = process.env.NEW_RELAY_IMAGE;
const analysisTarget = process.env.ANALYSIS_TARGET;
const originName = process.env.ORIGIN_NAME;
const relayNames = (process.env.RELAY_NAMES || '').split(',').map((name) => name.trim()).filter(Boolean);
const includeRecreate = process.env.INCLUDE_RECREATE === 'true';
const relayMemoryLimit = process.env.VH_RELAY_DOCKER_MEMORY_LIMIT || '2304m';
const containers = JSON.parse(readFileSync(inspectJson, 'utf8'));

function cleanName(container) {
  return String(container?.Name || '').replace(/^\//, '');
}

const byName = new Map(containers.map((container) => [cleanName(container), container]));
const requiredNames = [originName, ...relayNames];
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

function envCaptureCommand(name, rewriteAnalysisTarget = false, relay = false) {
  const envPath = `/tmp/vhc-public-beta-deploy/${name}.env`;
  const relayDefaults = relay ? [
    envEnsureLine(envPath, 'VH_RELAY_RESOURCE_WATCHDOG_ENABLED', 'true'),
    envEnsureLine(envPath, 'VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS', '2000'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES', '1100000000'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES', '150000000'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES', '250000000'),
    envEnsureLine(envPath, 'VH_RELAY_DIAGNOSTIC_DIR', '/data/diagnostics'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED', 'true'),
    envEnsureLine(envPath, 'VH_RELAY_WATCHDOG_EXIT_GRACE_MS', '30000'),
    envEnsureLine(envPath, 'VH_RELAY_STARTUP_JITTER_MAX_MS', '5000'),
    envEnsureLine(envPath, 'VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY', '2'),
    envEnsureLine(envPath, 'VH_RELAY_CRITICAL_WRITE_READBACK_QUEUE_LIMIT', '16'),
    envEnsureLine(envPath, 'VH_RELAY_CRITICAL_WRITE_READBACK_QUEUE_TIMEOUT_MS', '1000'),
    envEnsureLine(envPath, 'VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES', 'false'),
    envEnsureLine(envPath, 'VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES', 'false'),
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
    `awk 'BEGIN{done=0} /^VH_PUBLIC_ORIGIN_STATIC_DIR=/{next} /^VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH=/{next} /^VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=/{print "VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=${analysisTarget}"; done=1; next} {print} END{if(!done) print "VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=${analysisTarget}"}' ${envPath}.current > ${envPath}`,
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
}

const lines = [];
const psPattern = [originName, ...relayNames].map(escapeExtendedRegex).join('|');
lines.push('# A6 Public-Beta Deploy Packet');
lines.push('');
lines.push('Generated from captured `docker inspect` JSON. This packet is secret-safe: it records env var names and uses host-side env-file capture commands without printing values.');
lines.push('');
lines.push('## Images');
lines.push('');
lines.push(`- new origin image: \`${newOriginImage}\``);
lines.push(`- new relay image: \`${newRelayImage}\``);
lines.push(`- corrected analysis target: \`${analysisTarget}\``);
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
lines.push('install -d -m 700 /tmp/vhc-public-beta-deploy');
for (const name of relayNames) {
  lines.push(envCaptureCommand(name, false, true));
}
lines.push(envCaptureCommand(originName, true));
lines.push('```');
lines.push('');

if (includeRecreate) {
  lines.push('## Relay Deploy');
  lines.push('');
  lines.push('Run one relay at a time. Prove each relay before moving to the next. Do not run public latest-index HTTP probes until the #638 image is proven running.');
  lines.push('');
  lines.push('```bash');
  for (const name of relayNames) {
    const dataDestination = gunFileDestination(byName.get(name));
    lines.push(`sudo docker rm -f ${name}`);
    lines.push(runCommandFor(name, newRelayImage, true));
    lines.push(`sudo docker inspect ${name} --format '{{.Config.Image}} {{.Image}}'`);
    lines.push(`sudo docker exec ${name} test -f ${dataDestination}/news-latest-index-snapshot.json`);
  }
  lines.push('```');
  lines.push('');
  lines.push('## Origin Deploy');
  lines.push('');
  lines.push('Deploy origin only after all relays prove the #638 image and safe persist probes pass.');
  lines.push('');
  lines.push('```bash');
  lines.push(`sudo docker rm -f ${originName}`);
  lines.push(runCommandFor(originName, newOriginImage, false));
  lines.push(`sudo docker inspect ${originName} --format '{{.Config.Image}} {{.Image}}'`);
  lines.push(`curl -fsS http://127.0.0.1:8080/healthz`);
  lines.push('```');
  lines.push('');
  lines.push('## Rollback');
  lines.push('');
  lines.push('```bash');
  for (const name of relayNames) {
    const container = byName.get(name);
    lines.push(`sudo docker rm -f ${name}`);
    lines.push(runCommandFor(name, container.Config?.Image || '<captured-relay-image>', true));
  }
  const origin = byName.get(originName);
  lines.push(`sudo docker rm -f ${originName}`);
  lines.push(runCommandFor(originName, origin.Config?.Image || '<captured-origin-image>', false));
  lines.push('```');
} else {
  lines.push('## Recreate Commands Omitted');
  lines.push('');
  lines.push('This packet intentionally omits `docker rm`/`docker run` commands. Re-run with `--include-recreate-commands` after operator approval to print the destructive deploy and rollback sections.');
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
