# Mesh Production Readiness Evidence Packet

- Run ID: `mesh-production-readiness-20260517T112019Z-1210485a`
- Status: `blocked`
- Commit: `438f3362fa0db6127e071ec3a757f3998919ac44`
- Dirty: `false`
- Schema epoch: `post_luma_m0b`
- LUMA profile: `none`
- Report: `./.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/mesh-production-readiness-report.json`
- LUMA coverage report: `./supporting-evidence/luma-gated-write-coverage/mesh-luma-gated-write-coverage-report.json`

## Source Reports

| Gate | Gate status | Source report status | Command | Copied report |
|---|---|---|---|---|
| topology | pass | review_required | `pnpm test:mesh:topology-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/topology/mesh-production-readiness-report.json` |
| signed_peer_config | pass | review_required | `pnpm test:mesh:signed-peer-config-canary` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/signed_peer_config/mesh-production-readiness-report.json` |
| deployed_wss | fail | blocked | `pnpm test:mesh:deployed-wss-peer-config` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/deployed_wss/mesh-production-readiness-report.json` |
| state_resolution | pass | review_required | `pnpm test:mesh:state-resolution-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/state_resolution/mesh-production-readiness-report.json` |
| disconnect | pass | review_required | `pnpm test:mesh:disconnect-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/disconnect/mesh-production-readiness-report.json` |
| partition | pass | review_required | `pnpm test:mesh:partition-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/partition/mesh-production-readiness-report.json` |
| read_repair | pass | review_required | `pnpm test:mesh:read-repair-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/read_repair/mesh-production-readiness-report.json` |
| soak | pass | review_required | `pnpm test:mesh:soak` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/soak/mesh-production-readiness-report.json` |
| peer_config_rollback | fail | review_required | `pnpm test:mesh:peer-config-rollback-drill` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/peer_config_rollback/mesh-production-readiness-report.json` |
| clock_skew | pass | review_required | `pnpm test:mesh:clock-skew-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/clock_skew/mesh-production-readiness-report.json` |
| conflict | pass | review_required | `pnpm test:mesh:conflict-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260517T112019Z-1210485a/source-reports/conflict/mesh-production-readiness-report.json` |

## Release-Ready Blockers

| Blocker | Command / future gate | Reason |
|---|---|---|
| public-wss-deployment-proof | `pnpm test:mesh:deployed-wss-peer-config:public` | current WSS evidence is the hermetic local TLS profile or a blocked public proof, not passing public WSS infrastructure evidence |
| evidence-scrub-promotion | `pnpm check:mesh-evidence-scrub` | candidate aggregate packet has not passed deterministic evidence scrub and promoted-packet rescan |

## Allowed Claims



## Forbidden Claims

- The Mesh is release_ready.
- The full app is test-group ready.
- The production app canary passed.
- Downstream app surfaces were observed end-to-end.
- LUMA profile gates or LUMA gate behavior passed through the production app canary.
- LUMA-gated production write authorization, custody, signer, or auth behavior is proven beyond durable LUMA reader-path coverage.
- Public WSS conflict, partition/heal, clock-skew, rollback, or soak behavior is production-proven by the public WSS proof alone.
- The default shortened local soak satisfies the canonical 1800000ms soak claim.
- Public WSS infrastructure is production-proven.
- The separate production app canary cleared downstream full-app readiness.
