# Phase 5 Public Beta Publisher A6 Preflight Abort - 2026-06-14

Generated: 2026-06-15T01:02:31Z
Host: `humble@ccibootstrap`
Branch: `coord/a6-phase5-publisher-preflight-abort-20260614`

## Verdict

Phase 5 publisher writes were not started. The run failed closed before adding
`VH_NEWS_DAEMON_START_APPROVED=1` and before installing or starting
`vh-news-aggregator.service`.

Abort reasons:

- Required publisher env file `/home/humble/.config/vhc/news-aggregator.env`
  was missing, and no `VH_NEWS_DAEMON_ENV_FILE` override was found.
- `pnpm check:news-sources:health` returned release evidence `fail`.
- Relay snapshot watch baseline remained stale. This was allowed as a baseline
  observation before start, but it would not support a green Phase 5 verdict.

No relays or origin were restarted. No images were rebuilt or reloaded. No
catch-up, republish, or scrub scripts were run. The public freshness monitor
remained disabled.

## Repo And PR State

- Local `/Users/bldt/Desktop/VHC/VHC` was fetched and fast-forward checked.
- Local `HEAD` and `origin/main`: `fe39619a39430d9ce6e75719024f54d2561c50ea`.
- PR #648 was verified merged with merge commit
  `fe39619a39430d9ce6e75719024f54d2561c50ea`.
- PR #648 check rollup: 9 checks, all `SUCCESS`.
- Host `/home/humble/VHC` was fast-forwarded from `1b735eb4` to
  `fe39619a39430d9ce6e75719024f54d2561c50ea`.
- Host worktree after pull: `main...origin/main` with untracked `.pnpm-store/`.

## Production Surface

Container image proof after abort:

```text
/vhc-public-origin image=vhc-public-beta-origin:20260614-main-v1b735eb4-amd64 status=running
/vhc-relay-a image=vhc-public-beta-relay:20260614-main-v1b735eb4-amd64 status=running
/vhc-relay-b image=vhc-public-beta-relay:20260614-main-v1b735eb4-amd64 status=running
/vhc-relay-c image=vhc-public-beta-relay:20260614-main-v1b735eb4-amd64 status=running
```

Analysis backend:

- `vh-analysis-backend-3001.service`: `active`, `enabled`.
- Local `http://127.0.0.1:3001/api/analyze/health`: HTTP 200.
- Local `http://127.0.0.1:3001/api/analyze/config`: HTTP 200.
- Public `https://venn.carboncaste.io/api/analyze/health`: HTTP 200.
- Public `https://venn.carboncaste.io/api/analyze/config`: HTTP 200.
- As required, this was treated as hygiene/canary evidence only, not as a hard
  publisher dependency.

GitHub workflow:

```text
Public Feed Freshness Monitor    disabled_manually    295013478
```

## Competing Writer Exclusion

Initial check found stale `peaceful_gates`:

- Container: `peaceful_gates`, image `node:20.16.0-bookworm`, running since
  `2026-06-11T09:25:49.586789146Z`.
- Sanitized command hash:
  `7bd61866571a5ec9542345deef538de28e05e298f91d18e90082fa0a8c8c2fca`.
- Env names only:
  `NODE_VERSION`, `PATH`, `VH_BUNDLE_SYNTHESIS_MAX_TOKENS`,
  `VH_BUNDLE_SYNTHESIS_MODEL`, `VH_BUNDLE_SYNTHESIS_RATE_PER_MIN`,
  `VH_BUNDLE_SYNTHESIS_TIMEOUT_MS`, `VH_DAEMON_FEED_ARTIFACT_ROOT`,
  `VH_SYNTHESIS_BOOTSTRAP_ARTIFACT_DIR`,
  `VH_SYNTHESIS_BOOTSTRAP_TARGETS`, `YARN_VERSION`.
- Redacted logs ended with `synthesis_bootstrap_summary` status `pass` and
  `status_counts: { written: 12 }`.

