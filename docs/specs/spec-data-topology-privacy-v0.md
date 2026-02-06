# Data Topology & Privacy – Season 0 Spec

Version: 0.1  
Status: Canonical for Sprints 2–3

This spec defines where data lives (device, mesh, chain, cloud), what is public vs sensitive, and the rules for handling civic/identity/constituency data in Season 0.

## 1. Object Inventory & Locations

| Object            | On Device                                                        | Mesh / Gun                                     | On-chain                                        | Cloud / MinIO | Class      |
|-------------------|------------------------------------------------------------------|------------------------------------------------|--------------------------------------------------|--------------|-----------|
| CanonicalAnalysis | `localStorage: vh_canonical_analyses`, IndexedDB `vh-ai-cache`   | `vh/analyses/<urlHash> = CanonicalAnalysis`    | –                                                | –            | Public    |
| Sentiment (v0)    | `localStorage: vh_civic_scores_v1` (per item:perspective)        | –                                              | –                                                | –            | Sensitive |
| Proposals (v0 UI) | React state only                                                 | –                                              | QF `Project` (recipient/amounts, no metadata)    | –            | Public    |
| Wallet balances   | React state (`balance`, `claimStatus`)                           | –                                              | `RVU.balanceOf`, `UBE.getClaimStatus`, tx log    | –            | Sensitive |
| IdentityRecord    | IndexedDB `vh-vault` (`vault` store, encrypted with per-device master key) + in-memory provider runtime | `user.devices.<deviceKey> = { linkedAt }`      | `nullifier` + scaled trustScore in UBE/QF/Faucet | –            | Sensitive |
| RegionProof       | Local-only (per `spec-identity-trust-constituency.md`)           | – (no v0 usage)                                | –                                                | –            | Sensitive |
| XP Ledger         | `localStorage: vh_xp_ledger` (per nullifier XP tracks)           | – (or encrypted outbox to Guardian node)       | –                                                | –            | Sensitive |
| Messages (future) | TBD                                                              | `vh/chat/*`, `vh/outbox/*` (guarded; see below)| –                                                | Attachments  | Sensitive |
| FamiliarRecord    | Local-only (encrypted)                                           | –                                              | –                                                | –            | Sensitive |
| DelegationGrant   | Local-only (encrypted)                                           | – (optional encrypted backup only)             | –                                                | –            | Sensitive |
| AgentActionLog    | Local-only                                                       | – (optional encrypted outbox)                  | –                                                | –            | Sensitive |
| DraftArtifacts    | Local-only until publish                                         | –                                              | –                                                | –            | Sensitive |

## 2. Classification & Rules

- **Public-by-design:** CanonicalAnalysis, AggregateSentiment (per topic, per district), QF project totals/funding amounts.
- **Sensitive:** IdentityRecord (attestation, nullifier), RegionProof/ConstituencyProof, per-user SentimentSignals, messages & social graph, wallet↔nullifier mappings.

Rules:
- Only Public objects may be stored plaintext under `vh/*` in the mesh.
- Sensitive objects either stay on-device or travel via encrypted channels (user-scoped Gun space, outbox to Guardian Nodes).
- `district_hash` and `nullifier` never appear together in any public structure; no identity/constituency data in CanonicalAnalysis.
- Runtime identity access is in-memory: `getPublishedIdentity()` returns a public snapshot (`nullifier`, `trustScore`, `scaledTrustScore`), and `getFullIdentity()` is reserved for same-process consumers that need private key material.
- Legacy key `vh_identity` is migration-only input (read once, then deleted); it is not an active persistence mechanism.
- `vh:identity-published` is a hydration signal `CustomEvent` and MUST NOT carry identity payload data.
- XP ledger (per nullifier) is sensitive; only safe aggregates with cohort thresholds may be exposed.
- Public mesh objects MUST NOT include delegation grants, familiar IDs, or agent logs in plaintext.
- If exported to a Guardian/aggregator, delegation data MUST be encrypted and still obey the existing `{district_hash, nullifier}` separation rules.

## 3. Sentiment & Constituency Flow

- Event-level `SentimentSignal` (sensitive):
  - Lives on-device.
  - May be sent encrypted to a Guardian Node/regional aggregator.
  - Never stored plaintext on the public mesh.

- Aggregates (public):
  - Guardian Nodes aggregate per `(district_hash, topic_id, point_id)`:
    - counts (agree/disagree/neutral),
    - aggregated weight (sum or avg).
  - Only these aggregates (no nullifiers) are exposed to dashboards/reps.

- On-chain:
  - Governance/economic contracts (UBE, QF, Faucet) are region-agnostic and never see `district_hash`.

## 4. Gun Mesh Policy

- Allowed plaintext namespaces:
  - `vh/analyses/<urlHash>` → CanonicalAnalysis.
  - Aggregate sentiment namespaces without per-user IDs (e.g., `vh/aggregates/<topicId>`).
- Disallowed plaintext:
  - `vh/signals/*` with per-user SentimentSignal.
  - `vh/users/<nullifier>/*` with identity-mapped data.
- `chat` / `outbox`:
  - Season 0: no production use until E2EE is implemented.
  - Dev-only writes must be behind feature flags.

## 5. Aggregation Safety

- Minimum cohort size: do not publish per-district stats until at least `N` distinct nullifiers for `(district_hash, topic)` (e.g., N=20).
- Rounding/binning: public dashboards show rounded percentages/bins for small samples.
- No cross-linkage: UI never exposes per-user sentiment history joined with district info.

## 6. Test Invariants

- Static checks: no Gun write paths of the form `vh/users/<nullifier>/...` in production code; no public types combining `{ district_hash, nullifier }`.
- Runtime tests: ensure CanonicalAnalysis stored in mesh has no identity/constituency fields; sentiment UI updates change local stores/aggregated mock outputs only.
- Docs/impl alignment: topology table spot-checked each major release.
