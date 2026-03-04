# AI Engine and Topic Synthesis Contract

> Status: Foundational Reference
> Owner: VHC Core Architecture
> Last Reviewed: 2026-03-03
> Depends On: docs/README.md, docs/CANON_MAP.md


Version: 0.2
Status: Canonical for Season 0 (V2-first)
Implementation note (2026-03-03): Current live/manual profiles default to API relay analysis (`VITE_VH_ANALYSIS_PIPELINE=true`, `/api/analyze`). Local engine paths remain available, but local-first is a target-state default gated on local-agent capability thresholds.

Defines the engine-routing and safety contract for Topic Synthesis V2 generation from StoryBundle/TopicDigest inputs.

## 1. Purpose

Keep model choice interchangeable while preserving one stable contract:

`inputs -> prompt -> engine router -> parser -> validation -> topic-synthesis-v2`

Swapping providers must not change schema shape, privacy boundaries, or deterministic acceptance rules.

## 2. Inputs

Supported synthesis inputs:

- `StoryBundle` (clustered multi-source reporting)
- `TopicDigest` (rolling discussion digest)
- `TopicSeed` (user-origin topic seed)

Single-URL article input can be used only for legacy compatibility flow.

## 3. Provider registry

### 3.1 Provider IDs

Allowed provider IDs:

- `local-webllm` (local path; non-default in current live profile)
- `local-device-model`
- `openai`
- `google`
- `anthropic`
- `xai`

Each run records:

- `providerId`
- `modelId`
- `policyMode` (`local-only`, `remote-only`, `local-first`, `remote-first`, `shadow`)
- `kind` (`local` or `remote`)

### 3.2 Cost/privacy labels

Each provider option must expose label metadata in settings UI:

```ts
interface ProviderLabel {
  providerId: string;
  costTier: 'free' | 'low' | 'medium' | 'high' | 'variable';
  privacyBoundary: 'on-device' | 'remote-processor';
  reliabilityTier: 'experimental' | 'standard' | 'best-effort';
}
```

## 4. Runtime default, consent, and switching contract

Season 0 deployment baseline:

- **Default today:** API relay path (`/api/analyze`) in live profiles.
- **Target default later:** local-first, once local-agent capability thresholds are met.
- **Current local-first dependency:** user-linked local agents that can complete analysis work at acceptable reliability/latency.

Remote inference/provider switching remains opt-in at the provider-selection layer.

Required UX sequence before first remote run:

1. User selects provider/model.
2. UI displays cost tier and privacy boundary.
3. User grants explicit consent.
4. Consent is persisted locally and revocable from settings.

Policy rules:

- Default policy in live profiles is `remote-first` via relay-backed analysis.
- `local-only` remains supported for constrained/dev/offline profiles.
- Alternate remote policies cannot be activated without consent record.
- If consent is revoked for optional remote providers, router falls back to baseline profile policy.

## 5. Engine interface

```ts
interface JsonCompletionEngine {
  id: string;
  kind: 'local' | 'remote';
  modelName: string;
  completeJson(prompt: string): Promise<string>;
}

type EnginePolicy =
  | 'local-only'
  | 'remote-only'
  | 'local-first'
  | 'remote-first'
  | 'shadow';
```

## 6. Prompt and parse contract

Prompt builder must include:

- synthesis objective (facts + frames + warnings)
- source provenance hints
- strict JSON output schema instructions

Parser must enforce:

- valid JSON object extraction
- schema validation against synthesis candidate/result schema
- warning emission for source mismatch or temporal inconsistencies

## 7. Telemetry and logging constraints

Telemetry is metadata-only.

Allowed fields:

- provider/model IDs
- policy mode
- timing/cost counters
- warning/error codes
- object IDs (`topic_id`, `epoch`, `synthesis_id`)

Forbidden in logs/telemetry:

- source plaintext
- raw article/report text
- OAuth tokens
- identity/constituency fields (`nullifier`, `district_hash`, proofs)

Retention and export:

- local diagnostics can retain extended logs with user consent
- remote telemetry endpoints must receive redacted metadata only

## 8. Failure and fallback behavior

- engine failure: fallback according to policy
- parse failure: surface typed error and do not publish synthesis
- validation warning: attach warning, continue if schema-valid
- quorum timeout: emit timeout reason and continue deterministic selection using collected candidates

## 9. Security boundaries

- Provider credentials and linked-social tokens are vault-only.
- Prompt payloads for remote engines must not include identity fields.
- Familiars can trigger jobs only on-behalf-of a principal and consume the principal budgets.

## 10. Legacy note

`CanonicalAnalysisV1` pipeline remains compatibility-only. New implementation must target `topic-synthesis-v2` generation paths.
