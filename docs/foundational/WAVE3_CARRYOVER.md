# Wave 3 Carryover Record

**Date:** 2026-02-13
**Decision Authority:** CEO
**Decision Date:** 2026-02-13
**Source:** Wave 2 closeout assessment

> **Updated 2026-02-15:** All 5 deferred items have been implemented and merged
> to `main` during Waves 3–4 (PRs #229–#259). Items marked ✅ LANDED below.

---

## Deferred Items

### 1. W2-Gamma Phase 4: Receipt-in-Feed — ✅ LANDED (Waves 2–3)

**Original scope:** Elevation action receipts rendered as feed cards in the unified discovery feed.

**What landed (Wave 2):**
- Elevation artifact generators (`BriefDoc`, `ProposalScaffold`, `TalkingPoints`) — PR #209
- `civic_actions/day` budget gate enforcement — PR #209
- Trust threshold checks for nominations — PR #209
- Social feed wiring (social notification cards) — PR #211

**What's deferred:**
- `DeliveryReceipt` schema definition (spec work needed)
- Receipt → feed card adapter
- Receipt rendering in `All` and dedicated `Actions` feed surface
- Cross-team coordination with feed shell (Team C patterns)

**Dependencies:**
- `spec-civic-action-kit-v0.md` needs `DeliveryReceipt` contract addition
- `spec-topic-discovery-ranking-v0.md` may need `ACTION_RECEIPT` feed kind

**Entry point:** Dispatch `w1-spec` for DeliveryReceipt schema, then `w2g-chief` for Phase 4 implementation.

**Rationale:** Elevation foundation (Phases 1-3) is solid and complete. Receipt-in-feed is additive — no rework of landed code needed.

---

### 2. SoT Delta F: Representative Directory + Native Intents — ✅ LANDED (Waves 2–3)

**Original scope:** Civic signal → value rails. Representative directory with native forwarding intents for civic action delivery.

**What landed (Wave 2):**
- Budget guards: 7/8 keys now active (including `civic_actions/day`)
- Elevation artifact generators
- Trust threshold enforcement

**What's deferred:**
- Representative directory data model and store
- Native intent definitions (email, call, letter templates)
- Intent delivery pipeline (local receipt generation)
- CAK facilitation model completion

**Dependencies:**
- `spec-civic-action-kit-v0.md` §§ representative directory and intent definitions
- Bridge service endpoints (stub landed, implementation needed)

**Entry point:** CEO designated CAK completion as Wave 3 priority #1.

**Rationale:** Foundation infrastructure (budget gates, elevation artifacts, trust thresholds) is in place. Delivery pipeline is the remaining vertical.

---

### 3. CollabEditor Runtime Wiring — ✅ LANDED (Wave 3)

**Original scope:** Multi-author collaborative editing in the active article editor path.

**What landed (Wave 2 Beta Stage 2):**
- `CollabEditor` component (TipTap + Yjs binding, lazy-loaded) — 229 LOC
- `PresenceBar` component (awareness indicators) — 66 LOC
- `ShareModal` component (access control UI) — 261 LOC
- `hermesDocsCollab` store (collab state, auto-save, offline indicator)
- `hermesDocsAccess` store (pure access control functions)
- `@vh/crdt` package (Yjs provider, awareness adapter, dedup)
- Document key management (derive, share, encrypt/decrypt)
- Full test suite: 204 tests, 100% coverage

**What's deferred:**
- Wire `CollabEditor` into `ArticleEditor.tsx` active path (currently `ArticleEditor` remains single-author textarea)
- Flag-gated transition: `VITE_DOCS_COLLAB_ENABLED=true` activates `CollabEditor` in place of textarea
- Integration testing of collab + single-author mode switching

**Dependencies:**
- No spec work needed — `spec-hermes-docs-v0.md` covers this
- No new ownership changes needed — all paths in w2b scope

**Entry point:** Single PR from `w2b-chief`: wire `CollabEditor` into `ArticleEditor`, add flag-gated mode selection, integration tests.

**Rationale:** PR #220 was reclassified as "foundation-only" by CEO. All collab modules are built, tested, and landed — wiring is a focused integration task.

---

## Wave 3 Priority Order (CEO Directive)

1. CAK completion (Phase 4 receipt-in-feed + rep directory + native intents)
2. CollabEditor runtime wiring
3. Feature-flag retirement (Wave 1+2 flags → permanent-on)
4. Remaining budget key (`moderation/day` — key 8/8)
5. Runtime wiring: synthesis pipeline → discovery feed UI (v2 end-to-end)
