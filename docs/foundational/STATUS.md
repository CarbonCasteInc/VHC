# TRINITY Implementation Status

**Last Updated:** 2026-02-14
**Version:** 0.7.0 (Wave 4 Complete — LUMA Trust Constants, Session Lifecycle, Constituency Proof Verification)
**Assessment:** Pre-production prototype, Wave 4 complete and merged to main (LUMA identity hardening). All integration branches merged.

> ⚠️ **This document reflects actual implementation status, not target architecture.**
> For the full vision, see `System_Architecture.md` and whitepapers in `docs/`.

---

## Quick Summary

| Layer | Status | Production-Ready |
|-------|--------|------------------|
| **LUMA (Identity)** | 🟡 Hardened (trust constants, session lifecycle, constituency proof — flag-gated) | ❌ No |
| **GWC (Economics)** | 🟡 Contracts ready, Sepolia deployed | ⚠️ Partial |
| **VENN (Analysis)** | 🟡 Pipeline end-to-end, V2 synthesis + re-synthesis + feed-enriched TopicCard | ❌ No |
| **HERMES Messaging** | 🟢 Implemented | ⚠️ Partial |
| **HERMES Forum** | 🟢 Implemented + 240-char reply cap + article CTA | ⚠️ Partial |
| **HERMES Docs** | 🟢 Foundation + CollabEditor wired into ArticleEditor (flag-gated) | ❌ No |
| **HERMES Bridge (Civic Action Kit)** | 🟡 Full UI (5 components), trust/XP/budget enforcement, receipt-in-feed | ❌ No |
| **News Aggregator** | 🟢 Implemented (ingest/normalize/cluster/provenance) | ⚠️ Partial |
| **Discovery Feed** | 🟢 Implemented (shell/cards/ranking/wiring) + synthesis-enriched TopicCard | ⚠️ Partial |
| **Delegation Runtime** | 🟢 Store + hooks + control panel + 8/8 budget keys (all wired or deferred-with-rationale) | ⚠️ Partial |
| **Linked-Social** | 🟡 Substrate + notification ingestion + feed cards | ⚠️ Partial |

---

## Wave 2 Landed Capabilities (2026-02-13)

