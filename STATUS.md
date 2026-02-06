# TRINITY Implementation Status

**Last Updated:** 2026-02-06  
**Version:** 0.2.0 (Sprint 3.5 Complete)  
**Assessment:** Pre-production prototype

> ⚠️ **This document reflects actual implementation status, not target architecture.**  
> For the full vision, see `System_Architecture.md` and whitepapers in `docs/`.

---

## Quick Summary

| Layer | Status | Production-Ready |
|-------|--------|------------------|
| **LUMA (Identity)** | 🔴 Stubbed | ❌ No |
| **GWC (Economics)** | 🟡 Contracts ready, undeployed | ⚠️ Partial |
| **VENN (Analysis)** | 🟡 Pipeline exists, AI mocked | ❌ No |
| **HERMES Messaging** | 🟢 Implemented | ⚠️ Partial |
| **HERMES Forum** | 🟢 Implemented | ⚠️ Partial |
| **HERMES Docs** | ⚪ Planned (Sprint 5) | ❌ No |
| **HERMES Bridge (Civic Action Kit)** | ⚪ Planned/Redesign (Sprint 5) | ❌ No |

---

## Recently Merged (PR #10, commit `813558c`)

- ✅ Identity persistence migrated to encrypted IndexedDB vault (`vh-vault` database, `vault` object store) with a per-device master key.
- ✅ Legacy `vh_identity` path is migration-only (read once, then deleted); migration clobber guard prevents stale local data from overwriting an existing vault identity.
- ✅ Identity hydration bridge hardened: `vh:identity-published` is signal-only (no identity payload), eliminating DOM event data leakage.
- ✅ Master-key race hardening landed via atomic IndexedDB `add` semantics for key initialization.

---

## Active Follow-ups

- **Issue #11** — add a repo-level `typecheck` script (open).
- **Issue #12** — defensive-copy hardening + test harness docs follow-up (open).

---

## Sprint Completion Status

| Sprint | Doc Status | Actual Status | Key Gaps |
|--------|------------|---------------|----------|
| **Sprint 0** (Foundation) | ✅ Archived | ✅ Complete | None — monorepo, CLI, CI, core packages done |
| **Sprint 1** (Core Bedrock) | ✅ Archived | ⚠️ 90% Complete | Testnet deployment never done (localhost only); attestation is stub |
| **Sprint 2** (Civic Nervous System) | ✅ Complete | ⚠️ 85% Complete | AI engine mocked; no WebLLM/remote; Engine router exists but unused |
| **Sprint 3** (Communication) | ✅ Complete | ✅ Complete | Messaging E2EE working; Forum working; XP integrated |
| **Sprint 3.5** (UI Refinement) | ✅ Complete | ✅ Complete | Stance-based threading; design unification |
| **Sprint 4** (Agentic Foundation) | ⚪ Planning | ⚪ Not Started | Safety baseline + unified topics + analysis robustness (`docs/04-sprint-agentic-foundation.md`) |
| **Sprint 5** (Bridge + Docs) | ⚪ Planning | ⚪ Not Started | Docs updated for Civic Action Kit (facilitation model); no code yet (`docs/05-sprint-the-bridge.md`) |

---

## Docs vs. Code Alignment (Key Deltas)

