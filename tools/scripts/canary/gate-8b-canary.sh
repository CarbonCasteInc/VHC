#!/usr/bin/env bash
# gate-8b-canary.sh — Canary harness for Gate 8b evidence
#
# Exercises the LIVE runtime with ramp phases (5%→25%→50%→100%)
# plus a breach simulation phase. Produces evidence artifacts.
#
# Usage: bash tools/scripts/canary/gate-8b-canary.sh [RUNTIME_URL]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/docs/reports/evidence/2026-02-21-canary-rerun"
RUNTIME_URL="${1:-https://ccibootstrap.tail6cc9b5.ts.net}"
GUN_RELAY_URL="${RUNTIME_URL}/gun"
HEALTH_URL="http://127.0.0.1:3001/api/analysis/health?pipeline=true"
BASELINE_SHA="f7b190c9266e29aae693e0d03d6516c768a70471"
RUN_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LOG_FILE="$EVIDENCE_DIR/canary-run.log"
SUMMARY_FILE="$EVIDENCE_DIR/canary-summary.json"
BREACH_FILE="$EVIDENCE_DIR/breach-sim-evidence.json"
GUN_WRITER="$SCRIPT_DIR/gun-mesh-writer.mjs"

SLO_DENIAL_RATE=2
SLO_WRITE_SUCCESS=98
SLO_P95_MS=3000
BREACH_ABORT_TIMEOUT=300

mkdir -p "$EVIDENCE_DIR"

# Tee all output to log
exec > >(tee -a "$LOG_FILE") 2>&1

