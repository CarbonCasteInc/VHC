# PR B TopicSynthesisV2 Bundle Spine Implementation Contract

Status: Implemented by PR #528; historical contract retained for audit
Owner: VHC Core Engineering
Last Updated: 2026-04-21

This plan preserved the implementation contract for the PR B follow-on to PR
#523. PR #528 merged the bundle synthesis worker and story-detail accepted
synthesis path into `main`; this file is now a non-authoritative historical
audit artifact. Normative behavior remains
owned by `docs/specs/topic-synthesis-v2.md`,
`docs/specs/spec-news-aggregator-v0.md`,
`docs/specs/spec-topic-discovery-ranking-v0.md`, and the canonical docs listed
in `docs/CANON_MAP.md`.

## Branch Strategy

- PR #523 (`coord/analysis-cache-hygiene`) landed standalone on `main` first.
- PR B was cut fresh from `main` after PR #523 merged.
- PR B depended on the PR #523 expansion of `isPlaceholderPerspectiveText` to
  include `Frame unavailable`, `Reframe unavailable`, and `Summary unavailable`.
- The PR B work landed as PR #528, adding bundle-synthesis spine code and story
  detail rendering from accepted `TopicSynthesisV2`.

## Landed In PR #528

- `services/news-aggregator/src/bundleSynthesisWorker.ts`
- `services/news-aggregator/src/bundleSynthesisRelay.ts`
- `services/news-aggregator/src/bundleSynthesisDaemonConfig.ts`
- `services/news-aggregator/src/enrichmentQueue.ts`
- `packages/ai-engine/src/bundlePrompts.ts`
- `packages/gun-client/src/safeLatestSynthesisAdapters.ts`
- story-detail rendering updates in `apps/web-pwa/src/components/feed/NewsCard.tsx`
  and `apps/web-pwa/src/components/feed/NewsCardBack.tsx`

Known follow-ons after PR #528:

- ledger-driven `primary_sources` / `related_links` enrichment in the generic
  bundle publication path;
- correction/admin controls for suppressing or regenerating bad accepted
  synthesis artifacts;
- deterministic release smoke coverage for accepted synthesis availability in
  launch snapshots.

The remaining sections intentionally preserve the original imperative contract
language for auditability. Do not read those sections as current "not built yet"
backlog unless they are also listed as follow-ons above.

## Short Recommendation

Build the daemon worker as a thin consumer of the existing
`onSynthesisCandidate` hook in `packages/ai-engine/src/newsRuntime.ts`,
treating the candidate as a trigger signal only. Inside the worker,
`readStoryBundle(client, story_id)` is the sole authoritative input.

Canonical prompt and strict parser logic live in
`packages/ai-engine/src/bundlePrompts.ts`. The parser mirrors
`parseGeneratedAnalysisResponse`, including `parsed.final_refined || parsed`,
and trims all persisted text before schema validation. The worker derives
`source_count` and publishers from the re-read `StoryBundle`, cross-checks the
model's `source_count` as a quality gate, and never calls
`writeTopicSynthesis`.

The worker writes via:

1. `writeTopicEpochCandidate`
2. `writeTopicEpochSynthesis`
3. `writeTopicLatestSynthesisIfNotDowngrade`

News-bundle synthesis is always written at `epoch: 0` with
`quorum: { required: 1, received: 1 }`. The `/latest` write uses an
`ownershipGuard` requiring the existing `/latest.synthesis_id` to start with
`news-bundle:` before allowing equal-epoch equal-quorum refresh. Forum synthesis
at a higher epoch, or with a higher same-epoch quorum, wins naturally.

Relay calls are contained inside worker-local `try/catch` blocks so timeouts
and upstream failures emit `[vh:bundle-synth] relay_timeout` or
`[vh:bundle-synth] relay_failed`, never only the generic daemon enrichment error.

## Architecture Decisions