| Doc / Spec | Intended State | Current Code State | Evidence |
|------------|----------------|--------------------|----------|
| Sprint 1 Core Bedrock | Attestation verifier validates Apple/Google chains | Stub logic (token prefix/length); no real chain validation | `services/attestation-verifier/src/main.rs:105-136` |
| Sprint 1 Core Bedrock | Contracts deployed to Sepolia/Base with verified sources | Deploy script exists; only localhost deployments committed | `packages/contracts/scripts/deploy-testnet.ts` + `packages/contracts/deployments/localhost.json` |
| AI_ENGINE_CONTRACT + Sprint 2 | Remote/local engines + policy routing (remote-first etc.) | EngineRouter exists, but worker uses mock local-only engine; no RemoteApiEngine/LocalMlEngine | `packages/ai-engine/src/engines.ts` + `packages/ai-engine/src/worker.ts` |
| Hero_Paths / Sentiment Spec | Constituency proofs + district aggregates | SentimentSignal emission requires constituency proof; no RegionProof generation or aggregates | `apps/web-pwa/src/hooks/useSentimentState.ts:76-100` |
| Sprint 5 Bridge Plan | Civic Action Kit facilitation (reports + native intents) | Bridge is stubbed; facilitation features not implemented | `services/bridge-stub/index.ts` + `docs/05-sprint-the-bridge.md` |
| Agentic Familiars (Delegation) | Delegation grants + OBO assertions | Not implemented | No familiar runtime or delegation types in app state |
| Participation Governors | Action/analysis budgets per principal | Not implemented | No per-nullifier budget counters |
| Unified Topics Model | Headlines ↔ threads share `topicId` + proposal threads | Not implemented | Thread schema lacks `topicId`/`proposal` extension |
| Topic Reanalysis Epochs | Frame/Reframe table updates after N posts via reanalysis | Not implemented | No reanalysis loop or digest types in app state |

---

## Outstanding Work (Post-Refactor TODOs)

The following tasks are required to align the codebase with the updated specs (agentic familiars, unified topics, participation governors).

### P0 — Identity & Delegation

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Define `FamiliarRecord`, `DelegationGrant`, `OnBehalfOfAssertion` types | `spec-identity-trust-constituency.md` §6 | `packages/types/src/index.ts`, `packages/data-model/` |
| Implement tiered scopes (Suggest/Act/High-Impact) with Tier 3 human-approval | `spec-identity-trust-constituency.md` §6 | New: `apps/web-pwa/src/hooks/useFamiliar.ts` |
| Implement delegation grant creation/revocation | `spec-identity-trust-constituency.md` §6 | New: familiar management UI + store |

### P0 — Participation Governors (Anti-Swarm Budgets)

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Add budget counter interface to XP ledger | `spec-xp-ledger-v0.md` §4 | `apps/web-pwa/src/store/xpLedger.ts` |
| Implement `canPerformAction(type)` budget check | `spec-xp-ledger-v0.md` §4 | `apps/web-pwa/src/store/xpLedger.ts` |
| Enforce budgets: posts/day=20, comments/day=50 | `spec-xp-ledger-v0.md` §4 | `apps/web-pwa/src/store/forum/index.ts` |
| Enforce budgets: sentiment_votes/day=200, governance_votes/day=20 | `spec-xp-ledger-v0.md` §4 | `useSentimentState.ts`, `useGovernance.ts` |
| Enforce budgets: analyses/day=25 (max 5/topic) | `canonical-analysis-v1.md` §4.2 | `packages/ai-engine/src/analysis.ts` |
| Enforce budgets: moderation/day=10, civic_actions/day=3, shares/day=10 | `spec-xp-ledger-v0.md` §4 | Various stores |

### P0 — Unified Topics Model

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Add `topicId`, `sourceUrl`, `urlHash`, `isHeadline` to Thread schema | `spec-hermes-forum-v0.md` §2.1 | `packages/data-model/src/schemas/hermes/forum.ts` |
| Add `THREAD_TOPIC_PREFIX = "thread:"` constant | `spec-hermes-forum-v0.md` §2.1.1 | `packages/data-model/src/schemas/hermes/forum.ts` |
| Implement `topicId` derivation (sha256 for threads, urlHash for URLs) | `spec-hermes-forum-v0.md` §2.1.1 | `apps/web-pwa/src/store/forum/helpers.ts` |
| Add `via?: 'human' \| 'familiar'` to Comment schema | `spec-hermes-forum-v0.md` §2.2 | `packages/data-model/src/schemas/hermes/forum.ts` |
| Add `proposal?: ProposalExtension` to Thread schema | `spec-hermes-forum-v0.md` §2.1 | `packages/data-model/src/schemas/hermes/forum.ts` |
| Unify Feed ↔ Forum: headlines and threads share topicId | `spec-hermes-forum-v0.md` §2.1.1 | `AnalysisFeed.tsx`, forum stores |

