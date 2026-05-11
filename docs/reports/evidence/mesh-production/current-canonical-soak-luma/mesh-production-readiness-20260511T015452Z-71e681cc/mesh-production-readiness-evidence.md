# Mesh Production Readiness Evidence Packet

- Run ID: `mesh-production-readiness-20260511T015452Z-71e681cc`
- Status: `release_ready`
- Commit: `6db6319f54cfe64885eff176945065aaea9d57ea`
- Dirty: `false`
- Schema epoch: `post_luma_m0b`
- LUMA profile: `none`
- Report: `./.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/mesh-production-readiness-report.json`
- LUMA coverage report: `./supporting-evidence/luma-gated-write-coverage/mesh-luma-gated-write-coverage-report.json`

## Source Reports

| Gate | Gate status | Source report status | Command | Copied report |
|---|---|---|---|---|
| topology | pass | review_required | `pnpm test:mesh:topology-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/topology/mesh-production-readiness-report.json` |
| signed_peer_config | pass | review_required | `pnpm test:mesh:signed-peer-config-canary` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/signed_peer_config/mesh-production-readiness-report.json` |
| deployed_wss | pass | review_required | `pnpm test:mesh:deployed-wss-peer-config` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/deployed_wss/mesh-production-readiness-report.json` |
| state_resolution | pass | review_required | `pnpm test:mesh:state-resolution-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/state_resolution/mesh-production-readiness-report.json` |
| disconnect | pass | review_required | `pnpm test:mesh:disconnect-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/disconnect/mesh-production-readiness-report.json` |
| partition | pass | review_required | `pnpm test:mesh:partition-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/partition/mesh-production-readiness-report.json` |
| read_repair | pass | review_required | `pnpm test:mesh:read-repair-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/read_repair/mesh-production-readiness-report.json` |
| soak | pass | review_required | `pnpm test:mesh:soak` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/soak/mesh-production-readiness-report.json` |
| peer_config_rollback | pass | review_required | `pnpm test:mesh:peer-config-rollback-drill` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/peer_config_rollback/mesh-production-readiness-report.json` |
| clock_skew | pass | review_required | `pnpm test:mesh:clock-skew-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/clock_skew/mesh-production-readiness-report.json` |
| conflict | pass | review_required | `pnpm test:mesh:conflict-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/conflict/mesh-production-readiness-report.json` |
| evidence_scrub | pass | pass | `pnpm check:mesh-evidence-scrub -- --source-dir .tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260511T015452Z-71e681cc/source-reports/evidence_scrub/mesh-production-readiness-report.json` |

## Release-Ready Blockers

| Blocker | Command / future gate | Reason |
|---|---|---|


## Allowed Claims

- Existing implemented mesh proof commands can be rerun and aggregated into one local evidence packet.
- The aggregate packet identifies source reports, copied artifacts, current commit, dirty state, and unresolved release blockers.
- The local non-LUMA mesh clock-skew/auth-window matrix source gate passed for applicable mesh surfaces.
- The local non-LUMA mesh conflict/protocol fixture source gate passed for applicable synthetic rows.

## Forbidden Claims

- The mesh is release_ready.
- The default shortened local soak satisfies the canonical thirty-minute soak claim.
- Public WSS infrastructure is production-proven.
- Public WSS clock-skew behavior is production-proven.
- Public WSS conflict behavior is production-proven.
- LUMA-gated production write classes are mesh-readiness-proven.
- The full app is test-group ready.
