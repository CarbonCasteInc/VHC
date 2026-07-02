# LUMA M2.A Verifier Spec Packet (Draft)

> Status: Draft design packet — NOT a landed spec, NOT a deployment authorization
> Owner: VHC Spec Owners
> Last Reviewed: 2026-07-02
> Depends On: docs/specs/spec-luma-service-v0.md, docs/ops/luma-verifier-current-state.md, docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md, docs/specs/spec-identity-trust-constituency.md, services/luma-verifier-dev/src/main.rs

Scope: the design input for `spec-luma-verifier-v0.md` (roadmap M2.A). This
packet consolidates the normative requirements the verifier spec must satisfy
(service spec §10, §11.6, §14, §17, §18, §19, §21) against the recorded DEV
current state, so the M2.A spec can be written from explicit drift instead of
implicit assumptions. It deliberately does not land the spec: M2.A's
acceptance requires decisions this packet can only name.

## 0. Draft framing — unsatisfied dependencies

This packet MUST NOT be treated as buildable until each is resolved:

| Dependency | State | Consequence |
| --- | --- | --- |
| M1 complete (M1.A-M1.E) | NOT MET | Envelope wiring, identity controls, profile guard, forbidden-claims gate, telemetry are all inputs to verifier failure modes and client behavior |
| Ops ownership (M2.A-4) | OPEN | No operating team named; cross-team review is an M2.A acceptance criterion |
| Audit retention policy (M2.A-3) | OPEN | Retention numbers below are placeholders pending ops |
| Custody architecture (M2.A-7) | DEFAULT PROPOSED | Cold root + online subkeys + 3-of-5 quorum is the roadmap default, unratified |
| Env-name drift assertion (M1.C) | LANDED as `check:luma-production-profile` source/env guard | Bundle-level assertion still pending public-beta build wiring (`--dist`) |

Hard non-goals in the current execution window: no verifier deployment, no
`VITE_ATTESTATION_URL` promotion, no provider/profile promotion, no Silver or
verified-human or one-human-one-vote or Sybil-resistance or cryptographic
residency or mesh release-readiness claims, no public schema epoch change.

## 1. Current-state drift the spec must consume

From `docs/ops/luma-verifier-current-state.md` (M0.E record):

- DEV stub serves only `GET /health` + `POST /verify`; truth-labeled
  `environment: "DEV"`; length/prefix heuristics; no nonce freshness, no
  replay detection, no signing, no audit. The heuristic is NOT the Silver
  algorithm and MUST NOT be inherited.
- Response drift: Rust returns `{token, trustScore, nullifier, environment,
  disclaimer}`; canonical TS `SessionResponse` requires `{token, trustScore,
  scaledTrustScore, nullifier, createdAt, expiresAt}`; a gun-client shim
  bridges. M2.A owns the single shared schema (TS is the schema authority).
- Nullifier derivation today: `sha256(NULLIFIER_SALT || device_key)` with an
  unset-salt fallback. The spec requires constant-time
  `HMAC-SHA-256(salt = NULLIFIER_SALT, message = deviceCredential)` (service
  spec §3, §6.4, §11.3) and per-profile pinned salt (§17.2). Fallback salts
  are forbidden in deployable profiles; the migration from sha256-concat to
  HMAC MUST preserve continuity or be scheduled before any real enrollment.
- Env-name drift (`ATTESTATION_URL` vs `VITE_ATTESTATION_URL`) is now locked
  by the M1.C gate at source level; the verifier spec pins the URL contract
  per profile.

## 2. Endpoint contract (draft)

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `GET /challenge` | Issue nonce challenge | Nonce: 128-bit random, single-use, bound to `audience`+`origin`+`profile`; default window 60s (M2.A-2); replay-cached until expiry |
| `POST /verify` | Attestation → session | Consumes a live challenge; returns signed `SessionResponse` + `AssuranceEnvelope`; signature covers the full response plus bound `nonce`/`audience`/`origin`/`profile`; server-set `expiresAt` (7-day TTL per service spec §12.1) |
| `GET /.well-known/jwks.json` | Online subkey set | Rotating subkeys; 7-day rotation grace (M2.A-6) |
| `GET /.well-known/luma-verifier-manifest` | Transparency manifest | Shape per service spec §17; append-only, mirrored (GitHub Pages + Sigstore-rekor); client verifies JWKS matches manifest on every session creation; drift = hard reject |
| `GET /.well-known/luma-verifier-revocations` | Session/key revocation list | Constant-time membership checks (§6.4) |
| `GET /.well-known/luma-safety-bulletin` | Operational kill switch | Shape per §18; signed by the cold root key, never an online subkey (§18.2); 24h freshness window default |
| `GET /health` | Liveness | No trust semantics |

Single shared schema: TypeScript is the authority; the Rust (or other)
implementation consumes generated/vendored types plus the frozen test vectors
(§21.1). The DEV truth-label fields (`environment`, `disclaimer`) are not part
of the production schema and MUST NOT leak into it by accident.

## 3. Trust boundary and signing (draft)

- Default suite `jcs-ed25519-sha512-v1` for verifier-issued envelopes; suite
  set is closed and named per envelope (§6.2-6.3).
- Client trust: JWKS plus build-pinned verifier identity
  (`apps/web-pwa/src/luma/verifier-pin.json`, §17.1); the pin takes
  precedence — a verifier whose live values mismatch the pin is untrusted
  regardless of a valid JWKS chain.
- Custody (M2.A-7 default, unratified): cold-storage root key; online
  subkeys sign sessions/manifests; root signs safety bulletins and rotation
  attestations; N=3-of-K=5 quorum for root operations.