### P1 — Canonical Analysis v2 (Quorum Synthesis)

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Define `CandidateAnalysis`, `QuorumMeta`, `CanonicalAnalysisV2` types | `canonical-analysis-v2.md` §3 | `packages/data-model/src/schemas.ts` |
| Implement candidate gathering (N=5, timeout=24h) | `canonical-analysis-v2.md` §4.1 | `packages/ai-engine/src/analysis.ts` |
| Add verified-only candidate submission gate | `canonical-analysis-v2.md` §4.1 | `packages/ai-engine/src/analysis.ts` |
| Implement critique/refine mandate (candidates compare to prior analyses) | `canonical-analysis-v2.md` §4.1 | `packages/ai-engine/src/prompts.ts` |
| Implement synthesis engine (candidates → synthesis + divergence) | `canonical-analysis-v2.md` §4.2 | New: `packages/ai-engine/src/synthesis.ts` |
| Wire real AI engine (WebLLM or consented remote) | `AI_ENGINE_CONTRACT.md` | `packages/ai-engine/src/worker.ts` |

### P1 — Comment-Driven Re-Synthesis

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Track verified comment count per topic since last synthesis | `canonical-analysis-v2.md` §4.3 | `apps/web-pwa/src/store/forum/index.ts` |
| Track unique verified principals per topic | `canonical-analysis-v2.md` §4.3 | `apps/web-pwa/src/store/forum/index.ts` |
| Implement re-synthesis trigger (N=10 comments, 3 unique principals) | `canonical-analysis-v2.md` §4.3 | New: re-synthesis hook or store action |
| Implement debounce (30 min) and daily cap (4/topic) | `canonical-analysis-v2.md` §4.3 | Re-synthesis store |
| Generate topic digest for re-analysis input | `Hero_Paths.md` | New: digest builder |

### P2 — Agentic Guardrails

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Implement deny-by-default tool access for familiars | `ARCHITECTURE_LOCK.md` §1.1 | Familiar runtime |
| Add E2E mock for familiar orchestration (`VITE_E2E_MODE`) | `ARCHITECTURE_LOCK.md` §2.2 | Vite config, mock stores |
| Implement prompt injection defenses (treat content as hostile) | `ARCHITECTURE_LOCK.md` §1.1 | Familiar runtime |

---

## Detailed Status by Subsystem

### LUMA (Identity Layer)

**Status:** 🔴 **Stubbed** — Development placeholder only

| Feature | Whitepaper | Implementation | Evidence |
|---------|------------|----------------|----------|
| Hardware TEE binding | ✅ Specified | ❌ Not implemented | No Secure Enclave/StrongBox code |
| VIO liveness detection | ✅ Specified | ❌ Not implemented | No sensor fusion code |
| BioKey hardware | ✅ Specified | ❌ Not implemented | No hardware integration |
| Trust score calculation | ✅ Specified | ⚠️ Stub logic | `main.rs:105-116` — token length/prefix checks |
| Nullifier derivation | ✅ Specified | ⚠️ Device-bound | `main.rs:162` — SHA256(device_key + salt) |
| Identity storage | Secure | ✅ Encrypted vault (`vh-vault`/`vault`) + in-memory identity provider | `apps/web-pwa/src/hooks/useIdentity.ts` + `packages/identity-vault/src/*` |
| Sybil resistance | ✅ Specified | ❌ Not implemented | No uniqueness checking |
| Social recovery | ✅ Specified | ❌ Not implemented | No Lazarus Protocol code |
| Multi-device linking | ✅ Specified | ⚠️ Local-only stub | `useIdentity.ts:174+` (local record updates only) |

**Current Trust Score Logic:**
```rust
// services/attestation-verifier/src/main.rs:105-116
fn verify_web(payload, mock_mode) -> f32 {
    if mock_mode || token == "test-token" { return 1.0; }
    if token.len() > 8 { 0.8 } else { 0.0 }
}
// iOS: 1.0 if starts with "apple-", else 0.5
// Android: 1.0 if starts with "google-", else 0.5
```

**⚠️ WARNING:** Current identity layer provides no real sybil defense. Do not use for production governance or economics.

---

### Agentic Familiars (Delegation)

