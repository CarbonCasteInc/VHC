# LUMA M1.B Identity Controls Design Packet

> Status: Draft design packet (execution artifact; the spec wins on conflict)
> Owner: VHC Spec Owners
> Last Reviewed: 2026-07-02
> Depends On: docs/specs/spec-luma-service-v0.md, docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md, apps/web-pwa/src/hooks/useIdentity.ts, packages/identity-vault/src/vault.ts, docs/foundational/STATUS.md

Scope: UX copy, state model, preservation/rotation semantics, a11y criteria,
and test expectations for the `/account/identity` identity-controls surface
(roadmap M1.B). This packet is design-only: it changes no provider selection,
no public schema, no vault layout, and no live Scope A behavior. Normative
semantics live in `docs/specs/spec-luma-service-v0.md` §13; this packet
sequences how the UI lands them.

## 1. Current implementation truth (verified 2026-07-02)

| M1.B deliverable | State | Evidence |
| --- | --- | --- |
| `useIdentity.signOut()` / `resetIdentity()` split | DONE | `apps/web-pwa/src/hooks/useIdentity.ts` (~315-336); `revokeSession()` is a deprecation shim |
| Spec §13.2 state-graph behavior in the hooks | DONE (operator-token row completed after initial packet) | Sign Out preserves device credential / SEA pair / wallet binding / delegation key / operator token; Reset rotates or clears them; see §3 table |
| `operatorAuthorizationToken` clearing on Reset | DONE | Implemented as an optional VaultV2 compartment; `resetIdentity()` explicitly clears it and tests prove Sign Out preserves it |
| Unit tests for Sign Out / Reset semantics | DONE | `useIdentity.test.ts` asserts session clearing, runtime clearing, compartment preservation/rotation, wallet binding, delegation storage, operator token, XP active nullifier, sentiment signals, and telemetry reset |
| `/account/identity` route | DONE | Route is registered in `apps/web-pwa/src/routes/index.tsx` |
| Controls UI (panels, confirmation modals, session metadata) | DONE | `apps/web-pwa/src/routes/AccountIdentityPage.tsx` implements the panel, confirmation modals, session metadata, and telemetry debug surface |
| Wallet re-bind prompt after Reset | DONE | `/account/identity` renders `identity-wallet-rebind` when a connected wallet is missing a binding to the current principal or is bound to a prior principal |
| E2E flows (sign-out continuity / reset rotation) | DONE | `packages/e2e/src/luma/account-identity-controls.spec.ts` covers Sign Out continuity, Reset rotation, wallet re-bind prompt, and rendered-copy forbidden-claim assertions |

## 2. UX copy pack (draft strings)

All strings below must stay inside the forbidden-claims registry
(spec §20, enforced by `pnpm check:luma-forbidden-claims`). None of them may
claim deletion, anonymity, or repudiation.

### 2.1 Panel frame

- Title: `Identity`
- Assurance line: `Beta-local identity on this device` (tier language only;
  never a numeric trust score, never the principal nullifier)
- Session metadata rows: `Created`, `Expires` (with near-expiry warning within
  24h per spec §12.3), `Verifier: beta-local`
- Near-expiry warning: `Your session expires soon. Re-attest to continue
  posting and voting. Browsing is unaffected.`

### 2.2 Sign Out

- Button: `Sign out`
- Modal title: `Sign out of this device?`
- Modal body: `Signing out ends your current session. Your identity stays on
  this device: signing back in restores the same pseudonym, wallet binding,
  and reputation. Your published posts and votes are unaffected.`
- Confirm: `Sign out` / Cancel: `Cancel`

### 2.3 Reset Identity

- Button: `Reset identity` (destructive styling, separated placement)
- Modal title: `Reset your identity on this device?`
- Modal body: `Resetting stops using the current pseudonym and rotates the
  identity material on this device. The next identity you create on this device
  uses a new pseudonym. Your previous posts, comments, and votes remain public
  under your old pseudonym — resetting does not remove them and cannot make
  them yours again. Your wallet must be re-bound, and any operator
  authorization or delegations are cleared.`
- Second-step confirmation (destructive tier): type-to-confirm the literal
  word `reset`, then `Reset identity` / `Cancel`
- Post-reset toast: `Identity reset. Your previous pseudonym's public history
  remains on the network.`

Copy red-lines (from spec §13.3-§13.4 and §20): never render "delete", never
imply prior history is removed, transferred, or disowned; never render the
principal nullifier; never show a numeric trust score.

### 2.4 Wallet re-bind prompt (post-Reset, on next claim)

`This wallet is not bound to your current identity. Re-bind it to continue.`
Action: `Re-bind wallet`.

### 2.5 Privacy links

Panel footer links to `/support` and `/data-deletion` (spec §19.1); the
data-deletion page copy already owns the honest-deletion stance.

## 3. Preservation/rotation contract (spec §13.2 + implementation truth)

