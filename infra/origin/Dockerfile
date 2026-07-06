# syntax=docker/dockerfile:1.6
FROM node:20.16.0-alpine3.19 AS build

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.7.1 --activate

COPY . .

ARG VITE_GUN_PEERS
ARG VITE_GUN_PEER_CONFIG_URL
ARG VITE_GUN_PEER_CONFIG_PUBLIC_KEY
ARG VITE_GUN_PEER_MINIMUM
ARG VITE_GUN_PEER_QUORUM_REQUIRED
ARG VITE_VH_STRICT_PEER_CONFIG
ARG VITE_VH_ALLOW_LOCAL_MESH_PEERS
ARG VITE_VH_CSP_CONNECT_SRC
ARG VITE_VH_CSP_STRICT_CONNECT_SRC
ARG VITE_NEWS_EXTRACTION_SERVICE_URL
ARG VITE_NEWS_SYSTEM_WRITER_PIN_JSON
ARG VITE_VH_ANALYSIS_PIPELINE
ARG VITE_NEWS_RUNTIME_ENABLED
ARG VITE_NEWS_RUNTIME_ROLE
ARG VITE_NEWS_BRIDGE_ENABLED
ARG VITE_SYNTHESIS_BRIDGE_ENABLED
ARG VITE_VH_GUN_LOCAL_STORAGE
ARG VITE_LUMA_PROFILE
ARG VITE_LUMA_DEV_FALLBACK
ARG VITE_ATTESTATION_URL
ARG VITE_CONSTITUENCY_PROOF_REAL
ARG VITE_E2E_MODE
ARG VH_PUBLIC_ORIGIN_MESH_PEER_CONFIG_BASE64

RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
RUN pnpm --filter @vh/web-pwa build
RUN test -n "${VH_PUBLIC_ORIGIN_MESH_PEER_CONFIG_BASE64}" \
  && printf '%s' "${VH_PUBLIC_ORIGIN_MESH_PEER_CONFIG_BASE64}" \
    | base64 -d > /repo/apps/web-pwa/dist/mesh-peer-config.json \
  && test -s /repo/apps/web-pwa/dist/index.html \
  && test -s /repo/apps/web-pwa/dist/mesh-peer-config.json

FROM node:20.16.0-alpine3.19

ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="VHC public beta origin" \
  org.opencontainers.image.source="https://github.com/CarbonCasteInc/VHC" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.created="${BUILD_DATE}"

WORKDIR /app

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=8080 \
  VH_PUBLIC_ORIGIN_BUILD_REVISION="${VCS_REF}" \
  VH_PUBLIC_ORIGIN_BUILD_CREATED="${BUILD_DATE}" \
  VH_PUBLIC_ORIGIN_STATIC_DIR=/app/apps/web-pwa/dist \
  VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH=/app/apps/web-pwa/dist/mesh-peer-config.json \
  VH_PUBLIC_ORIGIN_FAIL_IF_MISSING_STATIC=true

COPY --from=build /repo/apps/web-pwa/dist /app/apps/web-pwa/dist
COPY tools/scripts/public-beta-origin-server.mjs /app/tools/scripts/public-beta-origin-server.mjs

EXPOSE 8080

CMD ["node", "/app/tools/scripts/public-beta-origin-server.mjs"]
