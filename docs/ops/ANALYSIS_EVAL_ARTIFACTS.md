# Analysis Eval Artifacts

> Status: Operational Runbook (Canonical)
> Owner: VHC Core Engineering
> Last Reviewed: 2026-05-01
> Depends On: docs/foundational/STATUS.md, docs/specs/topic-synthesis-v2.md, docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md

This runbook defines how publish-time story analysis outputs are captured for
QA, evaluation, and later supervised-data review.

## Policy

Analysis artifacts are weak labels until a human reviews them.

Do not train a model recursively on unreviewed generated summaries, facts, or
frame/reframe rows. Raw extracted article text is persisted for product
quality and evaluation, but training on full article text requires a separate
legal and rights policy. Safer training targets are reviewed structured facts,
reviewed summaries, reviewed frame labels, and citations back to source spans.

Every artifact is written with:

- `usage_policy.label_status = weak_label_unreviewed`
- `usage_policy.training_state = not_training_ready`
- `usage_policy.raw_article_text_training_use = requires_rights_review`
- `usage_policy.generated_output_training_use = weak_label_only_until_reviewed`

## What Is Captured

Schema version: `analysis-eval-artifact-v1`.

The artifact contains:

- raw extracted article text and extraction metadata;
- source URL, source ID, publisher, title, URL/content hashes, timestamp, and
  extraction method/version;
- story/bundle IDs, singleton/bundle classification, and source membership;
- analysis and bundle prompts, prompt hashes, response model, response content,
  temperature, token budget, timeout, rate limit, and pipeline version;
- generated per-article facts, summaries, bias claims, justifications, and
  perspective rows;
- generated bundle facts, summary, and frame/reframe table;
- validator events, failures, warnings, and retry count;
- persisted `CandidateSynthesis` and final accepted `TopicSynthesisV2` when
  the run is accepted;
- human-review placeholders for edits, approvals, rejections, and user-facing
  corrections.

Rejected runs are captured when at least one full-text article was extracted
and the worker reaches article-analysis or bundle-synthesis validation.

## Runtime Controls

Server-side environment variables:

- `VH_ANALYSIS_EVAL_ARTIFACTS_ENABLED=true` enables artifact persistence.
- `VH_ANALYSIS_EVAL_ARTIFACT_DIR=/path/to/dir` sets the output directory.
  Default: `.tmp/analysis-eval-artifacts` relative to the daemon process.
- `VH_BUNDLE_SYNTHESIS_TEMPERATURE=0.2` overrides the bundle-synthesis relay
  temperature recorded in artifacts and sent to the relay.

The deterministic local analysis lane enables artifact collection by default:

```bash
pnpm live:stack:up:analysis-stub
```

Default output:

```text
/Users/bldt/Desktop/VHC/VHC/.tmp/analysis-eval-artifacts/
  analysis-eval-artifacts.jsonl
  artifacts/analysis-eval:<hash>.json
```

The JSONL file is a compact index. The per-artifact JSON file contains full
prompts, raw extracted text, generated outputs, and review placeholders.

## Review Workflow

1. Treat new artifacts as QA/eval evidence, not training examples.
2. Review source extraction quality before judging generated facts.
3. Compare generated facts and summaries against article text only.
4. Move framing, blame, advocacy, and stakeholder claims into the
   frame/reframe table rather than accepting them in factual summaries.
5. Record human edits, approvals, rejections, and user-facing corrections in
   the artifact or its downstream review store before marking any data
   training-ready.
6. Train only on the final accepted synthesis and reviewed structured labels
   unless legal review explicitly permits article-text training.
