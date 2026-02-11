# Wave 2 Document Audit

Date: 2026-02-11  
Scope: Wave 1 -> Wave 2 transition controls and operational docs  
Owner: Coordinator (with CE review inputs from `ce-codex` and `ce-opus`)

## Findings (by severity)

- HIGH: Core staffing/process docs did not explicitly include the CE dual-review loop, creating execution ambiguity for Director-bound prompts.
- HIGH: Wave kickoff runbook remained Wave-1-specific; no dedicated Wave 2 runbook existed.
- MEDIUM: PR template still referenced `integration/wave-1`, increasing risk of target-branch mistakes.
- MEDIUM: Wave 1 kickoff document was still treated as active without freeze guidance.
- MEDIUM: No mandatory wave-end doc-audit artifact was defined in binding policy.

## Drift Matrix

| Area | Expected for Wave 2 | Observed before audit | Remediation |
| --- | --- | --- | --- |
| Staffing roster | CE agents listed in operating cluster docs | CE agents only defined in standalone companion doc | Add CE entries to staffing plan roster/hierarchy/counts |
| Role contracts | CE review loop documented before Director dispatch | Roles doc had no CE gate reference | Add CE gate in interaction summary + explicit dispatch rule |
| Delta policy | Binding policies include CE gate + doc-audit gate | Policies ended at 10; no CE/doc-audit requirement | Add policy 11 and 12 |
| PR controls | Active-wave target branch language | Template hardcoded Wave 1 branch | Update to active-wave target (`integration/wave-2`) |
| Kickoff runbook | Dedicated Wave 2 sheet with runtime constants | Only Wave 1 kickoff sheet existed | Add `WAVE2_KICKOFF_COMMAND_SHEET.md` |
| Historical docs | Wave 1 runbook frozen | Wave 1 sheet appeared active | Add freeze banner to Wave 1 kickoff sheet |
| Status references | Wave 2 control docs listed | CE/W2 control docs absent from refs | Add Wave 2 control-doc references to `STATUS.md` |

## Fix List

1. Update `docs/foundational/V2_Sprint_Staffing_Plan.md` for CE roster/hierarchy/counts and role behavior reference.
2. Update `docs/foundational/V2_Sprint_Staffing_Roles.md` with Wave 2 override banner and CE dual-review flow in Role Interaction Summary.
3. Update `docs/foundational/WAVE2_DELTA_CONTRACT.md` with binding policy 11 (CE gate) and 12 (wave-end doc audit gate).
4. Update `.github/pull_request_template.md` to active-wave target branch language.
5. Update `docs/foundational/STATUS.md` with Wave 2 control-doc references and CE gate mention.
6. Add `docs/foundational/WAVE2_KICKOFF_COMMAND_SHEET.md` as dedicated Wave 2 runbook.
7. Mark `docs/foundational/WAVE1_KICKOFF_COMMAND_SHEET.md` as historical/frozen.

## Status

- Result: `DOC_AUDIT_PASS_PENDING_MERGE`
- Condition to flip to `DOC_AUDIT_PASS`: merge of this audit sweep PR to `integration/wave-2`.
- Dispatch rule: no new wave dispatch until `DOC_AUDIT_PASS` is recorded on merged branch (except break/fix emergency with logged rationale).
