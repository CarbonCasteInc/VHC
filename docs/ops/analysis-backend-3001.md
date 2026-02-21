# Managed Analysis Backend on :3001

## Purpose

When `VITE_VH_ANALYSIS_PIPELINE=true`, Vite proxies `/api/*` and `/article-text` to `VITE_NEWS_EXTRACTION_SERVICE_URL` (default `http://127.0.0.1:3001`).

This managed service provides:

- article-text extraction endpoint used by NewsCard analysis flow
- stable health contract for pipeline-mode checks

## Runtime contract

Service entrypoint:

- `tools/scripts/vh-analysis-backend-3001.js`

Systemd user unit template:

- `infra/systemd/user/vh-analysis-backend-3001.service`

Installer script (recommended):

- `tools/scripts/install-analysis-backend-service.sh`

## Install / start (user service)

```bash
cd /srv/trinity/worktrees/live-main
./tools/scripts/install-analysis-backend-service.sh
```

Manual service control:

```bash
systemctl --user restart vh-analysis-backend-3001.service
systemctl --user status vh-analysis-backend-3001.service --no-pager
journalctl --user -u vh-analysis-backend-3001.service -n 200 --no-pager
```

## Health endpoints (contract)

All should return HTTP 200 with JSON payload including `ok: true` and `contract: analysis-backend-health-v1`.

- `http://127.0.0.1:3001/health`
- `http://127.0.0.1:3001/api/health`
- `http://127.0.0.1:3001/healthz`
- `http://127.0.0.1:3001/status`
- `http://127.0.0.1:3001/api/analysis/health?pipeline=true`
- `http://127.0.0.1:3001/?pipeline=true`

Vite-proxied checks (when web-pwa dev server is up):

- `http://127.0.0.1:2048/api/analysis/health?pipeline=true`
- `http://127.0.0.1:2048/article-text?url=https%3A%2F%2Fexample.com`

## Notes

- This service is intentionally local-only (`127.0.0.1`).
- If your checkout path differs from `/srv/trinity/worktrees/live-main`, rerun installer from your checkout so unit points at the correct repo path.
