#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAX_LINES=350

violations=()
while IFS= read -r file; do
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$MAX_LINES" ]; then
    violations+=("$file:$lines")
  fi
done < <(find "$ROOT" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' \
  ! -path '*/dist/*' \
  ! -path '*/typechain-types/*')

if [ "${#violations[@]}" -gt 0 ]; then
  echo "Files exceeding ${MAX_LINES} lines:"
  for v in "${violations[@]}"; do
    echo "  $v"
  done
  exit 1
fi

echo "LOC check passed (<= ${MAX_LINES} lines)."
