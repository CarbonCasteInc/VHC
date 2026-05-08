# Mesh Canonical Soak Evidence Packet

## Scope

This packet promotes the scrubbed evidence for the Slice 14C canonical
30-minute mesh soak run. It proves only the local synthetic mesh rolling-restart
soak duration claim for the current mesh readiness aggregate.

It does not prove public WSS deployment readiness, LUMA-gated production write
coverage, production app canary success, or test-group readiness.

## Source

- Branch: `coord/mesh-canonical-soak-proof`
- Source commit: `1677ab0cd70f146bd0547380946e14b467c8cbfc`
- Aggregate run id: `mesh-production-readiness-20260508T225508Z-70bd6af4`
- Aggregate generated at: `2026-05-08T23:35:51.750Z`
- Scrub run id: `mesh-evidence-scrub-20260508T233605Z-3522ace9`
- Scrub generated at: `2026-05-08T23:36:05.754Z`

## Commands

```bash
VH_MESH_SOAK_DURATION_MS=1800000 pnpm check:mesh:production-readiness
pnpm check:mesh-evidence-scrub -- --source-dir .tmp/mesh-production-readiness/latest
```

## Result

- Aggregate status: `review_required`
- `schema_epoch`: `post_luma_m0b`
- `luma_profile`: `none`
- Source reports: `12`
- `soak.requested_duration_ms`: `1800000`
- `soak.canonical_duration_ms`: `1800000`
- `soak.full_duration_satisfied`: `true`
- `soak.terminal_failures`: `0`
- `soak.duplicate_canonical_writes`: `0`
- `soak.silent_drops`: `0`
- Cleanup status: `pass`
- Evidence scrub status: `pass`
- Evidence scrub failures: `[]`

Remaining release-readiness blockers:

- `public-wss-deployment-proof`
- `luma-gated-write-coverage`

## Artifacts

- `mesh-production-readiness-report.json`
- `mesh-production-readiness-evidence.md`
- `evidence-scrub-source-report.json`
- `source-reports/`

All files in this directory are copied from the scrubbed promoted packet, not
from raw `.tmp` source evidence.
