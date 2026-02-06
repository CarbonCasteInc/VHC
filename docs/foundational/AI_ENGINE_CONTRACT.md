# AI Engine & Analysis Contract

Version: 0.1  
Status: Canonical for Sprints 2–3  
Implementation note (2026-02-02): Worker currently uses a mock engine; real engine wiring is pending and defaults to `local-only`.

Defines the contract between raw article text, AI engines (remote/local), JSON responses, validation/guardrails, and `CanonicalAnalysisV1` objects.

## 1. Purpose

Create a precise, engine-agnostic pipeline: prompt → engine → JSON → validation/guardrails → canonical analysis. Swapping engines must not change the canonical contract.

## 2. Prompt Contract

`buildPrompt(articleText: string) -> string` (in `packages/ai-engine/src/prompts.ts`):
- Inlines GOALS/GUIDELINES for summary + bias detection (see Sprint 2 §2.2).
- Specifies output wrapper:
  - `step_by_step: string[]`
  - `final_refined: AnalysisResult`
- Surrounds the article with `ARTICLE_START` / `ARTICLE_END`.

## 3. Engine Interface & Policy

- `JsonCompletionEngine`: `{ id, kind: 'remote' | 'local', modelName, completeJson(prompt) }`.
- `EnginePolicy`: `remote-first`, `local-first`, `remote-only`, `local-only`, `shadow`.
- `EngineRouter.run(articleText)`: generates prompt, selects engine per policy, returns `{ raw, engine }`.
- Migration: Season 0 prod = `local-only` by default; `remote-*` requires explicit user opt-in. `local-first` / `shadow` are roadmap targets.

## 4. JSON Schema & Parsing

- Expected wrapper (new engines MUST support):
```jsonc
{
  "step_by_step": ["..."],
  "final_refined": {
    "summary": "...",
    "bias_claim_quote": ["..."],
    "justify_bias_claim": ["..."],
    "biases": ["..."],
    "counterpoints": ["..."],
    "sentimentScore": 0.0,
    "confidence": 0.0
  }
}
```
- Back-compat: bare `AnalysisResult` accepted but discouraged.
- `AnalysisResultSchema` mirrors `canonical-analysis-v1`.
- `parseAnalysisResponse(raw)` supports wrapped + bare; errors: `NO_JSON_OBJECT_FOUND`, `JSON_PARSE_ERROR`, `SCHEMA_VALIDATION_ERROR`.

## 5. Hallucination Guardrails

- `validateAnalysisAgainstSource(articleText, analysis)`:
  - `bias_claim_quote` entries must appear in the article.
  - Simple time/date sanity checks (e.g., years).
- Emits `warnings[]`; non-fatal.

## 6. Canonicalization

- Build `CanonicalAnalysisV1` from validated `AnalysisResult` plus:
  - `engine` provenance `{ id, kind, modelName }`.
  - `warnings`.
- Validate with `CanonicalAnalysisSchema` (see `docs/specs/canonical-analysis-v1.md`); persist via mesh/First-to-File logic (v1).
- Planned v2 will shift canonicalization to quorum synthesis (see `docs/specs/canonical-analysis-v2.md`).

## 7. Failure Modes & Logging

- Engine failure → fallback per `EnginePolicy`.
- Parse failure → `AnalysisParseError` surfaced to worker caller.
- Guardrail warnings attached (non-fatal).
- Shadow mode: log/compare primary vs shadow outputs for evaluation.

## 8. Familiar Runtime Appendix

- Familiars may act as **job runners** for analysis generation, but outputs MUST flow through the same prompt → JSON → validation pipeline.
- Free-form tool use in the analysis path is forbidden unless explicitly scoped by a `DelegationGrant` and logged locally.
- Remote engine use requires explicit user opt-in; default remains `local-only`.

## 9. Test Matrix

- Prompt tests: required keys present; article enclosed.
- EngineRouter tests: policy behaviors, fallbacks.
- Schema tests: valid/invalid payloads; wrapper + bare.
- Validation tests: quote/year mismatches generate warnings.
- Worker integration: end-to-end success, parse error paths, caching.

Note: `CanonicalAnalysis` objects are public analyses; engine outputs MUST NOT include identity or constituency data.