Because this was a completed old bootstrap one-shot left alive by the Node/GUN
process, it was stopped. The container was launched with `--rm`, so Docker
auto-removed it during stop.

Final competing-writer proof:

```text
sudo docker ps --filter name=peaceful_gates --filter status=running
# no rows

sudo docker ps | grep -iE 'news-aggregat|publish|synth|peaceful' || true
# no rows

pgrep -af 'news-aggregator|daemon.js|publisher|synth' || true
# no writer rows after self-command filtering and redaction
```

## Env File Proof

Default publisher env file:

```text
/home/humble/.config/vhc/news-aggregator.env: missing
```

No `VH_NEWS_DAEMON_ENV_FILE` or `news-aggregator.env` override reference was
found under host user/system systemd config or shell startup files.

Available A6 config fragments by variable names only:

```text
cloudflared.env:
  CLOUDFLARE_TUNNEL_TOKEN

public-beta-news-system-writer-v4.env:
  VH_NEWS_SYSTEM_WRITER_ID
  VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL
  VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL

public-beta-origin.env:
  HOST
  PORT
  VH_PUBLIC_ORIGIN_ANALYSIS_TARGET
  VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC
  VH_PUBLIC_ORIGIN_FAIL_IF_MISSING_STATIC
  VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH
  VH_PUBLIC_ORIGIN_STATIC_DIR

public-beta-relay-a.env / public-beta-relay-b.env:
  GUN_FILE
  GUN_HOST
  GUN_PORT
  GUN_RADISK
  NODE_ENV
  VH_RELAY_ALLOWED_ORIGINS
  VH_RELAY_AUTH_REQUIRED
  VH_RELAY_DAEMON_TOKEN
  VH_RELAY_HEALTH_PROBE_COMPACTION_INTERVAL_MS
  VH_RELAY_ID
  VH_RELAY_PEERS
  VH_RELAY_PEER_ALLOWLIST
  VH_RELAY_PEER_AUTH_MODE

public-beta-relay-daemon-token-v2.env:
  VH_RELAY_DAEMON_TOKEN

storycluster-openai.env:
  OPENAI_API_KEY
  VH_STORYCLUSTER_OPENAI_KEY_CREATED_AT
  VH_STORYCLUSTER_OPENAI_KEY_TRACKING_ID
```

Config fragment modes and hashes:

```text
mode=600 owner=humble group=humble size=209 path=/home/humble/.config/vhc/cloudflared.env
sha256=c50afe1627877ebb047e0aacf0e882b5ce87e2c4c5e176802127d5610b316a65
mode=644 owner=humble group=humble size=908 path=/home/humble/.config/vhc/mesh-peer-config-public-beta-fallback-wss-v1.json
sha256=6435751f5279655c68bea9bb41fb201cf614b8e223b567bcc42ad4feb743ae37
mode=600 owner=humble group=humble size=319 path=/home/humble/.config/vhc/mesh-peer-config-signing-key.json
sha256=f7cfab796e7bfc8442c31fc24f5aa34155a195a0806570d541c0e0a849463972
mode=600 owner=humble group=humble size=285 path=/home/humble/.config/vhc/public-beta-news-system-writer-v4.env
sha256=ed1b75c2857d26b18d4fedaed772f1481a02e1f27f2f8f1f70a85247e7beab65
mode=600 owner=humble group=humble size=378 path=/home/humble/.config/vhc/public-beta-origin.env
sha256=5ea4497c33cdb37f2ec9845dd29b0562709fd95b8f7d008b828dc4c512e5b0d4
mode=600 owner=humble group=humble size=65 path=/home/humble/.config/vhc/public-beta-relay-a-daemon-token
sha256=13eee31d51144d8ec71248a16944de0dfaf7f3d74c97b26e1031571926d4950c
mode=600 owner=humble group=humble size=506 path=/home/humble/.config/vhc/public-beta-relay-a.env
sha256=315c66cbe19c47b5d924789f009d6acf4ffbcb3b0fa50cc285a40c18aa9a93b0
mode=600 owner=humble group=humble size=65 path=/home/humble/.config/vhc/public-beta-relay-b-daemon-token
sha256=7682f140b0c07798c2404161f0cd690e73203c8449df7bc7f9b768c54c12841b
mode=600 owner=humble group=humble size=506 path=/home/humble/.config/vhc/public-beta-relay-b.env
sha256=231a56a61f4f3553449b01206614e35de1587e7b41aa7148c0cc4cf38d153efe
mode=600 owner=humble group=humble size=87 path=/home/humble/.config/vhc/public-beta-relay-daemon-token-v2.env
sha256=28ffd5af1e4b84b7b793eb30921d25b0892c3b4eb104a1928bfeaa3e7c7b7424
mode=600 owner=humble group=humble size=306 path=/home/humble/.config/vhc/storycluster-openai.env
sha256=f8cd4d77bf8678633e95672dba123ec2bc5ea80c8248a5f9bb8c98216e814cef
mode=600 owner=humble group=humble size=44 path=/home/humble/.config/vhc/storycluster-public-beta-auth-token-v1.txt
sha256=7d19fdc6d6ced04326062ddc6d62e03460362618403ee7c50f4811b5076e4000
```

