# Sprint 4: Agentic Foundation (Alignment Plan)

Status: In progress
Predecessor: Sprint 3.5
Context: Hardening core contracts before Sprint 5 delivery

## Goal

Establish V2-first foundations so downstream work ships against `TopicSynthesisV2`, not legacy `CanonicalAnalysisV1`.

## Direction locks

1. `CanonicalAnalysisV1` is compatibility-only.
2. Canonical synthesis path is StoryBundle + TopicDigest -> TopicSynthesisV2.
3. Familiars inherit principal budgets/trust and never create separate influence lanes.

## Phase 0 - Safety and identity primitives

- [x] Identity vault migration completed
- [ ] Familiar runtime policy enforcement (suggest/act/high-impact)
- [ ] Delegation grant lifecycle (create/revoke/expire)
- [ ] Budget enforcement completion (`moderation/day`, `civic_actions/day`)

## Phase 1 - Story and topic substrate

- [ ] Implement News Aggregator ingest + StoryBundle creation
- [ ] Implement TopicDigest builder from verified thread activity
- [ ] Define stable TopicId semantics across News/Topics/Social
- [ ] Add linked-social notification substrate (vault token handling)

## Phase 2 - Topic Synthesis V2 pipeline

- [ ] Candidate collection (quorum size 5, verified-only)
- [ ] Deterministic synthesis selection and divergence metrics
- [ ] Epoch scheduler (30m debounce, 4/day cap)
- [ ] Comment-triggered re-synthesis (10 comments, 3 unique principals)

## Phase 3 - Provider switching and consent

- [ ] Provider registry IDs + model metadata
- [ ] Consent UI for remote providers with cost/privacy labels
- [ ] Telemetry redaction and policy tests

## Phase 4 - Feed and forum contract alignment

- [ ] Unified feed chips/sorts (All/News/Topics/Social + Latest/Hottest/My Activity)
- [ ] Reply hard limit 240 chars
- [ ] Convert-to-article routing to Docs draft
- [ ] Forum references synthesis state by `{topicId, epoch, synthesisId}`

## Exit criteria

1. V2 contracts compile with no `analysis_id` dependency in new paths.
2. Story clustering + synthesis V2 + linked-social contracts are test-covered.
3. Sprint 5 can implement Docs and Civic Action Kit without contract churn.
