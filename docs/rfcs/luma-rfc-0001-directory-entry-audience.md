# LUMA-RFC-0001: Directory Entry Signed-Write Audience

Status: Accepted for M0.B directory-v1 slice
Owner: VHC Spec Owners
Date: 2026-05-07
Supersedes: none
Superseded-by: none

## Summary

This RFC adds the `vh-directory-entry` `SignedWriteEnvelope.audience` for the
M0.B directory-v1 migration. Directory entries are user-authored public records
under `vh/directory/<identityDirectoryKey>/`; they need their own audience so
future readers can bind signature replay, idempotency, and policy decisions to
the directory surface instead of reusing a forum or generic identity audience.

## Motivation

M0.B already landed `identityDirectoryKey` derivation and the signed-write SDK
foundation. The first adapter migration needs a closed audience value for
directory publishing before the app can stop writing raw nullifiers to
`vh/directory/*`.

Without this audience, directory publishing would either bypass
`SignedWriteEnvelope` or overload another write class. Both options weaken the
per-surface replay and policy boundary defined in
`docs/specs/spec-luma-service-v0.md` Section 5.

## Protocol Change

- Add `vh-directory-entry` to `AudienceTag`.
- Directory v1 public records use:
  - `schemaVersion: 'hermes-directory-v1'`
  - `_protocolVersion: 'luma-public-v1'`
  - `_writerKind: 'luma'`
  - `_authorScheme: 'identity-directory-v1'`
  - `identityDirectoryKey` as the record key and `SignedWriteEnvelope.publicAuthor`
  - `SignedWriteEnvelope.audience: 'vh-directory-entry'`
- Raw `principalNullifier` never appears in the directory v1 path, payload, or
  signed envelope.

## Migration Plan

- New publishes write only v1 records under `vh/directory/<identityDirectoryKey>/`.
- Legacy `hermes-directory-v0` records under raw-nullifier paths are read-only
  compatibility fixtures. Product code does not prefer them.
- v1 lookup validates the schema, envelope payload binding, audience, scheme,
  public author, idempotency fields, and signature before returning a record.
- The topology PII bypass for `vh/directory/` is removed.

## Rollback

Rollback is a forward-compatible code rollback: stop publishing v1 records and
leave existing v1 records inert. Readers already fail closed on unsupported or
malformed directory v1 records, and legacy v0 read compatibility remains
read-only for one release cycle.

## Privacy Classification

`identityDirectoryKey` is public, global-stable, and rotates on Reset Identity.
It is derived from `principalNullifier` by the registered
`identity-directory-v1` HKDF domain. Directory v1 records may include a
delegation signing public key. They must not include raw nullifier material,
private key material, wallet signer material, `district_hash`, or assurance
claim vectors.

## Tests And Gates

- Data-model tests reject raw nullifier/private-key-shaped directory v1 records.
- Gun-client tests validate v1 publish/readback/signature behavior and keep v0
  lookup read-only.
- Web tests prove contact QR/manual scan surfaces use `identityDirectoryKey`.
- `pnpm check:luma-directory-v1` guards the directory-v1 surface.
- Existing registry and signed-write surface gates continue to run.
