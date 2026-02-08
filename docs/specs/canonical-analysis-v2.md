# canonical-analysis-v2 (Compatibility Alias)

Status: Compatibility alias
Owner: VENN Engine / Data Model

This document is retained for backward references.
Canonical Season 0 V2 behavior is specified in:

- `docs/specs/topic-synthesis-v2.md`

## Mapping

- `canonical-analysis-v2` canonical object -> `TopicSynthesisV2`
- `analysis_id` -> `synthesis_id`
- URL-only input model -> `StoryBundle` / `TopicDigest` / `TopicSeed`
- first-to-file progression -> epoch + quorum deterministic selection

Any new implementation work should use `topic-synthesis-v2` directly.
