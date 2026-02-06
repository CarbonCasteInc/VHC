# Sprint 4: Agentic Foundation (Implementation Plan)

**Status:** ⚪ Planning  
**Predecessor:** Sprint 3.5 (UI Refinement) — ✅ COMPLETE  
**Context:** Hardening + refactor before scaling agentic features

---

## Goal

Establish a safe foundation for agentic participation, unify the Topics model, and harden analysis workflows before scaling features like Civic Action Kit and Region Proof.

---

## Phase 0 — Safety & Integrity Baseline (P0)

### 0.1 Identity Storage Hardening
- [x] Identity persistence migrated from localStorage to encrypted IndexedDB vault (`vh-vault` / `vault`) (PR #10, commit `813558c`)
- [ ] Add CSP + secure storage policy

### 0.2 Delegation Types + OBO Assertions
- [ ] Implement `FamiliarRecord`, `DelegationGrant`, `OnBehalfOfAssertion`
- [ ] Enforce tiered scopes (Suggest / Act / High-Impact)
- [ ] Tier 3 requires explicit human approval at time of action
- [ ] **E2E mock:** `VITE_E2E_MODE` disables familiar loops and mocks delegation checks

### 0.3 Participation Governors
- [ ] Enforce per-nullifier budgets (posts/comments/votes/analyses/etc.)
- [ ] Implement local-only “Agent Impact Meter” showing diminishing returns

---

## Phase 1 — Unified Topics Model

### 1.1 Thread Schema & Migration
- [ ] Add `topicId`, `sourceUrl`, `urlHash`, `isHeadline` to Thread
- [ ] Add `proposal?: ProposalExtension` to Thread
- [ ] Add `via?: 'human' | 'familiar'` to Comment
- [ ] Read-compat migration + schema dual-parse if needed

### 1.2 Topics Stream Integration
- [ ] Headline ↔ thread ↔ analysis share one `topicId`
- [ ] Single view for analysis + thread (remove two-graph behavior)

---

## Phase 2 — Analysis Robustness

### 2.1 v2 Quorum Synthesis Pipeline
- [ ] Candidate gather → synthesis → divergence → canonical v2
- [ ] Verified-only candidate submissions
- [ ] **Note:** Flow testing only until Phase 3 (real AI)

### 2.2 Comment-Driven Re-Synthesis
- [ ] Trigger after 10 verified comments (min 3 unique verified principals)
- [ ] Debounce: 30 minutes; Cap: 4 per topic/day

---

## Phase 3 — Real AI Engine

- [ ] Wire real engine (local-first)
- [ ] Remote engine requires explicit opt-in
- [ ] Preserve validation + guardrails

---

## Phase 4 — Civic Action Kit (Facilitation)

- [ ] PDF report generation
- [ ] Contact directory
- [ ] Native intents (mail/phone/share)

---

## Phase 5 — Region Proof

- [ ] RegionProof pipeline (stubs → real proofs)
- [ ] Required for district dashboards and verified constituency signals

---

## Dependencies

- Sprint 5 (Bridge + Docs) depends on **Phase 0–1** completion.

---

## Deliverables

- Secure storage and delegation foundation
- Enforced participation governors
- Unified Topics model across feed/forum/analysis
- Quorum synthesis + re-synthesis flow
- Real AI engine integration
