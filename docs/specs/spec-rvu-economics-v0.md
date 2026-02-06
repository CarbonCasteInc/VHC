# RVU, UBE, Faucet & QF – Season 0 Economics Spec

Version: 0.1  
Status: Canonical for Sprints 2–3

This spec captures the Season 0 economic contract (RVU v0, UBE, Faucet, Quadratic Funding) so client, mesh, and chain implementations stay aligned.

## 1. RVU v0

- Standard ERC-20 with `MINTER_ROLE` / `BURNER_ROLE`; no cap, no rebasing, no index logic.
- Minters (v0): bootstrap mint (deploy), UBE drip, Faucet drip.
- Sinks/locks: QuadraticFunding holds contributions + matching; no auto-burns (burn unused in v0).
- Metrics: `totalSupply`, `balanceOf(QuadraticFunding)`, plus distribution counters (`UBE.totalDistributed`, `Faucet.totalDripped`, `QuadraticFunding.distributedMatching`).

## 2. UBE v0

- Parameters: `TRUST_SCORE_SCALE = 1e4`; `minTrustScore = 5000`; `claimInterval = 1 day`; `dripAmount ~25 RVU` (Season 0 default).
- State per identity: `nullifier`, `trustScore`, `expiresAt`, `lastClaimAt`.
- Eligibility: identity exists, `trustScore ≥ minTrustScore`, `expiresAt > now`, cooldown satisfied. No region gating in v0.
- UX: surfaced as “Daily Boost” to XP; can mint RVU on testnet or run XP-only mode via config.
- Abuse model: bounded by attestation expiry, trustScore updates; modest floor only.

## 3. Faucet v0

- Same trust/interval gating pattern as UBE; own `dripAmount`, cooldown, `minTrustScore`.
- Scope: dev/onboarding/early tester rewards; not part of the long-term dignity loop.

## 4. Quadratic Funding v0

- On-chain: attested participants (`recordParticipant`), project registration, `castVote` with quadratic aggregation, matching pool funding, settlement, withdrawals.
- Season 0 product scope: public UX is off-chain (seeded proposals, local-only votes/voice credits); on-chain QF rounds are run only by curators/dev accounts for test rounds.
- Projects: curated protocol/public-goods; admin/curator registers projectIds.

## 5. Season 0 Metrics & Dashboards

- Required counters: `totalSupply`, `lockedInQF = balanceOf(QuadraticFunding)`, `UBE.totalDistributed`, `Faucet.totalDripped`, `QuadraticFunding.distributedMatching`.
- Dev “Global Wealth” dashboard should render these for monitoring inflation and governance flow.

## 6. Test Invariants

- UBE/Faucet: enforce trust gating, expiry, cooldown; counters increment as expected.
- QF: quadratic math and matching correct; trust gating enforced; withdrawals pay recipients.
- RVU: only intended mint paths increase supply; no unintended burns.

## 7. Integration Map

- `useWallet`/dashboards: display RVU supply/locked and distribution counters (dev-only in S0).
- UBE claim UI: trustScore gating; XP-only vs RVU-claim mode configurable.
- Faucet UI: hidden/restricted for normal users; guarded by env/whitelist.
- Governance: public PWA avoids on-chain `castVote` in S0; internal tools/scripts exercise QF for test rounds.

## 8. XP Linkage (Participation Weight)

### 8.1 Proposal Threads & QF Mapping

- Proposals are **threads with a `proposal` extension** (see `spec-hermes-forum-v0.md`).
- `qfProjectId` links the proposal-thread to the on-chain `QuadraticFunding` contract.
- Season 0: proposal support is **off-chain simulation**; future seasons may route real RVU via `castVote`.

- XP is the off-chain, per-nullifier participation ledger (see `spec-xp-ledger-v0.md`), partitioned into `civicXP`, `socialXP`, `projectXP`, with `totalXP` as a deterministic function.
- XP prototypes the future distribution weight for GWC:

```
share_i = totalXP_i^γ / Σ_j totalXP_j^γ
RVU_i   = α * pool * share_i
```

- XP is non-transferable, monotonic, and per-nullifier; emission parameters can evolve without retro-editing historic XP. When GWU/RVU index mechanics go live, a defined fraction of new issuance can be allocated using this weight function.
- Value share and influence are computed per **principal nullifier** with diminishing returns across active projects/topics.
- Agents (familiars) do not create additional economic identity, voting power, or share; they inherit the principal’s budgets and falloff.