| Decision | Value |
|---|---|
| Prompt and parser location | `packages/ai-engine/src/bundlePrompts.ts` |
| Daemon hook | Existing `onSynthesisCandidate` in `services/news-aggregator/src/daemon.ts` |
| Freshness anchor | `readStoryBundle(client, candidate.story_id)` |
| Idempotency key | `sha256("news-bundle-v1|" + story_id + "|" + provenance_hash + "|" + model_id)` |
| Epoch | `0`; news-bundle synthesis never advances epoch |
| `/latest` write | `writeTopicLatestSynthesisIfNotDowngrade` with `ownershipGuard` |
| Queue | Existing `createAsyncEnrichmentQueue`, extended with `maxDepth` |
| Concurrency | Single-worker, queue-serialized daemon pattern |
| Feature flag | `VH_BUNDLE_SYNTHESIS_ENABLED`, server-only |
| Metadata-only input | Headline, publisher, title, URL, optional `summary_hint`; no article full text |

## File-By-File Contract

### `packages/ai-engine/src/bundlePrompts.ts`

Extend the existing prompt-only module. Add imports:

```ts
import { z } from 'zod';
import { isPlaceholderPerspectiveText } from './schema';
import type { StoryBundle } from './newsTypes';
```

Add a trim-first strict generated-output schema:

```ts
const TrimmedNonEmptyString = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'must be non-empty after trimming');

const BundlePerspectiveTextSchema = TrimmedNonEmptyString.refine(
  (value) => !isPlaceholderPerspectiveText(value),
  'must not be a placeholder',
);

const BundleFrameSchema = z
  .object({
    frame: BundlePerspectiveTextSchema,
    reframe: BundlePerspectiveTextSchema,
  })
  .strict();

export const GeneratedBundleSynthesisResultSchema = z
  .object({
    summary: TrimmedNonEmptyString,
    frames: z.array(BundleFrameSchema).min(2).max(4),
    source_count: z.number().int().positive(),
    source_publishers: z.array(TrimmedNonEmptyString).min(1),
    verification_confidence: z.number().min(0).max(1),
  })
  .strict();

export type GeneratedBundleSynthesisResult = z.infer<
  typeof GeneratedBundleSynthesisResultSchema
>;
```

Add parser behavior matching the existing generated-analysis parser:

```ts
export enum BundleSynthesisParseError {
  NO_JSON_OBJECT_FOUND = 'NO_JSON_OBJECT_FOUND',
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
  SCHEMA_VALIDATION_ERROR = 'SCHEMA_VALIDATION_ERROR',
}

export function parseGeneratedBundleSynthesis(raw: string): GeneratedBundleSynthesisResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(BundleSynthesisParseError.NO_JSON_OBJECT_FOUND);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const payload = parsed.final_refined || parsed;
    return GeneratedBundleSynthesisResultSchema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);
    }
    throw new Error(BundleSynthesisParseError.JSON_PARSE_ERROR);
  }
}
```

Add `buildBundlePromptFromStoryBundle(bundle, opts)` so source titles are
preserved:

```ts
export function buildBundlePromptFromStoryBundle(
  bundle: StoryBundle,
  opts?: { verificationConfidence?: number },
): string {
  const sources = bundle.primary_sources ?? bundle.sources;
  const verificationConfidence =
    opts?.verificationConfidence ?? bundle.cluster_features.confidence_score;

  return generateBundleSynthesisPrompt({
    headline: bundle.headline,
    sources: sources.map((source) => ({
      publisher: source.publisher,
      title: source.title,
      url: source.url,
    })),
    summary_hint: bundle.summary_hint,
    verification_confidence: verificationConfidence,
  });
}
```

`buildBundlePrompt(StoryBundleInputCandidate)` stays unchanged.

### `packages/gun-client/src/synthesisAdapters.ts`

Add a non-downgrading latest writer after `writeTopicLatestSynthesis`:

```ts
export interface SafeLatestWriteOptions {
  ownershipGuard?: (existing: TopicSynthesisV2) => boolean;
}

export type SafeLatestWriteResult =
  | { written: true }
  | {
      written: false;
      reason:
        | 'downgrade_existing_epoch'
        | 'downgrade_existing_quorum'
        | 'ownership_guard_rejected';
    };

export async function writeTopicLatestSynthesisIfNotDowngrade(
  client: VennClient,
  synthesis: unknown,
  opts: SafeLatestWriteOptions = {},
): Promise<SafeLatestWriteResult> {
  assertNoForbiddenSynthesisFields(synthesis);
  const sanitized = TopicSynthesisV2Schema.parse(synthesis);
  const existing = await readTopicLatestSynthesis(client, sanitized.topic_id);

  if (existing) {
    if (existing.epoch > sanitized.epoch) {
      return { written: false, reason: 'downgrade_existing_epoch' };
    }
    if (
      existing.epoch === sanitized.epoch &&
      existing.quorum.received > sanitized.quorum.received
    ) {
      return { written: false, reason: 'downgrade_existing_quorum' };
    }
    if (opts.ownershipGuard && !opts.ownershipGuard(existing)) {
      return { written: false, reason: 'ownership_guard_rejected' };
    }
  }

  await putWithAck(
    getTopicLatestSynthesisChain(client, normalizeTopicId(sanitized.topic_id)),
    sanitized,
  );
  return { written: true };
}
```

`writeTopicSynthesis` remains unchanged for current forum bridge compatibility.
PR B worker code must not import or call it.

### `services/news-aggregator/src/bundleSynthesisWorker.ts`

Create a new worker module. It must not import `writeTopicSynthesis`.

Required injected dependencies:

```ts
export interface BundleSynthesisWorkerDeps {
  client: VennClient;
  readStoryBundle: typeof readStoryBundle;
  readTopicEpochCandidate: typeof readTopicEpochCandidate;
  writeTopicEpochCandidate: typeof writeTopicEpochCandidate;
  writeTopicEpochSynthesis: typeof writeTopicEpochSynthesis;
  writeTopicLatestSynthesisIfNotDowngrade: typeof writeTopicLatestSynthesisIfNotDowngrade;
  relay: (prompt: string) => Promise<string>;
  modelId: string;
  now: () => number;
  logger: LoggerLike;
}
```

Required constants and candidate id:

```ts
const PIPELINE_VERSION = 'news-bundle-v1';
const SYNTHESIS_ID_PREFIX = 'news-bundle:';

async function deriveCandidateId(
  storyId: string,
  provenanceHash: string,
  modelId: string,
): Promise<string> {
  const input = `${PIPELINE_VERSION}|${storyId}|${provenanceHash}|${modelId}`;
  const digest = await sha256Hex(input);
  return `${SYNTHESIS_ID_PREFIX}${digest}`;
}
```

Required worker flow:

1. Read `StoryBundle` fresh by `candidate.story_id`.
2. Return with `bundle_missing` telemetry if absent.
3. Use `bundle.topic_id`, never `candidate.work_items[0].topic_id`, for writes.
4. Use `bundle.primary_sources ?? bundle.sources` for actual source count and
   publisher telemetry.
5. Derive `candidate_id` from `pipeline_version`, `story_id`,
   `provenance_hash`, and `model_id`.
6. Check idempotency with `readTopicEpochCandidate(client, topicId, 0, candidateId)`.
7. Build the prompt from the re-read bundle via `buildBundlePromptFromStoryBundle`.
8. Call relay inside worker-local `try/catch`; map AbortError or timeout-like
   failures to `relay_timeout`, and other failures to `relay_failed`.
9. Parse with `parseGeneratedBundleSynthesis`.
10. If parsed `source_count` differs from the bundle-derived source count,
    emit `source_count_mismatch` and return without writes.
11. Write `CandidateSynthesis` at epoch `0`.
12. Write `TopicSynthesisV2` at epoch `0`.
13. Conditionally write `/latest` through `writeTopicLatestSynthesisIfNotDowngrade`
    using an ownership guard:

```ts
{
  ownershipGuard: (existing) =>
    existing.synthesis_id.startsWith(SYNTHESIS_ID_PREFIX),
}
```

The persisted `CandidateSynthesis` must use:

- `candidate_id`: derived id
- `topic_id`: re-read `bundle.topic_id`
- `epoch`: `0`
- `facts_summary`: trimmed parsed summary
- `frames`: trimmed parsed frames
- `warnings`: `['single-source-only']` only when actual bundle source count is `1`
- `provider`: `{ provider_id: 'openai', model_id, kind: 'remote' }`
- `created_at`: `now()`

The persisted `TopicSynthesisV2` must use:

- `schemaVersion`: `topic-synthesis-v2`
- `topic_id`: re-read `bundle.topic_id`
- `epoch`: `0`
- `synthesis_id`: `news-bundle:${storyId}:${provenanceHash.slice(0, 16)}`
- `inputs`: `{ story_bundle_ids: [storyId] }`
- `quorum`: `{ required: 1, received: 1, reached_at: now, timed_out: false, selection_rule: 'deterministic' }`
- `facts_summary`: trimmed parsed summary
- `frames`: trimmed parsed frames
- `warnings`: same as candidate
- `divergence_metrics`: `{ disagreement_score: 0, source_dispersion: 0, candidate_count: 1 }`
- `provenance`: candidate id and OpenAI provider mix
- `created_at`: `now()`

### `services/news-aggregator/src/daemonUtils.ts`

Extend `createAsyncEnrichmentQueue` with optional `maxDepth` and `onDrop`:

- Default remains unbounded to preserve existing behavior.
- When `pending.length >= maxDepth`, do not enqueue the candidate.
- Emit/drop reason: `queue_full`.

### `services/news-aggregator/src/daemon.ts`

Parse `VH_BUNDLE_SYNTHESIS_*` vars in `startNewsAggregatorDaemonFromEnv`.
When `VH_BUNDLE_SYNTHESIS_ENABLED` is truthy, construct the bundle synthesis
worker and pass it to `createNewsAggregatorDaemon` through the existing
`enrichmentWorker` seam.

### `services/news-aggregator/src/bundleSynthesisRelay.ts`

Create a sibling module to `analysisRelay.ts`:

- Use the same token-parameter and OpenAI chat-completions request pattern.
- Honor `VH_BUNDLE_SYNTHESIS_TIMEOUT_MS` with `AbortController`.
- Use a per-story rate limiter, default `20/min`.
- Export `postBundleSynthesisCompletion(prompt, opts)` returning raw completion
  text.
- Throw `AbortError` on timeout.
- Throw an `Error` containing HTTP status detail for non-2xx upstream responses.

### `services/news-aggregator/src/prompts.ts`

Add deprecation JSDoc to service-local bundle prompt/parser exports:

```ts
/** @deprecated Use @vh/ai-engine bundlePrompts. */
```

Do not delete them in PR B.

## Not Changed In PR B

- `apps/web-pwa/src/store/synthesis/pipelineBridge.ts` still uses
  `writeTopicSynthesis`; migrate it in a later PR after daemon canary.
- `packages/data-model/src/schemas/hermes/synthesis.ts` remains unchanged.
- Forum quorum logic remains unchanged.

## Required Tests

### `packages/ai-engine/src/bundlePrompts.test.ts`

- Valid JSON parses and returns trimmed fields.
- `final_refined` wrapper parses identically to bare payload.
- Leading/trailing whitespace in summary, frames, reframes, and publishers is
  trimmed.
- Blank-after-trim summary is rejected with `SCHEMA_VALIDATION_ERROR`.
- `frames.length < 2` is rejected.
- `frames.length > 4` is rejected.
- Placeholder frames are rejected: `N/A`, `No clear bias detected`,
  `Frame unavailable`.
