# Requirements → Tests Matrix (Sprint 2 Hardening)

Status: draft helper to keep coverage aligned with `docs/foundational/ARCHITECTURE_LOCK.md`, `docs/foundational/System_Architecture.md`, and `docs/sprints/02-sprint-2-advanced-features.md`.

## Civic Sentiment
- Event-level signal (SentimentSignal shape, weight ∈ [0, 2]): `packages/data-model/src/schemas.test.ts`
- Per-cell per-user toggle (+/–/neutral, last-write wins): `apps/web-pwa/src/hooks/useSentimentState.test.ts`
- UI per-cell toggles (no collapse on click): `apps/web-pwa/src/components/AnalysisView.test.tsx`
- Engagement decay (first click = 1, then decay to 2): `apps/web-pwa/src/hooks/useSentimentState.test.ts`
- Read decay (Eye): `apps/web-pwa/src/hooks/useSentimentState.test.ts`
- Aggregate per-cell counts + aggregate Lightbulb across users: `packages/data-model/src/sentiment-aggregate.test.ts`
- Public topology guard (no `{district_hash, nullifier}` in public mesh): `packages/gun-client/src/topology.test.ts`

## Identity & Trust
- Stable nullifier derivation + scaled trust scores: `apps/web-pwa/src/hooks/useIdentity.test.ts`
- Session response/types: `packages/types/src/index.test.ts`

## AI Engine
- Prompt/parse/guardrails pipeline: `packages/ai-engine/src/analysis.test.ts`, `worker.test.ts`, `prompts.test.ts`

## XP / Economics / Governance
- XP ledger math: `apps/web-pwa/src/hooks/useXpLedger.test.ts`
- UBE/Wallet display & gating: `apps/web-pwa/src/routes/WalletPanel.test.tsx`, `apps/web-pwa/src/hooks/useWallet.test.ts`
- Governance local voting + curated mapping log: `apps/web-pwa/src/hooks/useGovernance.test.ts`

## Data Topology
- Topology guard paths + encryption requirement: `packages/gun-client/src/topology.test.ts`

## E2E Golden Paths
- Identity → UBE → Analysis → Mesh reuse: `packages/e2e/src/full-flow.spec.ts`
- Identity → Analysis loop: `packages/e2e/src/tracer-bullet.spec.ts`