**Status:** ⚪ **Planned** — Not implemented

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Delegation grants / OBO assertions | ❌ Not implemented | No delegation types in app state |
| Familiar runtime modes (suggest/act/high-impact) | ❌ Not implemented | No familiar orchestration layer |
| Action/compute budgets per nullifier | ❌ Not implemented | No per-nullifier budget counters |

**Invariant:** Familiars inherit the principal’s trust gate and budgets; they never add influence.

---

### GWC (Economics Layer)

**Status:** 🟡 **Contracts Implemented, Undeployed to Public Testnet**

| Feature | Contract | Tests | Deployed |
|---------|----------|-------|----------|
| RVU Token (ERC-20) | ✅ `RVU.sol` | ✅ | ⚠️ Localhost only |
| UBE Distribution | ✅ `UBE.sol` | ✅ | ❌ Not deployed |
| Quadratic Funding | ✅ `QuadraticFunding.sol` | ✅ | ❌ Not deployed |
| Median Oracle | ✅ `MedianOracle.sol` | ✅ | ⚠️ Localhost only |
| Faucet | ✅ `Faucet.sol` | ✅ | ❌ Not deployed |

**Deployment Artifacts:**
```
packages/contracts/deployments/
└── localhost.json  ← Only deployment (RVU + MedianOracle)
```
- `deployments/localhost.json` — ✅ Exists (deployed 2025-11-21)
- `deployments/sepolia.json` — ❌ Not committed
- `deploy-testnet.ts` — ✅ Script exists (supports Sepolia, Base Sepolia)

**Sprint 1 Gap:** Testnet deployment was listed as a goal but never completed. Script exists, artifact does not.

**XP Ledger:**
- Implementation: ✅ Complete (`store/xpLedger.ts`)
- Tests: ✅ Comprehensive (caps, tracks, per-nullifier isolation)
- Storage: localStorage `vh_xp_ledger` (per-nullifier)
- Integration: ✅ Wired to Messaging (socialXP), Forum (civicXP), Governance (projectXP)

**Attestor Bridge:**
- Implementation: ⚠️ Stub only (`services/bridge-stub/index.ts` logs payload, no on-chain writes)
- Spec: `docs/spec-attestor-bridge-v0.md`
- Purpose: SessionResponse (trustScore, nullifier) → on-chain registration (UBE, Faucet, QF)

**Frontend Governance (Season 0):**
- Proposals: ✅ Seeded locally (`seedProposals`) — legacy Proposal objects; migration to proposal-threads pending
- Legacy ProposalSchema: ⚠️ Deprecated — do not build new features against it; use thread `proposal` extension
- Voting: ✅ Local-only (localStorage `vh_governance_votes`) — to be wired to proposal-threads
- On-chain QF: ❌ Not exposed to public users (curators/dev accounts only)

**⚠️ WARNING:** Do not enable UBE claiming until identity layer provides sybil resistance.

---

### VENN (Canonical Analysis Layer)

**Status:** 🟡 **Pipeline Exists, AI Mocked**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Prompt builder | ✅ Implemented | `prompts.ts` — `buildPrompt(articleText)` with GOALS/GUIDELINES |
| Response parser | ✅ Implemented | `schema.ts` — `parseAnalysisResponse()` handles wrapped + bare JSON |
| Schema validation | ✅ Implemented | `schema.ts` — `AnalysisResultSchema` + `CanonicalAnalysisSchema` (Zod) |
| Hallucination guardrails | ✅ Implemented | `validation.ts` — `validateAnalysisAgainstSource()` |
| First-to-file lookup | ✅ Implemented | `analysis.ts:30-48` — `getOrGenerate()` |
| Engine router | ✅ Implemented | `engines.ts` — `EngineRouter` supports all policy modes |
| AI engine (WebLLM) | ❌ Not integrated | Interface exists, no `LocalMlEngine` wired |
| AI engine (Remote) | ❌ Not wired | Interface exists, no `RemoteApiEngine` wired |
| Mock engine | ⚠️ Active | `worker.ts:6-23` — hardcoded mock response |