- Placeholder reframes with surrounding whitespace are rejected.
- Fenced JSON parses through the greedy JSON-object extraction.
- Leading prose before JSON parses.
- No JSON object throws `NO_JSON_OBJECT_FOUND`.
- Malformed JSON throws `JSON_PARSE_ERROR`.
- `buildBundlePromptFromStoryBundle` preserves source titles literally.
- `buildBundlePromptFromStoryBundle` uses `primary_sources` when present, else
  `sources`.
- Summary hint is included when set and omitted when undefined.
- Cluster `confidence_score` renders as verification confidence when no
  explicit option is passed.
- Explicit verification confidence overrides cluster confidence.

### `services/news-aggregator/src/bundleSynthesisWorker.test.ts`

- Happy path writes candidate, epoch synthesis, and `/latest` on an empty topic.
- Written `topic_id` comes from the re-read bundle, not candidate work items.
- Candidate id changes when `provenance_hash` changes and is stable otherwise.
- Source-count mismatch logs `source_count_mismatch` and writes nothing.
- Parsed `source_publishers` are not treated as ground truth in telemetry.
- Single-source warning is derived from bundle source count.
- AbortError relay failure logs `relay_timeout`, writes nothing, and returns.
- Non-timeout relay failure logs `relay_failed`, writes nothing, and returns.
- Non-Error relay rejection is logged as `relay_failed`.
- Parser failures write nothing and log `parse_failed`.
- `final_refined` relay payload writes successfully.
- Missing bundle logs `bundle_missing`; no relay call; no writes.
- Existing candidate id logs `idempotent_skip`; no relay call; no writes.
- Higher existing epoch protects `/latest`.
- Strictly higher same-epoch quorum protects `/latest`.
- Equal epoch/equal quorum with `news-bundle:` prefix refreshes `/latest`.
- Non-`news-bundle:` epoch-0 latest is protected by `ownership_guard_rejected`.
- Empty latest writes.
- Test suite mocks `writeTopicSynthesis` and asserts it is never called.
- Whitespace in relay summary/frame/reframe is trimmed before write adapters see
  payloads.

### `packages/gun-client/src/synthesisAdapters.test.ts`

- Safe latest writer writes when `/latest` is empty.
- Writes when existing epoch is strictly lower.
- Skips with `downgrade_existing_epoch` when existing epoch is strictly higher.
- Skips with `downgrade_existing_quorum` when epochs are equal and existing
  quorum is strictly higher.
- Writes when epochs and quorums are equal.
- Calls `ownershipGuard` only when an existing latest exists.
- Returning `false` from `ownershipGuard` yields `ownership_guard_rejected`.
- Existing privacy guard still rejects identity/token fields.

### `services/news-aggregator/src/daemon.test.ts`

- Bundle worker is wired only when `VH_BUNDLE_SYNTHESIS_ENABLED` is truthy.
- Disabled mode preserves the no-op enrichment worker behavior.
- Existing lease/leadership tests remain green.

### `services/news-aggregator/src/daemonUtils.test.ts`

- `maxDepth` drops the next candidate and emits `queue_full`.
- Unset `maxDepth` preserves current unbounded behavior.

## Validation Commands

Run from repo root after implementation:

```bash
pnpm --filter @vh/ai-engine test -- bundlePrompts
pnpm --filter @vh/gun-client test -- synthesisAdapters
pnpm --filter @vh/news-aggregator test -- bundleSynthesisWorker
pnpm --filter @vh/news-aggregator test -- daemon
pnpm --filter @vh/news-aggregator test -- daemonUtils
pnpm -r typecheck
pnpm -r build
pnpm docs:check
git diff --check
```

Manual canary:

1. Set `VH_BUNDLE_SYNTHESIS_ENABLED=true`,
   `VH_BUNDLE_SYNTHESIS_MODEL=gpt-4o-mini`, and `OPENAI_API_KEY`.
2. Point the daemon at a staging Gun peer.
3. Wait for one daemon tick.
4. Confirm `[vh:bundle-synth] done` with `latest_written: true` for new topics.
5. Confirm protected topics report `latest_written: false` with a skip reason.
6. Read `/latest` through `readTopicLatestSynthesis` and assert:
   - `frames.length >= 2`
   - no empty or placeholder frame/reframe text
   - no leading or trailing whitespace
   - `facts_summary` is trimmed