The assembled publisher env surface required for Phase 5 was not present:
`VH_GUN_PEERS`, `VH_BUNDLE_SYNTHESIS_ENABLED`,
`VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS`,
`VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL`,
`VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST`, `VH_NEWS_DAEMON_HOLDER_ID`,
`VH_NEWS_DAEMON_STATE_DIR`, and `VH_NEWS_SYSTEM_WRITER_PIN_JSON` were not
present in one approved publisher env file.

Repo pin proof from `apps/web-pwa/src/luma/system-writer-pin.json`:

- `pinVersion`: 1
- `schemaEpoch`: `luma-public-v1`
- `maxProtocolVersion`: `luma-public-v1`
- `signatureSuite`: `jcs-ed25519-sha256-v1`
- target writer: `vh-public-beta-news-system-writer-v4`, status `active`
- writer count: 4

This was not used to synthesize a production env file.

## Read-Only Preflights

Node and pnpm on host:

```text
node=v22.22.2
pnpm=9.7.1
```

StoryCluster build:

```text
pnpm --filter @vh/storycluster-engine build
# pass
```

OpenAI StoryCluster provider preflight, using the existing OpenAI fragment only:

```json
{
  "stage": "storycluster_openai_preflight",
  "status": "pass",
  "code": null,
  "provider": {
    "providerId": "openai-storycluster",
    "textModelId": "gpt-4o-mini",
    "embeddingModelId": "text-embedding-3-small",
    "baseUrl": null,
    "timeoutMs": 120000,
    "effectiveBaseUrl": "https://api.openai.com/v1"
  }
}
```

Source health:

```text
pnpm check:news-sources:health
# fail
```

The first source-health attempt exposed root-owned generated build artifacts in
the host checkout. A narrow ownership repair was applied only to package/service
`dist` directories and `tsconfig.tsbuildinfo` files under `/home/humble/VHC`.
The rerun reached the actual source-health policy result and failed release
evidence:

```text
readinessStatus: blocked
releaseEvidence.status: fail
releaseEvidence.recommendedAction: hold_release_for_trend_recovery
releaseEvidence.reasons:
  - insufficient_release_evidence_window
  - blocked_run_within_release_window
  - latest_run_not_ready
  - new_remove_sources_detected
latestNewRemoveSourceIds:
  - bigbendsentinel-border-wall
```

Report artifact:

```text
/home/humble/VHC/services/news-aggregator/.tmp/news-source-admission/1781485082785/source-health-report.json
```

Relay snapshot watch baseline:

```text
schemaVersion: vh-relay-latest-index-snapshot-watch-v1
status: fail
snapshot schemaVersion: vh-news-latest-index-relay-snapshot-v1
entryCount: 15 on relay a, b, and c
newestEntryAtIso: 2026-06-11T08:52:07.718Z
newestEntryAgeMs: 317068977
blocker: newest_entry_stale on relay a, b, and c
```

