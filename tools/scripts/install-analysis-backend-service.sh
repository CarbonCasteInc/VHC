#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_PATH="${UNIT_DIR}/vh-analysis-backend-3001.service"
SERVICE_PATH="%h/.local/bin:%h/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "${UNIT_DIR}"

cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=VHC Analysis Backend (:3001 analyze health/config + article-text)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=VHC_REPO=${REPO_ROOT}
Environment=PATH=${SERVICE_PATH}
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=ARTICLE_TEXT_MAX_CHARS=24000
Environment=ARTICLE_FETCH_TIMEOUT_MS=12000
ExecStart=/usr/bin/env node ${REPO_ROOT}/tools/scripts/vh-analysis-backend-3001.js
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now vh-analysis-backend-3001.service

echo "Installed + started vh-analysis-backend-3001.service"
echo "Unit path: ${UNIT_PATH}"
echo "Repo root: ${REPO_ROOT}"
echo "Health: http://127.0.0.1:3001/api/analyze/health"
echo "Config: http://127.0.0.1:3001/api/analyze/config"