## Env Flags

| Var | Default | Purpose |
|---|---|---|
| `VH_BUNDLE_SYNTHESIS_ENABLED` | `false` | Master switch |
| `VH_BUNDLE_SYNTHESIS_MODEL` | `gpt-4o-mini` | OpenAI model |
| `VH_BUNDLE_SYNTHESIS_TIMEOUT_MS` | `20000` | Per-job relay timeout |
| `VH_BUNDLE_SYNTHESIS_MAX_TOKENS` | `1200` | Completion budget |
| `VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH` | `32` | Queue max depth |
| `VH_BUNDLE_SYNTHESIS_RATE_PER_MIN` | `20` | Story-id-scoped rate limit |
| `OPENAI_API_KEY` | required when enabled | Shared OpenAI key |
| `VH_BUNDLE_SYNTHESIS_PIPELINE_VERSION` | `news-bundle-v1` | Candidate-id cache scope |

All variables are server-side only and must not be exposed as `VITE_*`.

## Telemetry

Emit structured JSON under `[vh:bundle-synth]`. Shared fields should include
`daemon_holder_id`, `pipeline_version`, and `model_id` when available.

| Event | Level | Key fields |
|---|---|---|
| `bundle_synth.start` | info | `story_id`, `topic_id`, `provenance_hash`, `candidate_id` |
| `bundle_synth.bundle_missing` | warn | `story_id` |
| `bundle_synth.idempotent_skip` | info | `story_id`, `topic_id`, `candidate_id` |
| `bundle_synth.relay_timeout` | warn | `story_id`, `topic_id`, `model_id`, `error_message`, `latency_ms` |
| `bundle_synth.relay_failed` | warn | `story_id`, `topic_id`, `model_id`, `error_message`, `latency_ms` |
| `bundle_synth.parse_failed` | warn | `story_id`, `topic_id`, `parse_error_code` |
| `bundle_synth.source_count_mismatch` | warn | `story_id`, `topic_id`, `parsed_source_count`, `actual_source_count` |
| `bundle_synth.candidate_written` | info | `story_id`, `candidate_id`, `epoch`, `quorum_received` |
| `bundle_synth.epoch_synthesis_written` | info | `story_id`, `topic_id`, `synthesis_id`, `epoch` |
| `bundle_synth.latest_written` | info | `story_id`, `topic_id`, `synthesis_id` |
| `bundle_synth.latest_skipped` | info | `story_id`, `topic_id`, `reason`, `existing_quorum_received`, `existing_epoch`, `existing_synthesis_id_prefix` |
| `bundle_synth.queue_full` | warn | `story_id`, `queue_depth`, `max_depth` |
| `bundle_synth.done` | info | `story_id`, `topic_id`, `candidate_id`, `synthesis_id`, `actual_source_count`, `publishers`, `latest_written`, `latest_skip_reason`, `latency_ms` |

Dashboard signals for canary:

- Ratio of `latest_written=true` to `bundle_synth.start`.
- Per-hour `parse_failed` and `source_count_mismatch`.
- p95 `latency_ms`.
- `ownership_guard_rejected` count.

## Acceptance Criteria

1. Freshness is anchored on `readStoryBundle(story_id)`.
2. Runtime candidate is used only as a trigger.
3. Source titles are preserved into the prompt.
4. Idempotency is provenance-sensitive through `candidate_id`.
5. Written `topic_id` always matches the re-read bundle.
6. `/latest` cannot be downgraded by daemon bundle synthesis.
7. Non-`news-bundle:` epoch-0 latest records are protected.
8. Daemon worker never imports or calls `writeTopicSynthesis`.
9. Summary, frame, and reframe strings are trimmed before storage.
10. Relay timeouts and upstream failures surface as bundle-synth telemetry.
11. Model source-count mismatch blocks all writes.
