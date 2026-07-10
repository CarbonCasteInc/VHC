#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${VHC_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
EXPECTED_REVISION="${1:-${VH_NEWS_DAEMON_EXPECTED_REVISION:-}}"
COMMON_SH="${REPO_ROOT}/tools/scripts/lib/news-aggregator-publisher-recovery-common.sh"

if [[ ! -r "${COMMON_SH}" ]]; then
  echo "[vh:publisher-recovery] exact-checkout guard is unavailable" >&2
  exit 78
fi
# shellcheck disable=SC1090
source "${COMMON_SH}"
vh_publisher_require_exact_checkout "${REPO_ROOT}" "${EXPECTED_REVISION}"
