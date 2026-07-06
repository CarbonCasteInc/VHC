#!/usr/bin/env bash
set -euo pipefail

TIMESTAMP=""
WINDOW_MINUTES="15"
OUTPUT_DIR=""

usage() {
  cat <<'EOF'
Usage: tools/scripts/collect-host-event-window.sh --timestamp <iso> [options]

Collect a host-private incident window bundle and a secret-safe summary.

Required:
  --timestamp <iso>       Center of the event window, for example 2026-07-03T13:04:00Z

Options:
  --window-minutes <n>    Total window width in minutes (default 15)
  --output-dir <path>     Output directory (default /tmp/vhc-host-event-window-<timestamp>)
  -h, --help              Show this help

The raw bundle may contain host-private logs. Share summary.json only unless a
separate secret-review approval authorizes raw log disclosure.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timestamp)
      TIMESTAMP="${2:-}"
      shift 2
      ;;
    --window-minutes)
      WINDOW_MINUTES="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
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

if [[ -z "${TIMESTAMP}" ]]; then
  echo "--timestamp is required" >&2
  exit 64
fi
if ! [[ "${WINDOW_MINUTES}" =~ ^[0-9]+$ ]] || [[ "${WINDOW_MINUTES}" -le 0 ]]; then
  echo "--window-minutes must be a positive integer" >&2
  exit 64
fi

WINDOW_JSON="$(
  TIMESTAMP="${TIMESTAMP}" WINDOW_MINUTES="${WINDOW_MINUTES}" node --input-type=module <<'NODE'
const timestamp = process.env.TIMESTAMP;
const minutes = Number.parseInt(process.env.WINDOW_MINUTES || '', 10);
const centerMs = Date.parse(timestamp);
if (!Number.isFinite(centerMs)) {
  console.error(`invalid --timestamp: ${timestamp}`);
  process.exit(65);
}
if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error(`invalid --window-minutes: ${process.env.WINDOW_MINUTES}`);
  process.exit(65);
}
const halfMs = Math.floor(minutes * 60_000 / 2);
const safeId = new Date(centerMs).toISOString().replace(/[:.]/g, '-');
console.log(JSON.stringify({
  center: new Date(centerMs).toISOString(),
  start: new Date(centerMs - halfMs).toISOString(),
  end: new Date(centerMs + halfMs).toISOString(),
  safeId,
}));
NODE
)"

WINDOW_CENTER="$(printf '%s' "${WINDOW_JSON}" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).center));')"
WINDOW_START="$(printf '%s' "${WINDOW_JSON}" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).start));')"
WINDOW_END="$(printf '%s' "${WINDOW_JSON}" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).end));')"
WINDOW_ID="$(printf '%s' "${WINDOW_JSON}" | node -e 'let data="";process.stdin.on("data",(c)=>data+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).safeId));')"

if [[ -z "${OUTPUT_DIR}" ]]; then
  OUTPUT_DIR="/tmp/vhc-host-event-window-${WINDOW_ID}"
fi

RAW_DIR="${OUTPUT_DIR}/raw"
SUMMARY_PATH="${OUTPUT_DIR}/summary.json"
mkdir -p "${RAW_DIR}"
chmod 700 "${OUTPUT_DIR}" "${RAW_DIR}"

run_optional() {
  local label="$1"
  shift
  local stdout_path="${RAW_DIR}/${label}.log"
  local stderr_path="${RAW_DIR}/${label}.stderr"
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'command unavailable: %s\n' "$1" >"${stderr_path}"
    : >"${stdout_path}"
    return 0
  fi
  "$@" >"${stdout_path}" 2>"${stderr_path}" || true
}

run_optional journal-system journalctl --system --since "${WINDOW_START}" --until "${WINDOW_END}" -o json
run_optional journal-user journalctl --user --since "${WINDOW_START}" --until "${WINDOW_END}" -o json
run_optional dmesg dmesg --time-format iso
run_optional docker-events docker events --since "${WINDOW_START}" --until "${WINDOW_END}" --format '{{json .}}'

RAW_DIR="${RAW_DIR}" SUMMARY_PATH="${SUMMARY_PATH}" WINDOW_CENTER="${WINDOW_CENTER}" WINDOW_START="${WINDOW_START}" WINDOW_END="${WINDOW_END}" WINDOW_MINUTES="${WINDOW_MINUTES}" node --input-type=module <<'NODE'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rawDir = process.env.RAW_DIR;
const summaryPath = process.env.SUMMARY_PATH;