Snapshot hashes after abort:

```text
b35fb66a715b68fa88268851cd6305d83f9f536d2e2dd1a500610d9ce65cd73a  /home/humble/.local/share/vhc/vhc-relay-a/data/news-latest-index-snapshot.json
4382692304d84d5d49f6d18dba81eec7735a5a2efa249f568c64f6f1dd226a91  /home/humble/.local/share/vhc/vhc-relay-b/data/news-latest-index-snapshot.json
a04e513aa2d810dc6bd28a0011b98a339de0032759f1afb1621c16af44b7d2fc  /home/humble/.local/share/vhc/vhc-relay-c/data/news-latest-index-snapshot.json
```

## Clean Abort State

Service state after abort verification:

```text
Unit vh-news-aggregator.service could not be found.
is-enabled: not-found
ActiveState=inactive
SubState=dead
NRestarts=0
approval_flag=absent_env_file_missing
```

No first-cycle watch was run because the publisher never started. No latest-index
post-start movement, browser smoke, lifecycle/frame-table sampling, or
fresh-story SLO proof was collected because those are post-start evidence gates.

## Commands Run

Representative command set, with secret-bearing outputs redacted or avoided:

```bash
git fetch origin --prune
git pull --ff-only origin main
gh pr view 648 --json number,state,mergedAt,mergeCommit,headRefName,baseRefName,url,statusCheckRollup
gh workflow list --all

ssh humble@ccibootstrap 'cd /home/humble/VHC; git fetch origin main --prune; git checkout main; git pull --ff-only origin main'
ssh humble@ccibootstrap 'sudo docker inspect vhc-public-origin vhc-relay-a vhc-relay-b vhc-relay-c --format ...'
ssh humble@ccibootstrap 'systemctl --user status vh-analysis-backend-3001.service --no-pager'
ssh humble@ccibootstrap 'curl -sS -i http://127.0.0.1:3001/api/analyze/health'
ssh humble@ccibootstrap 'curl -sS -i http://127.0.0.1:3001/api/analyze/config'
ssh humble@ccibootstrap 'curl -sS -i https://venn.carboncaste.io/api/analyze/health'
ssh humble@ccibootstrap 'curl -sS -i https://venn.carboncaste.io/api/analyze/config'

ssh humble@ccibootstrap 'sudo docker ps --filter name=peaceful_gates --filter status=running'
ssh humble@ccibootstrap 'sudo docker ps | grep -iE "news-aggregat|publish|synth|peaceful" || true'
ssh humble@ccibootstrap 'pgrep -af "news-aggregator|daemon.js|publisher|synth" || true'
ssh humble@ccibootstrap 'sudo docker logs --tail 220 peaceful_gates'
ssh humble@ccibootstrap 'sudo docker stop peaceful_gates'

ssh humble@ccibootstrap 'stat -c ... ~/.config/vhc/news-aggregator.env'
ssh humble@ccibootstrap 'find ~/.config/vhc -maxdepth 2 -type f -printf ...'
ssh humble@ccibootstrap 'python3 ... # print env var names only'

ssh humble@ccibootstrap 'pnpm check:news-sources:health'
ssh humble@ccibootstrap 'pnpm --filter @vh/storycluster-engine build'
ssh humble@ccibootstrap 'node --input-type=module ... preflightOpenAIStoryClusterProviderFromEnv'
ssh humble@ccibootstrap 'node tools/scripts/relay-latest-index-snapshot-watch.mjs'

ssh humble@ccibootstrap 'systemctl --user stop vh-news-aggregator.service || true'
ssh humble@ccibootstrap 'systemctl --user disable vh-news-aggregator.service || true'
ssh humble@ccibootstrap 'sha256sum /home/humble/.local/share/vhc/vhc-relay-{a,b,c}/data/news-latest-index-snapshot.json'
```
