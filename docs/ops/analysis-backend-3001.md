# Managed Analysis Backend on :3001

> Status: Operational Runbook
> Owner: VHC Ops
> Last Reviewed: 2026-06-14
> Depends On: docs/README.md, docs/CANON_MAP.md


## Purpose

When `VITE_VH_ANALYSIS_PIPELINE=true`, Vite proxies `/api/*` and `/article-text` to `VITE_NEWS_EXTRACTION_SERVICE_URL` (default `http://127.0.0.1:3001`).

This managed service provides:

- article-text extraction endpoint used by NewsCard analysis flow
- stable health contract for pipeline-mode and production canary checks
- product health-monitor configuration metadata without secrets
- explicit fail-closed POST `/api/analyze` behavior while full on-demand
  analysis remains out of beta scope

## Runtime contract

Service entrypoint:

- `tools/scripts/vh-analysis-backend-3001.js`

Systemd user unit template:

- `infra/systemd/user/vh-analysis-backend-3001.service`

Installer script (recommended):

- `tools/scripts/install-analysis-backend-service.sh`

A6 runtime note, observed 2026-06-14: `node` is available for `humble` at
`/home/humble/.local/bin/node`; the user service template includes that path.

## Install / start (user service)

```bash
cd /home/humble/VHC
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

- `http://127.0.0.1:3001/api/analyze/health`
- `http://127.0.0.1:3001/health`
- `http://127.0.0.1:3001/api/health`
- `http://127.0.0.1:3001/healthz`
- `http://127.0.0.1:3001/status`
- `http://127.0.0.1:3001/api/analysis/health?pipeline=true`
- `http://127.0.0.1:3001/?pipeline=true`

The production canary `api_analyze` gate only requires
`GET /api/analyze/health` to return JSON with `ok: true`.

## Config endpoint

`GET /api/analyze/config` returns HTTP 200 JSON with `configured: true` and
`contract: analysis-backend-config-v1`. This is a product health-monitor UX
surface for `useHealthMonitor.ts`; it is not the canary-blocking gate.

The config payload must not include secrets. It may include host-local routing,
limits, and fail-closed analysis posture.

## POST /api/analyze

`POST /api/analyze` is the on-demand UI analysis path. Until full analysis is
explicitly in production beta scope, the `:3001` backend fails closed with JSON:

- HTTP status: `501`
- `ok: false`
- `error_class: "full_analysis_out_of_beta_scope"`
- `release_ready: false`

This must not be converted into a fake success. It is intentionally not a 502 so
operators can distinguish "not enabled here" from an upstream/proxy failure.

Vite-proxied checks (when web-pwa dev server is up):

- `http://127.0.0.1:2048/api/analyze/health`
- `http://127.0.0.1:2048/api/analyze/config`
- `http://127.0.0.1:2048/article-text?url=https%3A%2F%2Fexample.com`

## Host repoint packet

Do not repoint production origin until the local `:3001` contract is green and
the operator approves the env change.

The installer writes a user unit with
`PATH=%h/.local/bin:%h/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin`. This
matches the A6 `humble` runtime layout where Node may be exposed through
`~/.local/bin` and package-manager shims may live under `~/.hermes/node/bin`.

Approved host packet:

```bash
cd /home/humble/VHC
git fetch origin main
git checkout main
git pull --ff-only
./tools/scripts/install-analysis-backend-service.sh
curl -sS -i http://127.0.0.1:3001/api/analyze/health
curl -sS -i http://127.0.0.1:3001/api/analyze/config
curl -sS -i -X POST http://127.0.0.1:3001/api/analyze -H 'content-type: application/json' --data '{"prompt":"probe"}'
```

Then update the origin env var by name:

```bash
VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=http://127.0.0.1:3001
```

Restart the origin using the existing host pattern, then verify both local-origin
and public routes:

```bash
curl -sS -i http://127.0.0.1:<origin-port>/api/analyze/health
curl -sS -i http://127.0.0.1:<origin-port>/api/analyze/config
curl -sS -i https://venn.carboncaste.io/api/analyze/health
curl -sS -i https://venn.carboncaste.io/api/analyze/config
```

## Notes

- This service is intentionally local-only (`127.0.0.1`).
- If your checkout path differs from `/home/humble/VHC`, rerun installer from your checkout so unit points at the correct repo path.