- Key rotation: 7-day grace overlap (M2.A-6); rotation is manifest-visible
  (retiredKeys) and rekor-logged. Salt rotation is NOT key rotation — it is a
  P0 identity-continuity incident (§17.2, current-state §5).
- `AssuranceEnvelope` construction: `assuranceLevel='silver'`,
  `claimVector.device_integrity='silver'`, `claimVector.liveness='silver'`,
  all other claims `'beta_local'`/`'none'` (§4). The trust-score policy doc is
  hashed into the manifest (`trustScorePolicyHash`); policy changes are
  manifest-visible by construction.

## 4. Rate limits and abuse posture (draft numbers, ops-unratified)

- Per-IP: challenge 30/min burst 10; verify 10/min burst 5.
- Per-devicePub: verify 5/min, 20/day.
- Per-nullifier: re-attestation 10/day.
- On limit: `rate_limited` with `Retry-After`; never a silent degrade to a
  lower-assurance response.
- `verifier_overload` (load-shed) is distinct from `rate_limited` (abuse).

## 5. Failure-mode taxonomy (closed enums)

Service-spec `PolicyReason` values apply unchanged. Verifier-specific
additions (all typed, all closed): `bad_nonce`, `attestation_replayed`,
`attestation_too_low`, `rate_limited`, `verifier_overload`, `salt_mismatch`,
`manifest_drift`, `key_rotation_in_progress`. Failed attestation falls back
to `view-only` — never silent anonymous, never a fake lower-assurance session
(reads stay open per §10; identity gates only write/vote/claim).

## 6. Audit events and retention (placeholder pending M2.A-3)

- Append-only audit log; every event passes the §16.2 redaction list at emit
  time (no raw nullifiers, tokens, signatures, evidence vectors, mesh paths;
  `verifierIdHash` not `verifierId`).
- Event classes: challenge issued/consumed, verify accepted/rejected (with
  typed reason), key rotation, manifest publication, bulletin publication,
  revocation-list change, rate-limit trip.
- Retention: PLACEHOLDER 90 days hot / 365 days cold, digests-only after 30
  days — numbers owned by ops (M2.A-3) and not committable here. Evidence
  retention on the verifier side holds digests and timestamps, never raw
  vectors (§11.6).

## 7. SLOs (draft until ops review)

Availability 99.5%; `POST /verify` p95 < 1.5s, p99 < 3s; challenge p99 <
300ms; manifest/bulletin endpoints p99 < 300ms (static, mirrored). Bulletin
freshness 24h. Client behavior on missing/stale bulletin in
`production-attestation`: hard reject (§18.1).

## 8. Deployment topology (draft)

Standalone service (`services/luma-verifier`, M2.B), isolated from the
public-news relay/publisher failure domain — a verifier outage MUST NOT be
able to fail-close Scope A publication, and Scope A load MUST NOT contend
with attestation latency. Static well-known artifacts served from mirrored
storage. No shared host with the A6 relay stack in the production topology
(the single-host A6 lesson from Phase 5 applies here as a design input).

## 9. Continuity contract (§14, restated as verifier obligations)

Same device + same `deviceCredential` → same `principalNullifier` under the
pinned salt; the Silver envelope replaces the beta-local one with identical
identity projection. The §21.3 continuity gate (byte-identical `PrincipalId`,
`forumAuthorId`, XP, wallet binding, operator status across the upgrade on a
recorded corpus) is the release gate for this obligation.

## 10. Adversarial harness (gates the Silver claim, §21.2)

The full §21.2 corpus (replayed video, synthetic feed, missing IMU,
emulator/rooted, ± clock skew, nonce replay, origin/audience/profile
crossover, salt mismatch, manifest drift, bulletin staleness, hostile
verifier, suite mismatch, envelope downgrade, idempotency replay, a11y
fallback to view-only) implemented under `services/luma-verifier/tests/
adversarial/` and `apps/web-pwa/e2e/adversarial/`. No implementation may
claim Silver before the corpus passes; the corpus result feeds
`pnpm check:luma-production-profile`'s successor gate for the
`production-attestation` profile.

## 11. Key-compromise drill (runbook draft — graduates to docs/ops/luma-verifier-runbook.md at M2.A)

1. Detect/suspect online-subkey compromise → publish root-signed safety
   bulletin revoking the subkey id and its policy hash (§18); clients drop
   affected sessions (`session_revoked_by_bulletin`).
2. Rotate: new subkey in JWKS + manifest with `retiredKeys` entry naming the
   reason; rekor entry; 7-day grace does NOT apply to compromised keys
   (immediate cut).
3. Root compromise: quorum (3-of-5) re-roots; new pin shipped in a client
   build; old root's bulletins distrusted by pin update — this is a
   full-population re-attestation event and a P0.
4. Salt exposure: P0 identity-continuity incident per §17.2 — separate
   migration plan, never handled inside key rotation.
5. Rehearsal: quarterly, calendared at M2.A signoff (first date is an M2.A
   acceptance criterion; deliberately not schedulable from this packet).

## 12. Open decisions carried to M2.A signoff

M2.A-2 nonce window (default 60s) · M2.A-3 audit retention (ops) · M2.A-4
operating team (unblocks cross-team review) · M2.A-6 rotation grace (default
7d) · M2.A-7 custody ratification (default cold-root 3-of-5) · Rust-vs-TS
implementation language (M2.B-1) · sha256-concat → HMAC nullifier derivation
migration timing (§1 above).
