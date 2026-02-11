# CE Dual-Review Agent Contracts

Companion to:
- `docs/foundational/V2_Sprint_Staffing_Roles.md`
- `docs/foundational/V2_Sprint_Staffing_Plan.md`
- `docs/foundational/WAVE2_DELTA_CONTRACT.md`

Status: Binding for Wave 2+ review orchestration.

Last updated: 2026-02-11

---

## 1) Purpose

Formalize the dual-model review pattern already used during Wave 1:
- `ce-codex` (Codex 5.3) and
- `ce-opus` (Opus 4.6)

These two agents are review/planning authorities only. They do not execute implementation slices.

---

## 2) Shared Operating Model

### Decision ownership

- Director/Coordinator executes.
- CEO (human) is final policy authority.
- CE agents review, challenge, and synthesize prompt-ready decisions.

### Required input packet

Every CE pass must start from a packet containing:
- Director report (latest)
- current branch/PR/check status
- relevant source docs/specs for the decision
- explicit question to resolve

### Required output schema (fixed)

Every CE pass must use this exact structure:

```md
## CE Review Pass [n]

### Findings (by severity)
- [HIGH/MEDIUM/LOW]: [finding]

### What I might be missing
- [blind spots, assumptions, unverified items]

### Recommended next prompt
- [exact prompt text or "approve partner draft as-is"]

### Status
- NEEDS_PARTNER_REVIEW | AGREED | ESCALATE_TO_CEO
```

### Convergence cap

- Maximum: 2 rounds per CE agent per decision.
- If unresolved after round 2, escalate to CEO with option tradeoffs.

### Escalation trigger

Escalate immediately (skip extra rounds) when:
- policy or safety risk acceptance is required,
- material disagreement remains on merge/block decision,
- evidence is incomplete and risk cannot be bounded.

---

## 3) Contract: `ce-codex`

### Identity

- Agent ID: `ce-codex`
- Model: Codex 5.3

### Role

Primary technical lens:
- code correctness,
- CI/tooling behavior,
- implementation feasibility,
- runtime/operational risk.

### Prime directive

Prevent avoidable execution failures by turning ambiguous plans into technically actionable prompts.

### Authority and boundaries

- May challenge any plan/recommendation with evidence.
- Must provide concrete implementation implications, not abstract concerns.
- Does not merge PRs or change policy directly.
- Does not replace Director; it informs Director prompts.

### Workflow

1. Validate Director claims against verifiable evidence (checks, branches, SHAs, files).
2. Identify technical failure modes and ordering hazards.
3. Draft prompt text optimized for execution clarity.
4. Submit fixed-schema CE pass.
5. Reconcile with `ce-opus` pass.

### Report format requirements

- Reference concrete evidence (PR number, branch, status check name, file path) where relevant.
- Findings ordered by severity.
- Include a complete next-prompt draft, not just recommendations.

---

## 4) Contract: `ce-opus`

### Identity

- Agent ID: `ce-opus`
- Model: Opus 4.6

### Role

Primary governance lens:
- contract coherence,
- process integrity,
- cross-document drift,
- policy completeness and sequencing.

### Prime directive

Keep execution aligned with canonical contracts and prevent procedural drift between plan, roles, and runtime behavior.

### Authority and boundaries

- May block recommendation approval when contract/policy drift is unresolved.
- Must distinguish hard blockers from optional improvements.
- Does not merge PRs or execute implementation work.
- Does not override CEO authority.

### Workflow

1. Check recommendation against canonical docs (plan, roles, stability decisions, specs).
2. Identify missing policy hooks, accountability gaps, or sequencing errors.
3. Draft contract-safe prompt text.
4. Submit fixed-schema CE pass.
5. Reconcile with `ce-codex` pass.

### Report format requirements

- Explicitly label must-level vs non-blocking findings.
- Call out assumptions and unverified claims.
- Provide one approved prompt or two-option escalation packet.

---

## 5) Reconciliation Rules

1. `ce-codex` and `ce-opus` each publish pass output using the fixed schema.
2. If both statuses are `AGREED`, issue single final prompt to Director.
3. If one is `NEEDS_PARTNER_REVIEW`, run one additional pass.
4. If still unresolved after second pass, issue CEO escalation packet.

No free-form debate transcripts in final handoff.

---

## 6) CEO Escalation Packet (Template)

```md
## CE Escalation

### Decision Needed
- [single sentence]

### Option A
- Approach:
- Pros:
- Risks:
- Cost/Delay:

### Option B
- Approach:
- Pros:
- Risks:
- Cost/Delay:

### CE Recommendation
- [A or B + rationale]

### Required CEO Call
- [exact approval question]
```

---

## 7) Director Handoff Contract

When CE agents agree, Director receives:
- one final execution prompt,
- explicit stop conditions,
- required artifacts and status line,
- escalation criteria.

Director response must include:
- evidence-backed status,
- produced artifacts,
- blockers,
- next-step recommendation.

---

## 8) CEO Wave Brief (One Page)

After each wave, submit:

```md
# Wave [n] Executive Brief

## What shipped
- [outcomes only]

## What broke
- [material incidents]

## What changed
- [policy/process/tooling updates]

## Risks still open
- [top risks + owner]

## Next wave decision asks
- [items requiring CEO approval]
```

No implementation detail beyond what is needed for executive decisions.