**Sprint 2 AI Engine Contract Status:**
- ✅ `AI_ENGINE_CONTRACT.md` spec written
- ✅ `EnginePolicy` types defined (`remote-first`, `local-first`, etc.)
- ✅ `EngineRouter` class implemented with fallback logic
- ✅ Tests cover policy behaviors and fallbacks
- ❌ **No real engine is wired** — `worker.ts` uses `mockEngine` with `'local-only'` policy

**Current AI Output (mocked):**
```typescript
// packages/ai-engine/src/worker.ts:6-23
const mockEngine = {
  name: 'mock-engine',
  kind: 'local' as const,
  generate: async () => JSON.stringify({
    final_refined: {
      summary: 'Mock summary',
      bias_claim_quote: ['quote'],
      justify_bias_claim: ['justification'],
      biases: ['bias'],
      counterpoints: ['counter'],
      sentimentScore: 0.5,
      confidence: 0.9
    }
  })
};
const router = new EngineRouter(mockEngine, undefined, 'local-only');
```

**Civic Signals:**
- Eye (read tracking): ✅ Implemented, local-only
- Lightbulb (engagement): ✅ Implemented, local-only
- Sentiment (agreement): ✅ Implemented, local-only
- Mesh aggregation: ❌ Not implemented

**Constituency Proofs:**
- SentimentSignal emission requires `constituency_proof` and currently short-circuits without it.
- No RegionProof generation or district aggregation is implemented.

**First-to-File Limitations (v1 → v2 Direction):**
- Current (v1): First analysis is immutable, vulnerable to poisoning
- Risk: Single attacker can publish misleading canonical analysis
- Planned (v2): Quorum synthesis — first N analyses compared + synthesized
- v2 will add challenge/supersession path; v1 records remain immutable
- Defaults (v2): N=5, timeout=24h, challenge=7d
- See `docs/canonical-analysis-v2.md` for quorum synthesis contract

**v2 Implementation Gaps:**

| Feature | Spec | Status |
|---------|------|--------|
| `CandidateAnalysis` type | `canonical-analysis-v2.md` §3 | ❌ Missing |
| Candidate gathering (N=5, timeout=24h) | `canonical-analysis-v2.md` §4.1 | ❌ Missing |
| Verified-only candidate submission | `canonical-analysis-v2.md` §4.1 | ❌ Missing |
| Critique/refine prior analyses | `canonical-analysis-v2.md` §4.1 | ❌ Missing |
| Synthesis engine (divergence table) | `canonical-analysis-v2.md` §4.2 | ❌ Missing |
| Comment-driven re-synthesis | `canonical-analysis-v2.md` §4.3 | ❌ Missing |
| Per-principal analysis budget (25/day, 5/topic) | `spec-xp-ledger-v0.md` §4 | ❌ Missing |

---

### HERMES (Communication Layer)

#### Messaging

**Status:** 🟢 **Implemented**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| E2EE encryption | ✅ SEA shared secret | `hermesCrypto.ts:4` |
| Gun sync | ✅ Real integration | `hermesAdapters.ts` |
| Topology guard | ✅ Enforced | `topology.ts:55` |
| XP integration | ✅ Complete | `xpLedger.ts` |
| Trust gating | ⚠️ Forum-only | Forum checks trustScore ≥ 0.5; chat does not |

**Dependencies:** Messaging assumes a valid identity/session; current attestation is stubbed (see LUMA).

#### Forum

**Status:** 🟢 **Implemented** (core features); 🟡 **Unified Topics pending**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Threaded comments | ✅ Complete | `CommentStream.tsx` |
| Stance-based threading | ✅ Complete | concur/counter/discuss |
| Voting | ✅ Complete | `VoteControl.tsx` |
| Gun sync | ✅ Real integration | `forumAdapters.ts` |
| XP integration | ✅ Complete | thread/comment/quality XP |
| `topicId` field | ❌ Missing | Thread schema lacks unified topic key |
| `via` field on Comment | ❌ Missing | No familiar provenance tracking |
| Unified Feed ↔ Forum | ❌ Missing | Uses `sourceAnalysisId`, not shared `topicId` |