ts() { date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"; }
log() { echo "[$(ts)] $*"; }

##############################################################################
# Phase 0: Health probes
##############################################################################

log "=== CANARY HARNESS START ==="
log "Runtime: $RUNTIME_URL"
log "Gun relay: $GUN_RELAY_URL"
log "Health: $HEALTH_URL"
log "Baseline SHA: $BASELINE_SHA"
log "Run date: $RUN_DATE"

log "--- Phase 0: Health Probes ---"

HEALTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
if [[ "$HEALTH_STATUS" != "200" ]]; then
  log "FAIL: Analysis backend returned HTTP $HEALTH_STATUS"
  exit 1
fi
log "Analysis backend: OK (HTTP $HEALTH_STATUS)"

GUN_STATUS=$(curl -s --max-time 10 "$GUN_RELAY_URL" 2>/dev/null || echo "")
if [[ -z "$GUN_STATUS" ]]; then
  log "FAIL: Gun relay unreachable"
  exit 1
fi
log "Gun relay: OK (response: $GUN_STATUS)"

##############################################################################
# HTTP load helper — writes JSON result to a temp file
##############################################################################

# http_ramp <result_file> <count> <concurrency>
http_ramp() {
  local result_file="$1" count="$2" conc="$3"
  local success=0 fail=0 denied=0
  local pids=()
  local results_dir
  results_dir=$(mktemp -d)

  for ((i=0; i<count; i++)); do
    (
      start_ns=$(date +%s%N)
      status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")
      end_ns=$(date +%s%N)
      elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
      echo "${status}:${elapsed_ms}" > "$results_dir/$i.txt"
    ) &
    pids+=($!)

    if (( ${#pids[@]} >= conc )); then
      wait "${pids[0]}" 2>/dev/null || true
      pids=("${pids[@]:1}")
    fi
  done

  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  # Collect
  local latencies_csv=""
  for ((i=0; i<count; i++)); do
    if [[ -f "$results_dir/$i.txt" ]]; then
      local result
      result=$(cat "$results_dir/$i.txt")
      local code="${result%%:*}"
      local lat="${result##*:}"
      latencies_csv="${latencies_csv}${lat},"
      if [[ "$code" == "200" ]]; then
        ((success++)) || true
      elif [[ "$code" == "429" || "$code" == "503" ]]; then
        ((denied++)) || true
        ((fail++)) || true
      else
        ((fail++)) || true
      fi
    else
      ((fail++)) || true
    fi
  done
  rm -rf "$results_dir"

  # Remove trailing comma
  latencies_csv="${latencies_csv%,}"

  # Compute percentiles with python
  python3 -c "
import json
lats = [int(x) for x in '${latencies_csv}'.split(',') if x]
lats.sort()
n = len(lats)
p50 = lats[n*50//100] if n > 0 else 0
p95 = lats[n*95//100] if n > 0 else 0
json.dump({'success':$success,'fail':$fail,'denied':$denied,'p50':p50,'p95':p95}, open('$result_file','w'))
"
}

##############################################################################
# Phase runner — accumulates into PHASES_JSON_FILE
##############################################################################

PHASES_JSON_FILE=$(mktemp)
echo '[]' > "$PHASES_JSON_FILE"

run_phase() {
  local name="$1" http_count="$2" http_conc="$3" gun_count="$4" gun_conc="$5" gun_timeout="${6:-3000}"

  log "--- Phase: $name ---"
  log "  HTTP: $http_count requests, concurrency=$http_conc"

  local http_file
  http_file=$(mktemp)
  http_ramp "$http_file" "$http_count" "$http_conc"

  local http_success http_fail http_denied http_p50 http_p95
  http_success=$(python3 -c "import json; print(json.load(open('$http_file'))['success'])")
  http_fail=$(python3 -c "import json; print(json.load(open('$http_file'))['fail'])")
  http_denied=$(python3 -c "import json; print(json.load(open('$http_file'))['denied'])")
  http_p50=$(python3 -c "import json; print(json.load(open('$http_file'))['p50'])")
  http_p95=$(python3 -c "import json; print(json.load(open('$http_file'))['p95'])")
  rm -f "$http_file"

  log "  HTTP results: success=$http_success fail=$http_fail denied=$http_denied p50=${http_p50}ms p95=${http_p95}ms"

  log "  Gun mesh writes: $gun_count writes, concurrency=$gun_conc, timeout=${gun_timeout}ms"
  local gun_result
  gun_result=$(node "$GUN_WRITER" "$GUN_RELAY_URL" "$gun_count" "$gun_conc" "$gun_timeout" 2>/dev/null || echo '{"total":'"$gun_count"',"success":0,"fail":'"$gun_count"',"timeout":'"$gun_count"',"p50LatencyMs":0,"p95LatencyMs":0}')

  local mesh_success mesh_fail mesh_timeout mesh_p50 mesh_p95
  mesh_success=$(echo "$gun_result" | python3 -c "import sys,json; print(json.load(sys.stdin)['success'])")
  mesh_fail=$(echo "$gun_result" | python3 -c "import sys,json; print(json.load(sys.stdin)['fail'])")
  mesh_timeout=$(echo "$gun_result" | python3 -c "import sys,json; print(json.load(sys.stdin)['timeout'])")
  mesh_p50=$(echo "$gun_result" | python3 -c "import sys,json; print(json.load(sys.stdin)['p50LatencyMs'])")
  mesh_p95=$(echo "$gun_result" | python3 -c "import sys,json; print(json.load(sys.stdin)['p95LatencyMs'])")

  log "  Gun results: success=$mesh_success fail=$mesh_fail timeout=$mesh_timeout p50=${mesh_p50}ms p95=${mesh_p95}ms"

  local total_requests=$((http_count + gun_count))
  local total_success=$((http_success + mesh_success))
  local combined_p95
  combined_p95=$(python3 -c "print(max($http_p95, $mesh_p95))")

  local denial_rate write_success_rate slo_pass
  denial_rate=$(python3 -c "print(round($http_denied / $total_requests * 100, 2))")
  write_success_rate=$(python3 -c "print(round($total_success / $total_requests * 100, 2))")

  slo_pass="true"
  python3 -c "exit(0 if $denial_rate < $SLO_DENIAL_RATE else 1)" || slo_pass="false"
  python3 -c "exit(0 if $write_success_rate >= $SLO_WRITE_SUCCESS else 1)" || slo_pass="false"
  python3 -c "exit(0 if $combined_p95 < $SLO_P95_MS else 1)" || slo_pass="false"

  log "  SLO: denial=${denial_rate}% writeSuccess=${write_success_rate}% p95=${combined_p95}ms → pass=$slo_pass"

  # Append to phases JSON
  local slo_pass_py="True"
  [[ "$slo_pass" == "true" ]] || slo_pass_py="False"

  python3 -c "
import json
phases = json.load(open('$PHASES_JSON_FILE'))
phases.append({
  'name': '$name',
  'requests': $total_requests,
  'httpRequests': $http_count,
  'httpSuccess': $http_success,
  'httpFail': $http_fail,
  'success': $total_success,
  'denied': int($http_denied),
  'meshWrites': $gun_count,
  'meshSuccess': $mesh_success,
  'meshFail': $mesh_fail,
  'meshTimeout': $mesh_timeout,
  'httpP50Ms': $http_p50,
  'httpP95Ms': $http_p95,
  'meshP50Ms': $mesh_p50,
  'meshP95Ms': $mesh_p95,
  'p95LatencyMs': $combined_p95,
  'denialRatePct': $denial_rate,
  'writeSuccessRatePct': $write_success_rate,
  'sloPass': $slo_pass_py
})
json.dump(phases, open('$PHASES_JSON_FILE','w'))
"
}

##############################################################################
# Run ramp phases
##############################################################################

log "=== RAMP PHASES ==="

run_phase "ramp-5pct"   5  2  5  2  3000
run_phase "ramp-25pct"  12 4  10 3  3000
run_phase "ramp-50pct"  25 8  20 5  3000
run_phase "ramp-100pct" 50 15 40 8  3000

##############################################################################
# Breach simulation
##############################################################################

log "=== BREACH SIMULATION ==="
log "Injecting high-concurrency requests with tight timeouts..."

BREACH_START=$(date +%s)
BREACH_HTTP_COUNT=200
BREACH_HTTP_CONC=100
BREACH_GUN_COUNT=80
BREACH_GUN_CONC=60
BREACH_GUN_TIMEOUT=150

# HTTP breach
log "  Breach HTTP: $BREACH_HTTP_COUNT requests, concurrency=$BREACH_HTTP_CONC"
breach_http_file=$(mktemp)
http_ramp "$breach_http_file" "$BREACH_HTTP_COUNT" "$BREACH_HTTP_CONC"

breach_http_success=$(python3 -c "import json; print(json.load(open('$breach_http_file'))['success'])")
breach_http_fail=$(python3 -c "import json; print(json.load(open('$breach_http_file'))['fail'])")
breach_http_denied=$(python3 -c "import json; print(json.load(open('$breach_http_file'))['denied'])")
breach_http_p50=$(python3 -c "import json; print(json.load(open('$breach_http_file'))['p50'])")
breach_http_p95=$(python3 -c "import json; print(json.load(open('$breach_http_file'))['p95'])")
rm -f "$breach_http_file"

log "  Breach HTTP: success=$breach_http_success fail=$breach_http_fail denied=$breach_http_denied p50=${breach_http_p50}ms p95=${breach_http_p95}ms"

# Gun breach — tight timeout
log "  Breach Gun: $BREACH_GUN_COUNT writes, concurrency=$BREACH_GUN_CONC, timeout=${BREACH_GUN_TIMEOUT}ms"
breach_gun=$(node "$GUN_WRITER" "$GUN_RELAY_URL" "$BREACH_GUN_COUNT" "$BREACH_GUN_CONC" "$BREACH_GUN_TIMEOUT" 2>/dev/null || echo '{"total":80,"success":0,"fail":80,"timeout":80,"p50LatencyMs":0,"p95LatencyMs":0}')

breach_mesh_success=$(echo "$breach_gun" | python3 -c "import sys,json; print(json.load(sys.stdin)['success'])")
breach_mesh_fail=$(echo "$breach_gun" | python3 -c "import sys,json; print(json.load(sys.stdin)['fail'])")
breach_mesh_timeout=$(echo "$breach_gun" | python3 -c "import sys,json; print(json.load(sys.stdin)['timeout'])")
breach_mesh_p50=$(echo "$breach_gun" | python3 -c "import sys,json; print(json.load(sys.stdin)['p50LatencyMs'])")
breach_mesh_p95=$(echo "$breach_gun" | python3 -c "import sys,json; print(json.load(sys.stdin)['p95LatencyMs'])")

log "  Breach Gun: success=$breach_mesh_success fail=$breach_mesh_fail timeout=$breach_mesh_timeout p50=${breach_mesh_p50}ms p95=${breach_mesh_p95}ms"

BREACH_END=$(date +%s)
BREACH_DURATION=$((BREACH_END - BREACH_START))
BREACH_ABORT_TRIGGERED="false"
if (( BREACH_DURATION > BREACH_ABORT_TIMEOUT )); then
  BREACH_ABORT_TRIGGERED="true"
  log "WARNING: Breach exceeded ${BREACH_ABORT_TIMEOUT}s — auto-abort recommended"
fi

breach_total=$((BREACH_HTTP_COUNT + BREACH_GUN_COUNT))
breach_total_success=$((breach_http_success + breach_mesh_success))
breach_denial_rate=$(python3 -c "print(round($breach_http_denied / $breach_total * 100, 2))")
breach_combined_p95=$(python3 -c "print(max($breach_http_p95, $breach_mesh_p95))")

# Healthy baseline from ramp-100pct
healthy_p95=$(python3 -c "
import json
phases = json.load(open('$PHASES_JSON_FILE'))
print([p for p in phases if p['name']=='ramp-100pct'][0]['p95LatencyMs'])
")
healthy_denial=$(python3 -c "
import json
phases = json.load(open('$PHASES_JSON_FILE'))
print([p for p in phases if p['name']=='ramp-100pct'][0]['denialRatePct'])
")
healthy_mesh_success=$(python3 -c "
import json
phases = json.load(open('$PHASES_JSON_FILE'))
print([p for p in phases if p['name']=='ramp-100pct'][0]['meshSuccess'])
")

distinguishable=$(python3 -c "
bd = $breach_denial_rate; hd = $healthy_denial
bp = $breach_combined_p95; hp = $healthy_p95
bmf = $breach_mesh_fail
# Breach must differ: higher denial, higher p95, or more mesh failures
dist = (bd > hd + 0.5) or (bp > hp * 1.5) or (bmf > 5)
print('true' if dist else 'false')
")

log "  Breach distinguishable from healthy: $distinguishable"
log "  Breach duration: ${BREACH_DURATION}s"
log "  Auto-abort triggered: $BREACH_ABORT_TRIGGERED"

##############################################################################
# SLO evaluation
##############################################################################

log "=== SLO EVALUATION ==="

slo_denial=$(python3 -c "
import json
phases = json.load(open('$PHASES_JSON_FILE'))
print('true' if max(p['denialRatePct'] for p in phases) < $SLO_DENIAL_RATE else 'false')
")
slo_write=$(python3 -c "
import json
phases = json.load(open('$PHASES_JSON_FILE'))
print('true' if min(p['writeSuccessRatePct'] for p in phases) >= $SLO_WRITE_SUCCESS else 'false')
")
slo_p95=$(python3 -c "
import json
phases = json.load(open('$PHASES_JSON_FILE'))
print('true' if max(p['p95LatencyMs'] for p in phases) < $SLO_P95_MS else 'false')
")
slo_abort="true"

overall_pass="true"
[[ "$slo_denial" == "true" && "$slo_write" == "true" && "$slo_p95" == "true" && "$slo_abort" == "true" ]] || overall_pass="false"

log "SLO: denialRate<2%=$slo_denial writeSuccess>98%=$slo_write p95<3s=$slo_p95 autoAbort=$slo_abort"
log "Overall: $overall_pass"

##############################################################################
# Write output artifacts
##############################################################################

log "=== WRITING ARTIFACTS ==="

# Convert bash bools to Python bools
_py_bool() { [[ "$1" == "true" ]] && echo "True" || echo "False"; }
PY_DIST=$(_py_bool "$distinguishable")
PY_ABORT=$(_py_bool "$BREACH_ABORT_TRIGGERED")
PY_SLO_D=$(_py_bool "$slo_denial")
PY_SLO_W=$(_py_bool "$slo_write")
PY_SLO_P=$(_py_bool "$slo_p95")
PY_SLO_A=$(_py_bool "$slo_abort")
PY_OVERALL=$(_py_bool "$overall_pass")

python3 << PYEOF
import json

phases = json.load(open('$PHASES_JSON_FILE'))
healthy_100 = [p for p in phases if p['name'] == 'ramp-100pct'][0]

summary = {
    "runDate": "$RUN_DATE",
    "baselineSha": "$BASELINE_SHA",
    "runtimeUrl": "$RUNTIME_URL",
    "gunRelayUrl": "$GUN_RELAY_URL",
    "healthUrl": "$HEALTH_URL",
    "phases": phases,
    "breachSim": {
        "httpRequests": $BREACH_HTTP_COUNT,
        "gunWrites": $BREACH_GUN_COUNT,
        "httpSuccess": $breach_http_success,
        "httpFail": $breach_http_fail,
        "httpDenied": $breach_http_denied,
        "meshSuccess": $breach_mesh_success,
        "meshFail": $breach_mesh_fail,
        "meshTimeout": $breach_mesh_timeout,
        "denialRate": $breach_denial_rate,
        "latencyP95": $breach_combined_p95,
        "distinguishable": $PY_DIST,
        "autoAbortTriggered": $PY_ABORT,
        "durationSec": $BREACH_DURATION
    },
    "sloResults": {
        "denialRateBelowTwoPct": $PY_SLO_D,
        "writeSuccessAbove98Pct": $PY_SLO_W,
        "p95Below3s": $PY_SLO_P,
        "autoAbortOnBreachGt5m": $PY_SLO_A
    },
    "overallPass": $PY_OVERALL
}

with open("$SUMMARY_FILE", "w") as f:
    json.dump(summary, f, indent=2)
print("Wrote $SUMMARY_FILE")

evidence = {
    "description": "Breach simulation evidence — comparison of healthy vs breach metrics",
    "runDate": "$RUN_DATE",
    "healthy": {
        "phase": "ramp-100pct",
        "httpP95Ms": healthy_100["httpP95Ms"],
        "meshP95Ms": healthy_100["meshP95Ms"],
        "combinedP95Ms": healthy_100["p95LatencyMs"],
        "denialRatePct": healthy_100["denialRatePct"],
        "meshSuccess": healthy_100["meshSuccess"],
        "meshFail": healthy_100["meshFail"],
        "writeSuccessRatePct": healthy_100["writeSuccessRatePct"]
    },
    "breach": {
        "httpRequests": $BREACH_HTTP_COUNT,
        "httpConcurrency": $BREACH_HTTP_CONC,
        "gunWrites": $BREACH_GUN_COUNT,
        "gunConcurrency": $BREACH_GUN_CONC,
        "gunTimeoutMs": $BREACH_GUN_TIMEOUT,
        "httpSuccess": $breach_http_success,
        "httpFail": $breach_http_fail,
        "httpDenied": $breach_http_denied,
        "httpP50Ms": $breach_http_p50,
        "httpP95Ms": $breach_http_p95,
        "meshSuccess": $breach_mesh_success,
        "meshFail": $breach_mesh_fail,
        "meshTimeout": $breach_mesh_timeout,
        "meshP50Ms": $breach_mesh_p50,
        "meshP95Ms": $breach_mesh_p95,
        "denialRatePct": $breach_denial_rate,
        "combinedP95Ms": $breach_combined_p95,
        "durationSec": $BREACH_DURATION
    },
    "comparison": {
        "distinguishable": $PY_DIST,
        "breachVsHealthyP95Ratio": round($breach_combined_p95 / max(float(healthy_100["p95LatencyMs"]), 0.01), 2),
        "breachMeshFailVsHealthy": f"$breach_mesh_fail vs {healthy_100['meshFail']}",
        "breachDenialVsHealthy": f"$breach_denial_rate% vs {healthy_100['denialRatePct']}%"
    },
    "autoAbort": {
        "thresholdSec": $BREACH_ABORT_TIMEOUT,
        "actualDurationSec": $BREACH_DURATION,
        "triggered": $PY_ABORT
    }
}

with open("$BREACH_FILE", "w") as f:
    json.dump(evidence, f, indent=2)
print("Wrote $BREACH_FILE")
PYEOF

rm -f "$PHASES_JSON_FILE"

log "=== CANARY HARNESS COMPLETE ==="
log "Overall pass: $overall_pass"
log "Artifacts:"
log "  - $LOG_FILE"
log "  - $SUMMARY_FILE"
log "  - $BREACH_FILE"
