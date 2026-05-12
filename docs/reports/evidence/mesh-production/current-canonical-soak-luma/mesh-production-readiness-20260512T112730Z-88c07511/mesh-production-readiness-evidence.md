# Mesh Production Readiness Evidence Packet

- Run ID: `mesh-production-readiness-20260512T112730Z-88c07511`
- Status: `review_required`
- Commit: `d72f675055a107213fa00e7c0fa2593b86ef39b5`
- Dirty: `false`
- Schema epoch: `post_luma_m0b`
- LUMA profile: `none`
- Report: `./.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/mesh-production-readiness-report.json`
- LUMA coverage report: `./supporting-evidence/luma-gated-write-coverage/mesh-luma-gated-write-coverage-report.json`

## Source Reports

| Gate | Gate status | Source report status | Command | Copied report |
|---|---|---|---|---|
| topology | pass | review_required | `pnpm test:mesh:topology-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/topology/mesh-production-readiness-report.json` |
| signed_peer_config | pass | review_required | `pnpm test:mesh:signed-peer-config-canary` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/signed_peer_config/mesh-production-readiness-report.json` |
| deployed_wss | pass | review_required | `pnpm test:mesh:deployed-wss-peer-config` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/deployed_wss/mesh-production-readiness-report.json` |
| state_resolution | pass | review_required | `pnpm test:mesh:state-resolution-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/state_resolution/mesh-production-readiness-report.json` |
| disconnect | pass | review_required | `pnpm test:mesh:disconnect-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/disconnect/mesh-production-readiness-report.json` |
| partition | pass | review_required | `pnpm test:mesh:partition-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/partition/mesh-production-readiness-report.json` |
| read_repair | pass | review_required | `pnpm test:mesh:read-repair-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/read_repair/mesh-production-readiness-report.json` |
| soak | review_required | review_required | `pnpm test:mesh:soak` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/soak/mesh-production-readiness-report.json` |
| peer_config_rollback | pass | review_required | `pnpm test:mesh:peer-config-rollback-drill` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/peer_config_rollback/mesh-production-readiness-report.json` |
| clock_skew | pass | review_required | `pnpm test:mesh:clock-skew-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/clock_skew/mesh-production-readiness-report.json` |
| conflict | pass | review_required | `pnpm test:mesh:conflict-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/conflict/mesh-production-readiness-report.json` |
| evidence_scrub | pass | pass | `pnpm check:mesh-evidence-scrub -- --source-dir .tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T112730Z-88c07511/source-reports/evidence_scrub/mesh-production-readiness-report.json` |

## Release-Ready Blockers

| Blocker | Command / future gate | Reason |
|---|---|---|
| public-wss-deployment-proof | `pnpm test:mesh:deployed-wss-peer-config:public` | current WSS evidence is the hermetic local TLS profile or a blocked public proof, not passing public WSS infrastructure evidence |
| required-write-class-sample-floors | `pnpm check:mesh:production-readiness` | required write/resource SLO sample floors are insufficient_samples: resource_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/relay_open_sockets_file_descriptors, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/aggregate snapshot, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/daemon story/synthesis publication, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/encrypted sentiment outbox, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/forum comment, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/forum thread, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/health probe write/readback, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/topic engagement actor/summary, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/vote intent materialization, write_class_slos:soak/mesh-soak-20260512T113527Z-ebb61d49/vote intent materialization (web pwa app client) |

## Allowed Claims

- Existing implemented Mesh proof commands can be rerun and aggregated into one evidence packet with source reports, copied artifacts, current commit metadata, dirty state, and explicit release blockers.
- The local non-LUMA Mesh clock-skew/auth-window matrix source gate passed for applicable mesh surfaces.
- The local non-LUMA Mesh conflict/protocol fixture source gate passed for applicable synthetic rows.

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
