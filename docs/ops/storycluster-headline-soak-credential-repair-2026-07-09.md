# StoryCluster Headline-Soak Credential Repair Packet - 2026-07-09

> Status: `operator_packet_pending`
> Owner: VHC Ops
> Last Reviewed: 2026-07-09
> Depends On: `docs/ops/storycluster-production-service.md`,
> `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`,
> `docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md`,
> `docs/ops/public-beta-launch-control-2026-07-09.md`

This packet clears exactly one current release-readiness blocker class:
StoryCluster headline-soak release evidence is blocked because the real
StoryCluster/OpenAI path reports
`storycluster_openai_invalid_api_key`. The goal is to repair the credential or
endpoint used by the release-evidence runner, prove the OpenAI provider
preflight passes, then rerun headline-soak and production-readiness evidence
without exposing secrets.

This packet does not approve publisher restart, relay restart, source-surface
changes, accepted-synthesis canary, auth-provider deployment, pager cutover, or
Codex live execution.

## Current Blocker

Latest local evidence before this packet:

- `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
  has `status: "blocked"`;
- `reasons` includes `headline_soak_release_evidence_failed`;
- `sourceHealthTrend.observedStatus` is `pass`;
- `headlineSoakTrend.observedStatus` is `fail`;
- `headlineSoakTrend.latestFailureDiagnosis.failureClass` is
  `storycluster_openai_invalid_api_key`;
- `headlineSoakTrend.latestFailureDiagnosis.recommendedAction` is
  `repair_storycluster_openai_credential_or_endpoint`.

This is a credential/endpoint blocker until a fresh preflight proves otherwise.
Do not interpret it as source scarcity, source-health failure, or StoryCluster
correctness failure.

## Secret Handling

Never paste these values into the terminal transcript, docs, PRs, issues,
release artifacts, or support tickets:

- `OPENAI_API_KEY`;
- `ANALYSIS_RELAY_API_KEY`;
- `VH_STORYCLUSTER_SERVER_AUTH_TOKEN`;
- `VH_STORYCLUSTER_REMOTE_AUTH_TOKEN`;
- bearer headers or provider response bodies that include credentials;
- full `~/.config/vhc/*.env` contents.

Allowed evidence:

- file mode, owner, group, path;
- file SHA-256 hash when the operator intentionally records a secret-file
  fingerprint;
- sorted variable names only;
- boolean/presence checks;
- OpenAI preflight status/code/provider provenance as printed by the repo helper
  after redaction.

## Surface Matrix

| Surface | Why it matters | Allowed action |
| --- | --- | --- |
| Local release-evidence runner | The current failing artifact path is local under `.tmp/daemon-feed-semantic-soak/...`; `collect:storycluster:headline-soak` uses the operator shell env. | Repair local secret/env outside git, then rerun preflight and headline-soak. |
| A6 StoryCluster service | Production StoryCluster also fails closed on the same OpenAI preflight class. | Repair `~/.config/vhc/storycluster.env`; restart only `vh-storycluster-engine.service` if that file changed. |
| A6 publisher | Reads StoryCluster remote config and has its own preflight on start. | Do not restart publisher from this packet. If publisher env must change, draft a separate maintenance packet. |

## Read-Only Diagnosis

Run from repo root on the evidence runner:

```bash
node - <<'NODE'
const fs = require('fs');
const p = '.tmp/storycluster-production-readiness/latest/production-readiness-report.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
console.log(JSON.stringify({
  status: j.status,
  reasons: j.reasons,
  sourceObserved: j.sourceHealthTrend?.observedStatus,
  headlineObserved: j.headlineSoakTrend?.observedStatus,
  diagnosis: j.headlineSoakTrend?.latestFailureDiagnosis,
}, null, 2));
NODE
```

Confirm the latest diagnosis still names
`storycluster_openai_invalid_api_key`. If the failure class changed, stop and
triage the new class instead of following this packet blindly.

Record local release-runner secret presence without values:

```bash
node - <<'NODE'
const names = [
  'OPENAI_API_KEY',
  'VH_STORYCLUSTER_OPENAI_BASE_URL',
  'VH_STORYCLUSTER_TEXT_MODEL',
  'VH_STORYCLUSTER_EMBEDDING_MODEL',
  'VH_STORYCLUSTER_OPENAI_TIMEOUT_MS',
];
for (const name of names) {
  const value = process.env[name]?.trim();
  console.log(`${name}=${value ? 'set' : 'unset'}`);
}
NODE
```

If checking A6, print metadata and names only:

```bash
ssh humble@ccibootstrap
cd /home/humble/VHC
git rev-parse --short=12 HEAD
systemctl --user show vh-storycluster-engine.service \
  -p ActiveState -p SubState -p ExecMainStatus --no-pager
systemctl --user show vh-news-aggregator.service \
  -p ActiveState -p SubState -p ExecMainStatus --no-pager
stat -c '%a %U %G %n' ~/.config/vhc/storycluster.env ~/.config/vhc/news-aggregator.env
sha256sum ~/.config/vhc/storycluster.env ~/.config/vhc/news-aggregator.env
awk -F= '/^[A-Z0-9_]+=/ {print FILENAME ":" $1}' \
  ~/.config/vhc/storycluster.env ~/.config/vhc/news-aggregator.env | sort
exit
```

Do not run `cat`, `grep OPENAI_API_KEY=`, or `systemctl cat` against secret
env files in a shareable transcript.

## Provider Preflight

After the operator repairs the local runner env or A6 service env, prove the
OpenAI provider through the repo helper. It redacts key-like substrings and
prints status/code/provider metadata only.

Local release runner:

```bash
corepack pnpm@9.7.1 --filter @vh/storycluster-engine build
node --input-type=module <<'NODE'
import { preflightOpenAIStoryClusterProviderFromEnv } from './services/storycluster-engine/dist/openaiProvider.js';

const result = await preflightOpenAIStoryClusterProviderFromEnv({
  timeoutMs: Number.parseInt(process.env.VH_STORYCLUSTER_OPENAI_PREFLIGHT_TIMEOUT_MS ?? '120000', 10) || 120000,
});
console.log(JSON.stringify({
  stage: 'storycluster_release_runner_openai_preflight',
  status: result.status,
  code: result.code,
  provider: result.provider,
  checks: result.checks,
}, null, 2));
if (result.status !== 'pass') process.exit(1);
NODE
```

A6 StoryCluster service env:

```bash
ssh humble@ccibootstrap
cd /home/humble/VHC
set -a
. ~/.config/vhc/storycluster.env
set +a
corepack pnpm@9.7.1 --filter @vh/storycluster-engine build
node --input-type=module <<'NODE'
import { preflightOpenAIStoryClusterProviderFromEnv } from './services/storycluster-engine/dist/openaiProvider.js';

const result = await preflightOpenAIStoryClusterProviderFromEnv({
  timeoutMs: Number.parseInt(process.env.VH_STORYCLUSTER_OPENAI_PREFLIGHT_TIMEOUT_MS ?? '120000', 10) || 120000,
});
console.log(JSON.stringify({
  stage: 'storycluster_a6_service_openai_preflight',
  status: result.status,
  code: result.code,
  provider: result.provider,
  checks: result.checks,
}, null, 2));
if (result.status !== 'pass') process.exit(1);
NODE
exit
```

Interpretation:

- `storycluster-openai-auth-missing`: install the key in the intended secret
  surface;
- `storycluster-openai-auth-invalid`: replace or repair the key;
- `storycluster-openai-model-unauthorized`: fix model access, model ids, or the
  endpoint/account used for the key;
- `storycluster-openai-network-unreachable`: inspect base URL, DNS, egress, and
  timeout.

## Minimal Repair Actions

Local release runner:

1. install or source the correct local secret outside git;
2. rerun the local provider preflight above;
3. proceed to release-evidence rerun only after preflight is `pass`.

A6 StoryCluster service:

1. edit `~/.config/vhc/storycluster.env` on A6 without echoing values;
2. keep mode `600`;
3. rerun the A6 provider preflight above;
4. if the env file changed, restart only StoryCluster so the service process
   reloads its env:

   ```bash
   ssh humble@ccibootstrap
   systemctl --user restart vh-storycluster-engine.service
   systemctl --user show vh-storycluster-engine.service \
     -p ActiveState -p SubState -p ExecMainStatus --no-pager
   set -a
   . ~/.config/vhc/storycluster.env
   set +a
   curl -fsS \
     -H "authorization: Bearer ${VH_STORYCLUSTER_SERVER_AUTH_TOKEN}" \
     http://127.0.0.1:4310/ready
   exit
   ```

Do not restart `vh-news-aggregator.service` in this packet. If the publisher env
also needs changes, create a separate publisher maintenance packet and include
the raw-feed freshness/readback preconditions from
`docs/ops/news-aggregator-production-service.md`.

## Evidence Rerun

After local release-runner preflight passes, rerun:

```bash
corepack pnpm@9.7.1 collect:storycluster:headline-soak
corepack pnpm@9.7.1 check:storycluster:production-readiness
```

Then summarize only secret-safe fields:

```bash
node - <<'NODE'
const fs = require('fs');
const p = '.tmp/storycluster-production-readiness/latest/production-readiness-report.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
console.log(JSON.stringify({
  status: j.status,
  reasons: j.reasons,
  sourceObserved: j.sourceHealthTrend?.observedStatus,
  headlineObserved: j.headlineSoakTrend?.observedStatus,
  latestFailureDiagnosis: j.headlineSoakTrend?.latestFailureDiagnosis ?? null,
}, null, 2));
NODE
```

The credential repair is complete when the latest diagnosis is absent or no
longer reports `storycluster_openai_invalid_api_key`. The broader
production-readiness gate may still block on real product evidence such as
sample fill rate, audited pair density, or source supply; those are separate
release-readiness blockers, not credential repair failures.

For MVP milestone M2, this packet's narrow credential repair is necessary but
not sufficient: any newly exposed product-evidence blocker remains red and must
be closed by a focused lane until fresh production readiness is
`release_ready`.

## Exit Criteria

- Provider preflight prints `status: "pass"` for the surface that was repaired.
- No secret values appear in the transcript or artifacts.
- `collect:storycluster:headline-soak` completes without the
  `storycluster_openai_invalid_api_key` diagnosis.
- `check:storycluster:production-readiness` is either `release_ready` or is red
  for a non-credential product-evidence reason.
- A6 `vh-storycluster-engine.service` is `active` with `ExecMainStatus=0` if
  the A6 env was touched.
- `vh-news-aggregator.service` is not restarted under this packet.

## Stop Rules

Stop and open a focused incident or follow-up packet if:

1. any command prints a raw key, bearer token, provider subject, or full provider
   error body;
2. OpenAI preflight remains `auth-invalid` after replacing the intended key;
3. the failure changes to model unauthorized, quota/rate, network, DNS, or
   timeout and cannot be resolved by env correction alone;
4. A6 StoryCluster does not return authenticated `/ready` after its restart;
5. raw public-feed freshness, relay liveness, relay snapshot freshness, or
   watch-closure alerts during the repair window;
6. a proposed fix requires publisher restart, relay restart, source-surface
   change, or accepted-synthesis enablement.
