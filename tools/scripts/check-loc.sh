#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAX_LINES=350
BASELINE_FILE="$ROOT/tools/scripts/loc-baseline.txt"

# LOC gate applies to non-test source files only.
# Exemptions: tests/specs/stories and declaration files.
violations=()
while IFS= read -r file; do
  rel="${file#$ROOT/}"
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$MAX_LINES" ]; then
    violations+=("$rel:$lines")
  fi
done < <(find "$ROOT" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' \
  ! -path '*/dist/*' \
  ! -path '*/typechain-types/*' \
  ! -name '*.test.ts' \
  ! -name '*.test.tsx' \
  ! -name '*.spec.ts' \
  ! -name '*.spec.tsx' \
  ! -name '*.stories.ts' \
  ! -name '*.stories.tsx' \
  ! -name '*.d.ts')

baseline_lines=()
if [ -f "$BASELINE_FILE" ]; then
  while IFS= read -r raw; do
    line="${raw%%#*}"
    line="$(echo "$line" | xargs)"
    if [ -n "$line" ]; then
      baseline_lines+=("$line")
    fi
  done < "$BASELINE_FILE"
fi

unexpected=()
for v in "${violations[@]}"; do
  rel="${v%%:*}"
  in_baseline=0
  for base in "${baseline_lines[@]}"; do
    if [ "$base" = "$rel" ]; then
      in_baseline=1
      break
    fi
  done
  if [ "$in_baseline" -eq 0 ]; then
    unexpected+=("$v")
  fi
done

stale=()
for rel in "${baseline_lines[@]}"; do
  seen=0
  for v in "${violations[@]}"; do
    if [ "${v%%:*}" = "$rel" ]; then
      seen=1
      break
    fi
  done
  if [ "$seen" -eq 0 ]; then
    stale+=("$rel")
  fi
done

if [ "${#unexpected[@]}" -gt 0 ]; then
  echo "Files exceeding ${MAX_LINES} lines (not in baseline):"
  for v in "${unexpected[@]}"; do
    echo "  $v"
  done
  exit 1
fi

if [ "${#stale[@]}" -gt 0 ]; then
  echo "LOC baseline entries are stale (remove from tools/scripts/loc-baseline.txt):"
  for rel in "${stale[@]}"; do
    echo "  $rel"
  done
  exit 1
fi

if [ "${#violations[@]}" -gt 0 ]; then
  echo "LOC check passed with baseline debt (${#violations[@]} file(s) still > ${MAX_LINES})."
else
  echo "LOC check passed (<= ${MAX_LINES} lines)."
fi