function readLines(file) {
  const filePath = path.join(rawDir, file);
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
}

function increment(map, key) {
  const safeKey = String(key || 'unknown');
  map[safeKey] = (map[safeKey] || 0) + 1;
}

function sortedObject(map) {
  return Object.fromEntries(Object.entries(map).sort(([left], [right]) => left.localeCompare(right)));
}

function parseJsonLines(lines) {
  const rows = [];
  let parseErrorCount = 0;
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      parseErrorCount += 1;
    }
  }
  return { rows, parseErrorCount };
}

function journalSummary(file) {
  const { rows, parseErrorCount } = parseJsonLines(readLines(file));
  const units = new Set();
  const identifiers = new Set();
  const priorities = {};
  const exitCodes = {};
  for (const row of rows) {
    const unit = row._SYSTEMD_UNIT || row.UNIT || row.SYSTEMD_UNIT;
    if (unit) units.add(String(unit));
    const identifier = row.SYSLOG_IDENTIFIER || row._COMM;
    if (identifier) identifiers.add(String(identifier));
    increment(priorities, row.PRIORITY ?? 'unknown');
    const message = String(row.MESSAGE || '');
    const statusMatches = message.matchAll(/\bstatus=(\d+)(?:\/[A-Z_]+)?\b/g);
    for (const match of statusMatches) increment(exitCodes, match[1]);
    const exitMatches = message.matchAll(/\b(?:exit(?:ed)?|code)[ _-]?status[=: ]+(\d+)\b/gi);
    for (const match of exitMatches) increment(exitCodes, match[1]);
  }
  return {
    line_count: rows.length,
    parse_error_count: parseErrorCount,
    units: [...units].sort(),
    identifiers: [...identifiers].sort(),
    priorities: sortedObject(priorities),
    exit_codes: sortedObject(exitCodes),
  };
}

function dockerSummary() {
  const { rows, parseErrorCount } = parseJsonLines(readLines('docker-events.log'));
  const actions = {};
  const statuses = {};
  const containers = new Set();
  const exitCodes = {};
  for (const row of rows) {
    increment(actions, row.Action || row.action || 'unknown');
    increment(statuses, row.status || row.Status || 'unknown');
    const attrs = row.Actor?.Attributes || row.actor?.attributes || {};
    if (attrs.name) containers.add(String(attrs.name));
    if (attrs.exitCode) increment(exitCodes, attrs.exitCode);
  }
  return {
    line_count: rows.length,
    parse_error_count: parseErrorCount,
    actions: sortedObject(actions),
    statuses: sortedObject(statuses),
    containers: [...containers].sort(),
    exit_codes: sortedObject(exitCodes),
  };
}

function dmesgSummary() {
  const lines = readLines('dmesg.log');
  const lower = lines.map((line) => line.toLowerCase());
  const count = (pattern) => lower.filter((line) => pattern.test(line)).length;
  return {
    line_count: lines.length,
    oom_mentions: count(/\boom\b|out of memory|killed process/),
    network_mentions: count(/\bnetwork\b|link is down|link down|dns|resolver/),
    docker_mentions: count(/\bdocker\b|containerd|runc/),
    systemd_mentions: count(/\bsystemd\b/),
  };
}

const summary = {
  schema_version: 'vh-host-event-window-summary-v1',
  generated_at: new Date().toISOString(),
  window: {
    center: process.env.WINDOW_CENTER,
    start: process.env.WINDOW_START,
    end: process.env.WINDOW_END,
    width_minutes: Number.parseInt(process.env.WINDOW_MINUTES || '0', 10),
  },
  raw_bundle_warning: 'raw/ may contain host-private log text; share summary.json only unless separately approved',
  journal_system: journalSummary('journal-system.log'),
  journal_user: journalSummary('journal-user.log'),
  dmesg: dmesgSummary(),
  docker_events: dockerSummary(),
};

writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
NODE

printf 'host_event_window_bundle=%s\n' "${OUTPUT_DIR}"
printf 'secret_safe_summary=%s\n' "${SUMMARY_PATH}"