**Gap:** Spec requires shared `topicId` (urlHash for URLs, sha256 for native threads).

#### Docs (Collaborative)

**Status:** ⚪ **Planned**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Doc schema | ❌ Not implemented | — |
| CRDT provider | ❌ Not implemented | — |
| Docs store | ❌ Not implemented | — |

#### Bridge (Civic Action Kit)

**Status:** ⚪ **Planned/Stub** — Redesign in progress toward facilitation model

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Report generator (PDF) | ❌ Not implemented | — |
| Native intents (email/phone/share) | ❌ Not implemented | — |
| Contact directory | ❌ Not implemented | — |
| Receipt storage | ❌ Not implemented | — |
| Legacy automation stub | ⚠️ Stub only | `services/bridge-stub/index.ts:1` |

**Planned Redesign:** Facilitation model (PDF reports + contact directory + native intents), not automated form submission.  
**Spec:** `docs/spec-civic-action-kit-v0.md` (canonical)

---

## Known Gaps vs. Whitepapers

| Whitepaper Claim | Current Reality |
|------------------|-----------------|
| "Hardware Root of Trust" (LUMA) | Encrypted vault + in-memory provider are in place, but no TEE integration yet |
| "VIO liveness detection" (LUMA) | Not implemented |
| "Holographic vectors" (LUMA) | Not implemented |
| "Mathematically private" (LUMA) | Device-bound nullifier, not human-bound |
| "BMR compliance" (GWC) | No compliance implementation |
| "Local AI inference" (VENN) | Mock engine, no WebLLM |
| "Sovereign Delivery" (HERMES) | Redesigning as facilitation (Civic Action Kit) |

**⚠️ Whitepapers describe target architecture, not current implementation.**

---

## Security Considerations

### Current Risks (Code-Verified)

| Risk | Severity | Status | Evidence |
|------|----------|--------|----------|
| No sybil defense | 🔴 High | Open | `main.rs:162` (device-only nullifier) |
| Trust scores spoofable | 🔴 High | Open | `main.rs:105-116` |
| AI analysis mocked | 🟡 Medium | Open | `worker.ts:6-23` |
| First-to-file poisoning | 🟡 Medium | Open | `analysis.ts:30-48` (no supersession) |

### Mitigations in Place