| Asset | Sign Out | Reset Identity | Implementation anchor |
| --- | --- | --- | --- |
| `vaultMasterKey` | Preserved | Preserved | vault `keys` store; untouched by both flows |
| `deviceCredential` | Preserved | Rotated | `deviceCredential.rotate()` in `resetIdentity()` |
| `sessionToken` | Cleared | Cleared | `vaultClear()` |
| `assuranceEnvelope` | Cleared | Cleared | `vaultClear()` |
| `seaDevicePair` | Preserved | Rotated | `seaDevicePair.rotate(() => SEA.pair())` |
| `walletBinding` | Preserved | Cleared (re-bind prompt) | `clearWalletBinding()` |
| `delegationSigningKey` | Preserved | Rotated | `delegationSigningKey.rotateStored()` |
| `operatorAuthorizationToken` | Preserved | Cleared | `operatorAuthorizationToken` vault compartment; `resetIdentity()` calls `operatorAuthorizationToken.clear()` |
| `vh_delegation_v1:<principal>` localStorage | Preserved | Cleared | `clearDelegationStorageForPrincipal(oldPrincipal)` |
| `xpLedger.activeNullifier` | Cleared, re-attached on re-attest | Cleared (new principal) | `clearActiveIdentityRuntime()` |
| `useSentimentState.signals` | Cleared | Cleared | `clearActiveIdentityRuntime()` |
| Public history (posts, votes, directory, on-chain) | Untouched | Untouched (historical artifact under old ids) | spec §13.3; UI copy must say so |

## 4. State model

Base identity states (existing `IdentityStatus`): `hydrating → anonymous →
creating → ready → expired | error`.

Controls-layer overlay states for `/account/identity`:

```
ready ──[Sign out clicked]──> confirmingSignOut ──[confirm]──> signingOut ──> anonymous
ready ──[Reset clicked]────> confirmingReset ──[type-to-confirm]──> resetting ──> anonymous
confirming* ──[cancel/esc/backdrop]──> ready (no state mutated)
signingOut/resetting failure ──> ready + error banner (no partial mutation visible)
expired ──> ready-with-reattest-prompt (Sign Out available; Reset available)
```

Rules: a cancelled confirmation must mutate nothing; the destructive path
(Reset) requires the two-step confirm; both flows disable their trigger
buttons while in-flight; `anonymous` state shows the create-identity call to
action, not the controls.

## 5. A11y expectations

- Modals: focus trap, `role="dialog"`, `aria-labelledby` (title) +
  `aria-describedby` (body), Escape cancels, focus returns to the trigger.
- Destructive tier: Reset confirm button `aria-disabled` until the
  type-to-confirm matches; the input has an explicit label.
- Deferred affordances follow the existing dashboard pattern
  (`aria-describedby` + `data-testid`, as in `link-device-deferred`).
- Test ids: `identity-panel`, `identity-sign-out`, `identity-reset`,
  `identity-sign-out-confirm`, `identity-reset-confirm`,
  `identity-session-expiry`, `identity-wallet-rebind`.
- Announcements: post-action toasts use a polite live region.

## 6. Test expectations

### 6.1 Unit (state-graph completion)

`useIdentity.test.ts` asserts every exposed row of the §3 table for both
flows. Direct `vaultMasterKey` inspection remains intentionally unavailable;
the test proves preservation through post-flow compartment load/create behavior
for device credential, SEA pair, wallet binding, and delegation key material.

### 6.2 E2E (roadmap M1.B acceptance)

- Continuity: create → publish → sign out → re-create asserts same
  `principalNullifier`, same `forumAuthorId`, same operator authorization,
  same wallet binding.
- Rotation: create → publish → reset identity → re-create asserts different
  `principalNullifier`, different `forumAuthorId`, no operator authorization,
  no delegation grants, wallet re-bind prompt rendered.
- Copy: both modals render; neither contains a forbidden-claims registry
  phrase (rendered-copy assertion, complementing the build-time grep).

Implemented coverage: the current Playwright slice asserts principal and
`forumAuthorId` continuity/rotation, rendered-copy forbidden-claim absence,
raw principal/session-token non-disclosure, and wallet re-bind prompt rendering.
Operator-authorization and delegation-grant browser seeding remain covered at
the hook state-graph layer because the public UI does not expose controls to
mint those compartments.

### 6.3 Fixtures

Vault fixtures for: populated v2 vault (session + wallet + delegations),
post-sign-out vault (device-bound compartments intact), post-reset vault
(rotated compartments). Reuse the compartment fakes from `useIdentity.test.ts`.

## 7. Sequencing and non-goals

Implementation PR order (each independently revertable): (1) route + panel +
session metadata (read-only); (2) Sign Out flow + modal; (3) Reset flow +
two-step confirm + wallet re-bind wiring; (4) remaining state-graph unit-test
completion; (5) E2E flows.

Non-goals for all of the above: no provider selection changes, no public
schema/epoch changes, no further vault layout changes beyond the completed
optional `operatorAuthorizationToken` compartment, no delete-account
affordance, no multi-device linking (stays fail-closed stub), no numeric trust
display.