Wave 2 delivered the following features across 3 workstreams and 36 PRs to `integration/wave-2`, merged to `main` via Policy 15 sync PRs (#218, #221).

### W2-Alpha — Comment-Driven Re-synthesis (PRs #192, #197, #199, #202)
- `CommentTracker` module: per-topic verified comment counting with epoch-aware state (`commentTracker.ts`)
- `DigestBuilder`: rolling `TopicDigestInput` construction from comment activity (`digestBuilder.ts` — W2A-2)
- Re-synthesis trigger wiring: comment count threshold → epoch scheduler trigger, forum comment integration (`resynthesisWiring.ts`)
- Full test coverage on all touched modules

### W2-Beta Stage 1 — Reply-to-Article + Docs MVP (PRs #190, #198, #201)
- `ForumPost` and `HermesDocs` Zod schemas + `docsAdapters` for Gun mesh sync
- 240-character reply cap enforcement in `CommentComposer`
- "Convert to Article" CTA when reply exceeds cap
- `hermesDocs` Zustand store with CRUD, flag-gated via `VITE_HERMES_DOCS_ENABLED`
- `ArticleEditor` (draft/edit) and `ArticleViewer` (read) components
- `ArticleFeedCard` integrated into discovery feed under `ARTICLE` feed kind

### W2-Beta Stage 2 — Collaborative Docs Foundation (PRs #214, #217, #219, #220)
- `@vh/crdt` package: Yjs provider, `AwarenessAdapter`, dedup module for CRDT sync
- Document key management: `deriveDocumentKey`, `shareDocumentKey`, `receiveDocumentKey`, `encryptDocContent`, `decryptDocContent` (`docsKeyManagement.ts`)
- `CollabEditor` component: TipTap + Yjs binding, lazy-loaded (229 LOC)
- `PresenceBar` component: collaborator cursor/presence indicators via AwarenessAdapter (66 LOC)
- `ShareModal` component: collaborator add/remove, role selection, trust threshold checks (261 LOC)
- `hermesDocsCollab` store: collab runtime state, auto-save (5s encrypted), offline pending indicator
- `hermesDocsAccess` store: pure access control functions (`getAccessLevel`, `canEdit`, `canView`, `canShare`, `canDelete`)
- Document key localStorage persistence (`vh_docs_keys:<nullifier>`)
- Feature flags: `VITE_HERMES_DOCS_ENABLED` + `VITE_DOCS_COLLAB_ENABLED` gate collab runtime
- E2E bypass: `VITE_E2E_MODE=true` → `MockGunYjsProvider` (no Yjs/Gun init)
- 204 new tests, 100% line+branch coverage on all touched modules

> **Note:** Stage 2 is foundation-only. `CollabEditor` is built and tested but NOT wired into the active `ArticleEditor` path. Runtime wiring is Wave 3 scope (see `WAVE3_CARRYOVER.md`).

### W2-Gamma Phase 1 — Linked-Social Substrate (PR #207)
- Schema convergence: `LinkedSocialAccount` and `SocialNotification` with strict Zod validation
- Vault token substrate: `OAuthTokenRecord` with vault-only storage enforcement
- Notification ingestion pipeline with sanitization

### W2-Gamma Phase 2 — Elevation Artifacts + Budget Gates (PR #209)
- Elevation schema tightening with Zod validation
- Artifact generators: `BriefDoc`, `ProposalScaffold`, `TalkingPoints`
- `civic_actions/day` budget gate enforcement (budget key #7 of 8 now active)
- Trust threshold checks for elevation nominations

### W2-Gamma Phase 3 — Social Feed Wiring (PR #211)
- `SocialNotificationCard` real-data rendering (replaces mock)
- `socialFeedAdapter`: notification → feed item mapping with dismiss/seen state
- Feed integration: social notifications in `Social` surface and `All` feed

### Wave 2 Governance Infrastructure (20 coord/* PRs)
- CE dual-review contracts codified and enforced for all execution dispatches
- Ownership map expanded for all 3 workstreams (glob patterns per Policy 2)
- Wave 2 delta contract: 16 binding policies defined and enforced
- Policy 4 exception documented (serialized merge fallback)
- Policy 14 repo migration parity verified post-transfer
- Policy 15 periodic sync enforced (PRs #218, #221)
- Context rotation guard enforced (Policy 13)

---

## Wave 2 Deferred Items (CEO Decision 2026-02-13)

The following items were explicitly deferred to Wave 3 by CEO decision:

| Item | Reason | Carryover Doc |
|------|--------|---------------|
| W2-Gamma Phase 4 (receipt-in-feed) | DeliveryReceipt schema needs spec work; additive to landed foundation | `WAVE3_CARRYOVER.md` |
| SoT F: Rep directory + native intents | CAK foundation landed; full delivery pipeline is Wave 3 priority | `WAVE3_CARRYOVER.md` |
| CollabEditor runtime wiring | Foundation built and tested; wiring into ArticleEditor path deferred | `WAVE3_CARRYOVER.md` |

---

## Feature Flags

| Flag | Purpose | Default | Wave |
|------|---------|---------|------|
| `VITE_FEED_V2_ENABLED` | Gates discovery feed v2 UI | `false` | 1 |
| `VITE_TOPIC_SYNTHESIS_V2_ENABLED` | Gates synthesis v2 hooks | `false` | 1 |
| `VITE_HERMES_DOCS_ENABLED` | Gates HERMES Docs store + article editor | `false` | 2 |
| `VITE_DOCS_COLLAB_ENABLED` | Gates collaborative editing runtime | `false` | 2 |
| `VITE_LINKED_SOCIAL_ENABLED` | Gates linked-social notification pipeline | `false` | 2 |
| `VITE_ELEVATION_ENABLED` | Gates elevation artifact generation | `false` | 2 |
| `VITE_E2E_MODE` | Deterministic bypass of heavy I/O init (Gun/Yjs) | `false` | 1 |
| `VITE_REMOTE_ENGINE_URL` | Enables remote AI engine opt-in | empty | 1 |
| `VITE_SESSION_LIFECYCLE_ENABLED` | Gates session expiry/near-expiry checks + forum freshness | `false` | 4 |
| `VITE_CONSTITUENCY_PROOF_REAL` | Gates constituency proof verification enforcement | `false` | 4 |

All features through Wave 4 are flag-gated. Default false. Legacy behavior preserved when flags are off.

---

## Product Direction Deltas (A-G)

| Direction Delta | Target (Ship Snapshot) | Current Implementation |
|---|---|---|
| A. V2-first synthesis | `TopicSynthesisV2` (quorum + epochs + divergence) is canonical | ✅ Types, candidate gatherer, quorum engine, epoch scheduler, store, Gun adapters (Wave 1) + re-synthesis triggers, comment tracking, digest builder (Wave 2 Alpha) |
| B. 3-surface feed | Feed mixes `News`, `Topics`, and `Linked-Social Notifications` | ✅ Discovery feed shell with all three card types + real social notification wiring (Wave 1 + Wave 2 Gamma P3) |
| C. Elevation loop | Nomination thresholds produce BriefDoc + ProposalScaffold + TalkingPoints + rep forwarding | 🟡 Elevation schema + artifact generators + budget gates landed (Wave 2 Gamma P2); receipt-in-feed deferred to Wave 3 |
| D. Thread + longform rules | Reddit-like sorting, 240-char replies, overflow to Docs article | ✅ Forum sorting + 240-char reply cap + Convert-to-Article CTA + ArticleFeedCard (Wave 2 Beta S1) |
| E. Collaborative docs | Multi-author encrypted docs, draft-to-publish workflow | 🟡 Full foundation: CRDT/Yjs, E2EE key management, collab editor, presence, sharing, access control (Wave 2 Beta S2); runtime wiring into ArticleEditor deferred to Wave 3 |
| F. Civic signal → value rails | Eye/Lightbulb capture thought-effort; aggregate civic signal drives future REL/AU | 🟡 Budget guards (7/8 keys active), elevation artifacts landed; rep directory + native intents deferred to Wave 3 |
| G. Provider switching + consent | Default local WebLLM; remote providers opt-in with cost/privacy clarity | ✅ Local default path wired; remote engine opt-in with local-first policy; provider consent UI in place |

---

## Test & Coverage Truth

**Gate verification date:** 2026-02-15
**Branch verified:** `main` at `31fce88` (Wave 4 merged via PR #253)

| Gate | Result | Detail |
|------|--------|--------|
| `pnpm typecheck` | ✅ PASS | All workspace projects |
| `pnpm lint` | ✅ PASS | All workspace projects |
| `pnpm test` | ✅ PASS | 2557+ tests (49 new in Wave 4, including coverage gap fixes) |
| `pnpm test:e2e` | ✅ PASS | E2E tests passed (CI run 22024258084) |
| `pnpm bundle:check` | ✅ PASS | Under 1 MiB limit |
| `pnpm deps:check` | ✅ PASS | Zero circular dependencies |
| Feature-flag variants | ✅ PASS | All ON/OFF combinations pass |

**Coverage:** 100% line+branch on all Wave 4 modules (diff-aware gate, 483/483 branches on merge PR #253).

---

## Sprint Completion Status

| Sprint | Status | Key Outcomes |
|--------|--------|-------------|
| **Sprint 0** (Foundation) | ✅ Complete | Monorepo, CLI, CI, core packages |
| **Sprint 1** (Core Bedrock) | ⚠️ 90% | Encrypted vault, identity types, contracts; Sepolia deployed; attestation hardened but not production-grade |
| **Sprint 2** (Civic Nervous System) | ✅ Complete | Full analysis pipeline, LocalMlEngine default, RemoteApiEngine opt-in |
| **Sprint 3** (Communication) | ✅ Complete | E2EE messaging, forum with stance-threading, XP integration |
| **Sprint 3.5** (UI Refinement) | ✅ Complete | Stance-based threading, design unification |
| **Sprint 4** (Agentic Foundation) | ✅ Complete | Delegation types + store + control panel; participation governors; budget denial UX |
| **Wave 1** (V2 Features) | ✅ Complete | Synthesis pipeline/store, news aggregator/store, discovery feed/cards, delegation runtime, bridge/attestor wiring |
| **Wave 2** (Integration Features) | ✅ Complete | Re-synthesis triggers, collaborative docs foundation, elevation artifacts, linked-social substrate, social feed wiring |
| **Wave 3** (CAK + Collab + LUMA Spec) | ✅ Complete | CAK Phase 3 UI, collab editor wiring, feature flags, budget boundary, synthesis feed, LUMA identity spec v0.2 (13 PRs: #229–#242) |
| **Wave 4** (LUMA Identity Hardening) | ✅ Complete | Trust constants consolidation, session lifecycle, constituency proof verification — all flag-gated (8 PRs: #243–#250) |

---

## Detailed Status by Subsystem

### LUMA (Identity Layer)

**Status:** 🟡 **Hardened (Flag-Gated)** — Trust constants, session lifecycle, constituency proof verification

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Trust constants | ✅ Centralized | `packages/data-model/src/constants/trust.ts` — TRUST_MINIMUM (0.5), TRUST_ELEVATED (0.7) |
| Session lifecycle | ✅ Feature-flagged | `packages/types/src/session-lifecycle.ts` — expiry, near-expiry, migration (`VITE_SESSION_LIFECYCLE_ENABLED`) |
| Constituency proof verification | ✅ Feature-flagged | `packages/types/src/constituency-verification.ts` — nullifier/district/freshness checks (`VITE_CONSTITUENCY_PROOF_REAL`) |
| Session revocation | ✅ Active (no flag) | `useIdentity.ts` — `revokeSession()` clears identity + proof state |
| Hardware TEE binding | ❌ Not implemented | No Secure Enclave/StrongBox code (Season 0 deferred §9.2) |
| VIO liveness detection | ❌ Not implemented | No sensor fusion code (Season 0 deferred §9.2) |
| Trust score calculation | ⚠️ Hardened stub | `main.rs` — structured validation, rate limiting; no real chain validation |
| Nullifier derivation | ⚠️ Device-bound | SHA256(device_key + salt) |
| Identity storage | ✅ Encrypted vault | `identity-vault` package (IndexedDB) |
| Sybil resistance | ❌ Not implemented | No uniqueness checking (Season 0 deferred §9.2) |

**⚠️ WARNING:** Current identity layer provides hardened stubs with feature-gated enforcement. Both flags default to `false`. Real sybil defense requires TEE + VIO (post-Season 0).

---

### Agentic Familiars (Delegation)

**Status:** 🟡 **Store + Hooks + UI Landed** — Full runtime orchestration pending

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Delegation store (grants/revocation) | ✅ Landed | `store/delegation/index.ts` |
| Persistence (safeStorage) | ✅ Landed | `store/delegation/persistence.ts` |
| `useFamiliar` hook | ✅ Landed | `store/delegation/useFamiliar.test.ts` |
| FamiliarControlPanel UI | ✅ Landed | `components/hermes/FamiliarControlPanel.tsx` |
| Delegation utility functions | ✅ Landed | `packages/types/src/delegation-utils.ts` |
| Budget enforcement (7/8 keys) | ✅ Wired | posts, comments, governance/sentiment votes, analyses, shares, civic_actions |
| Full familiar orchestration | ❌ Not implemented | No autonomous agent loop |

---

### GWC (Economics Layer)

**Status:** 🟡 **Contracts Implemented, Sepolia Deployed**

| Feature | Contract | Tests | Deployed |
|---------|----------|-------|----------|
| RVU Token (ERC-20) | ✅ `RVU.sol` | ✅ | ⚠️ Localhost + Sepolia |
| UBE Distribution | ✅ `UBE.sol` | ✅ | ❌ Not deployed |
| Quadratic Funding | ✅ `QuadraticFunding.sol` | ✅ | ❌ Not deployed |
| Median Oracle | ✅ `MedianOracle.sol` | ✅ | ⚠️ Localhost + Sepolia |
| Faucet | ✅ `Faucet.sol` | ✅ | ❌ Not deployed |

---

### VENN (Canonical Analysis Layer)

**Status:** 🟡 **Pipeline End-to-End, V2 Synthesis + Re-synthesis Landed**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Analysis pipeline (v1) | ✅ End-to-end | `pipeline.ts` |
| `LocalMlEngine` (WebLLM) | ✅ Default in non-E2E | `localMlEngine.ts` |
| `RemoteApiEngine` (opt-in) | ✅ Wired | `remoteApiEngine.ts` |
| Synthesis types (v2) | ✅ Landed | `synthesisTypes.ts` |
| Candidate gatherer | ✅ Landed | `candidateGatherer.ts` |
| Quorum engine | ✅ Landed | `quorum.ts` |
| Epoch scheduler | ✅ Landed | `epochScheduler.ts` |
| Synthesis store | ✅ Landed | `store/synthesis/` |
| Gun synthesis adapters | ✅ Landed | `synthesisAdapters.ts` |
| Comment tracker (W2) | ✅ Landed | `commentTracker.ts` |
| Digest builder (W2) | ✅ Landed | `digestBuilder.ts` |
| Re-synthesis triggers (W2) | ✅ Landed | `resynthesisWiring.ts` |

---

### HERMES (Communication Layer)

#### Messaging — 🟢 Implemented

| Feature | Status |
|---------|--------|
| E2EE encryption (SEA) | ✅ |
| Gun sync | ✅ |
| Topology guard | ✅ |
| XP integration | ✅ |

#### Forum — 🟢 Implemented + Reply Cap + Article CTA

| Feature | Status |
|---------|--------|
| Threaded comments (stance-based) | ✅ |
| 240-char reply cap enforcement | ✅ (Wave 2) |
| Convert-to-Article CTA | ✅ (Wave 2) |
| `topicId`/`sourceUrl`/`urlHash`/`isHeadline` | ✅ |
| Feed↔Forum integration | ✅ |
| Proposal extension on threads | ✅ |

#### Docs — 🟡 Foundation Complete, Runtime Wiring Pending

| Feature | Status |
|---------|--------|
| hermesDocs store (CRUD) | ✅ (Wave 2 S1) |
| ArticleEditor + ArticleViewer | ✅ (Wave 2 S1) |
| ArticleFeedCard in discovery feed | ✅ (Wave 2 S1) |
| CRDT/Yjs provider + dedup | ✅ (Wave 2 S2) |
| Document key management (E2EE) | ✅ (Wave 2 S2) |
| CollabEditor (TipTap + Yjs) | ✅ Foundation (Wave 2 S2) |
| PresenceBar (awareness) | ✅ Foundation (Wave 2 S2) |
| ShareModal (access control) | ✅ Foundation (Wave 2 S2) |
| hermesDocsCollab store | ✅ Foundation (Wave 2 S2) |
| hermesDocsAccess functions | ✅ Foundation (Wave 2 S2) |
| CollabEditor wired into ArticleEditor | ❌ Wave 3 |

#### Bridge (Civic Action Kit) — 🟡 Elevation Landed

| Feature | Status |
|---------|--------|
| Attestation verifier (hardened) | ✅ |
| Elevation artifact generators | ✅ (Wave 2) |
| civic_actions/day budget gate | ✅ (Wave 2) |
| Trust threshold for nominations | ✅ (Wave 2) |
| Receipt-in-feed | ❌ Wave 3 |
| Representative directory | ❌ Wave 3 |
| Native intents | ❌ Wave 3 |

#### Linked-Social — 🟡 Substrate + Feed Cards Landed

| Feature | Status |
|---------|--------|
| LinkedSocialAccount schema | ✅ (Wave 2) |
| SocialNotification schema | ✅ (Wave 2) |
| Vault token substrate | ✅ (Wave 2) |
| Notification ingestion | ✅ (Wave 2) |
| SocialNotificationCard (real data) | ✅ (Wave 2) |
| socialFeedAdapter | ✅ (Wave 2) |
| OAuth connection flow | ❌ Not implemented |

---

### News Aggregator

**Status:** 🟢 **Implemented** (Wave 1)

| Feature | Implementation |
|---------|----------------|
| RSS/Atom ingest | ✅ `ingest.ts` |
| HTML normalization | ✅ `normalize.ts` |
| TF-IDF story clustering | ✅ `cluster.ts` |
| Provenance tracking | ✅ `provenance.ts` |
| News store (Zustand) | ✅ `store/news/` |
| Gun news adapters | ✅ `newsAdapters.ts` |

---

### Discovery Feed

**Status:** 🟢 **Implemented** (Wave 1 + Wave 2 extensions)

| Feature | Implementation |
|---------|----------------|
| Feed shell + filter chips | ✅ `FeedShell.tsx` |
| Sort controls | ✅ `SortControls.tsx` |
| Hotness ranker | ✅ `HotnessRanker.ts` |
| TopicCard / NewsCard | ✅ Wave 1 |
| SocialNotificationCard (real data) | ✅ Wave 2 |
| ArticleFeedCard | ✅ Wave 2 |
| Discovery store + ranking | ✅ `store/discovery/` |

---

## Security Considerations

### Current Risks

| Risk | Severity | Status |
|------|----------|--------|
| No sybil defense | 🔴 High | Open |
| Trust scores spoofable | 🔴 High | Open (hardened stubs, not production) |
| First-to-file poisoning (v1) | 🟡 Medium | Open (v2 quorum landed, runtime pending) |

### Mitigations in Place

- ✅ Identity stored in encrypted IndexedDB vault
- ✅ Topology guard prevents unauthorized Gun writes
- ✅ Encryption required for sensitive mesh paths
- ✅ XP ledger is local-only
- ✅ Participation governors enforce rate limits (7/8 budget keys active)
- ✅ TOCTOU hardening on concurrent budget operations
- ✅ Attestation verifier has structured validation and rate limiting
- ✅ AI engine default is truthful (LocalMlEngine in non-E2E)
- ✅ Document keys derived per-document, never stored on mesh (Wave 2)
- ✅ OAuth tokens vault-only, never on public paths (Wave 2)

---

## Deployment Status

| Environment | Status | Artifacts |
|-------------|--------|-----------|
| Localhost (Anvil) | ✅ Working | `deployments/localhost.json` |
| Sepolia Testnet | ✅ Deployed | `deployments/sepolia.json` |
| Base Sepolia | ❌ Not deployed | Script exists |
| Mainnet | ❌ Not planned | — |

---

## Next Work (Post-Wave 4)

Wave 4 merged to main via PR #253 (`31fce88`, 2026-02-15T01:44:54Z). All integration branches (`integration/wave-3`, `integration/wave-4`) are ancestors of `main`.

Remaining from Wave 3 carryover (see `docs/foundational/WAVE3_CARRYOVER.md`):
1. **Feature-flag retirement** — promote Wave 1–4 flags to permanent-on after stability verification
2. **Remaining budget key** — `moderation/day` enforcement (key 8/8)
3. **Runtime wiring** — synthesis pipeline → discovery feed UI (v2 end-to-end)

Post-Season 0 (deferred per spec §9.2):
- TEE/VIO hardware binding
- Real sybil resistance
- BioKey, DBA, ZK-SNARK proofs
- Gold/Platinum trust tiers

---

## References

### Wave 4 Artifacts
- `docs/reports/WAVE4_DOC_AUDIT.md` — Wave 4 closeout documentation audit
- `docs/foundational/WAVE4_DELTA_CONTRACT.md` — 4 amendments (A5–A8)
- `docs/foundational/WAVE4_KICKOFF_COMMAND_SHEET.md` — Execution plan
- `docs/specs/spec-identity-trust-constituency.md` v0.2 — Architectural contract
- `docs/specs/spec-luma-season0-trust-v0.md` v0.1 — Season 0 enforcement spec

### Wave 2 Artifacts
- `docs/reports/WAVE2_DOC_AUDIT.md` — Wave-end documentation audit
- `docs/foundational/WAVE3_CARRYOVER.md` — Deferred items and Wave 3 entry points
- `docs/foundational/WAVE2_DELTA_CONTRACT.md` — 16 binding policies
- `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md` — CE dual-review protocol

### Wave 1 Artifacts
- `docs/reports/WAVE1_INTEGRATION_READINESS.md` — Integration gate report
- `docs/foundational/WAVE1_STABILITY_DECISION_RECORD.md` — Stability decisions

### Architecture & Specs
- `System_Architecture.md` — Target architecture
- `docs/foundational/ARCHITECTURE_LOCK.md` — Non-negotiable engineering guardrails
- `docs/specs/spec-hermes-docs-v0.md` — HERMES Docs spec (Canonical for Season 0)
- `docs/specs/spec-hermes-forum-v0.md` — Forum spec
- `docs/specs/spec-linked-socials-v0.md` — Linked-social spec
- `docs/specs/spec-civic-action-kit-v0.md` — Civic Action Kit spec
- `docs/specs/topic-synthesis-v2.md` — Synthesis V2 spec
