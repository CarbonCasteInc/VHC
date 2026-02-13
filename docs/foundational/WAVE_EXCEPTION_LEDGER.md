# Wave Exception Ledger

Canonical register for all policy exceptions across waves.

Each entry must include: ID, policy reference, rationale, blast radius, owner, opened/closed dates, and retirement evidence. Exceptions without closure evidence remain open.

---

## EX-001: Policy 4 Serialized Merge Fallback

| Field | Value |
|---|---|
| ID | EX-001 |
| Policy | WAVE2_DELTA_CONTRACT.md Policy 4 (merge queue mandatory) |
| Status | **CLOSED** |
| Opened | 2026-02-10 |
| Opened by | Coordinator |
| Rationale | GitHub merge queue was unavailable on `HumblePiCCI/VHC` free-tier org. Serialized merge (one PR at a time, manual rebase) was used as fallback to maintain ordering safety. |
| Blast radius | Throughput reduction on concurrent PRs; additional coord PRs for rebase sequencing. No code safety impact. |
| Rollback plan | If merge queue became available, retire exception and switch to queue-first flow. |
| Follow-up owner | Coordinator |
| Closed | 2026-02-12 |
| Closure evidence | Repo transferred to `CarbonCasteInc/VHC` (org account). Merge queue enabled via ruleset 12741087 on `integration/wave-2`. PR #204 transited merge queue end-to-end (merge commit `d7bb701`, queue CI run `21942823519`). Policy 4 exception document (`docs/reports/WAVE2_POLICY4_EXCEPTION.md`) updated to `RESOLVED — MERGE_QUEUE_ENABLED`. |

---

## Template (copy for new exceptions)

```md
## EX-NNN: [Short title]

| Field | Value |
|---|---|
| ID | EX-NNN |
| Policy | [doc path + policy number] |
| Status | **OPEN** / **CLOSED** |
| Opened | [date] |
| Opened by | [agent/role] |
| Rationale | [why exception is needed] |
| Blast radius | [what is affected] |
| Rollback plan | [how to undo if conditions change] |
| Follow-up owner | [who tracks closure] |
| Closed | [date or "—"] |
| Closure evidence | [links/SHAs/artifacts or "—"] |
```