- ✅ **Resolved (PR #10):** identity is no longer persisted in localStorage; encrypted IndexedDB vault is authoritative, with migration-only legacy key handling.
- ✅ **Resolved (PR #10):** identity publish event leak removed (`vh:identity-published` carries no identity payload).
- ✅ **Resolved (PR #10):** master-key initialization race hardened via atomic IndexedDB `add` flow.
- ✅ **Resolved (PR #10):** migration clobber guard prevents stale legacy identity from overwriting existing vault state.
- ✅ Topology guard prevents unauthorized Gun writes
- ✅ Encryption required for sensitive mesh paths
- ✅ XP ledger is local-only (no off-device leak)
- ✅ Civic signals stay local, only aggregates planned for mesh
- ⚠️ Constituency proofs are required for SentimentSignal emission; currently missing in app state

---

## Test Coverage

**Repo-wide (Vitest `pnpm test:quick`):** 64 test files, 390 tests (unit + component + integration). Coverage: **100%** statements / branches / functions / lines.

---

## Deployment Status

| Environment | Status | Artifacts |
|-------------|--------|-----------|
| Localhost (Anvil) | ✅ Working | `deployments/localhost.json` |
| Sepolia Testnet | ❌ Not deployed | Script exists: `deploy-testnet.ts` |
| Base Sepolia | ❌ Not deployed | Script exists |
| Mainnet | ❌ Not planned | — |

---

## Roadmap to Production-Ready

### Immediate Blockers (Must Fix)

| Blocker | Severity | Sprint Gap | Fix |
|---------|----------|------------|-----|
| AI engine mocked | 🔴 High | Sprint 2 | Wire WebLLM or consented remote API |
| Testnet undeployed | 🟡 Medium | Sprint 1 | Run `deploy-testnet.ts` to Sepolia |
| Attestation is stub | 🟡 Medium | Sprint 1 | Label as DEV ONLY or implement real validation |
| No sybil defense | 🔴 High | N/A (LUMA gap) | Research pragmatic uniqueness checking |

### Phase 1: Complete Sprint Gaps (Immediate)

- [ ] **Deploy contracts to Sepolia** — Run existing `deploy-testnet.ts`, commit artifact
- [ ] **Integrate real AI engine** — Wire WebLLM (local) or add consent flow for remote API
- [ ] **Label attestation as DEV ONLY** — Prevent false security assumptions
- [ ] **Add beta warnings to UI** — Prominent disclaimers on analyses/governance

### Phase 2: Security Hardening (30 days)

- [x] Move identity persistence from localStorage to encrypted IndexedDB vault (`vh-vault`/`vault`) — completed in PR #10 (`813558c`), including DOM event leak removal, master-key race hardening, and migration clobber guard.
- [ ] Implement first-N quorum canonicalization (supersession for poisoned analyses)
- [ ] Add cohort thresholds for any aggregate display (N≥20)

### Phase 3: Bridge Redesign (Sprint 5)

- [ ] Redesign as facilitation model (PDF reports + contact directory + native intents)
- [ ] Remove automation language from documentation
- [ ] Legal review before any form automation
- [ ] Add representative contact database (public data)

### Phase 4: Identity Strengthening (90 days)

- [ ] Research pragmatic sybil defense (federated attestation, social vouching)
- [ ] Implement basic uniqueness checking (even if centralized initially)
- [ ] Design hardware attestation integration path (Secure Enclave, StrongBox)

---

## How to Interpret This Document

- **🟢 Implemented** — Feature works and is tested
- **🟡 Partial** — Feature exists but has significant gaps
- **🔴 Stubbed** — Placeholder code only, not functional
- **⚪ Planned** — Design exists, no implementation
- **❌ Not implemented** — No code exists

---

## References

### Architecture & Vision
- `System_Architecture.md` — Target architecture (partially implemented)
- `docs/LUMA_BriefWhitePaper.md` — Identity vision (mostly aspirational)
- `docs/GWC_BriefWhitePaper.md` — Economics vision (contracts implemented, undeployed)
- `docs/ARCHITECTURE_LOCK.md` — Non-negotiable engineering guardrails (enforced)

### Canonical Specs
- `docs/canonical-analysis-v1.md` — Analysis schema contract (implemented)
- `docs/canonical-analysis-v2.md` — Quorum synthesis contract (planned)
- `docs/AI_ENGINE_CONTRACT.md` — AI engine pipeline contract (pipeline implemented, engine mocked)
- `docs/spec-civic-sentiment.md` — Eye/Lightbulb/Sentiment spec (implemented locally)
- `docs/spec-xp-ledger-v0.md` — XP ledger spec (fully implemented)
- `docs/spec-identity-trust-constituency.md` — Identity contract (partially implemented)
- `docs/spec-rvu-economics-v0.md` — RVU/UBE/QF economics (contracts ready, undeployed)
- `docs/spec-data-topology-privacy-v0.md` — Data placement rules (implemented)
- `docs/spec-hermes-messaging-v0.md` — Messaging spec (implemented)
- `docs/spec-hermes-forum-v0.md` — Forum spec (implemented)

### Sprint Documentation
- `docs/archive/00-sprint-0-foundation.md` — ✅ Complete
- `docs/archive/01-sprint-1-core-bedrock.md` — ⚠️ 90% (testnet gap)
- `docs/02-sprint-2-advanced-features.md` — ⚠️ 85% (AI engine gap)
- `docs/03-sprint-3-the-agora.md` — ✅ Complete
- `docs/03.5-sprint-3.5-ui-refinement.md` — ✅ Complete
- `docs/04-sprint-agentic-foundation.md` — ⚪ Planning (not started)
- `docs/05-sprint-the-bridge.md` — ⚪ Planning (not started)

### Developer Resources
- `CONTRIBUTING.md` — Engineering standards (enforced)
- `docs/Hero_Paths.md` — Canonical user journeys
- `docs/MANUAL_TEST_CHECKLIST_SPRINT3.md` — Manual testing guide
