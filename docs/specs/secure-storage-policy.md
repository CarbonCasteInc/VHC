# Secure Storage Policy

This policy defines where data may be stored in the VHC web stack.

## Tier 1 — Vault (`@vh/identity-vault`)

**Data items**
- Master key
- Identity record
- Session token
- Nullifier
- Trust score

**Rationale**
- These values are secrets and/or high-sensitivity identity artifacts.
- Exposure would compromise account integrity, privacy, and trust enforcement.

**Storage rule**
- Must remain inside vault-managed encrypted storage only.
- **Never** write Tier 1 data into `localStorage` or `safeStorage` wrappers.

**Enforcement mechanism**
- Vault API is the only write/read path for Tier 1 records.
- Static storage audit test blocks Tier 1 key patterns from `safeSetItem` / `safeGetItem` usage.
- Identity-vault package must not import `safeStorage`.

## Tier 2 — Browser local persistence (`safeStorage` / `localStorage`)

**Data items**
- XP ledger (`vh_xp_ledger`)
- Forum votes (`vh_forum_votes`)
- UI preferences (theme, color settings, callout dismissals)

**Rationale**
- Non-secret UX and engagement state should persist offline for better user experience.
- Values are scoped to a user/nullifier context, but are not cryptographic secrets.

**Storage rule**
- Tier 2 data may be stored via `safeStorage` wrapper.
- Raw `localStorage` access should be avoided in app code.

**Enforcement mechanism**
- ESLint `no-restricted-globals` policy discourages direct storage globals.
- `safeStorage` wrapper centralizes browser/SSR-safe storage behavior.

## Tier 3 — Ephemeral (in-memory only)

**Data items**
- Decrypted message content
- Gun session keys
- Derived crypto keys

**Rationale**
- These values are highly sensitive and short-lived by design.
- Persistence would materially increase blast radius on compromise.

**Storage rule**
- Must never be persisted to vault, `safeStorage`, `localStorage`, or any durable browser store.

**Enforcement mechanism**
- Enforced via code review and security review expectations for crypto/session paths.
