# StoryCluster Qdrant Production Headless Validation

Date: 2026-03-07
Branch: coord/storycluster-takeover

Command:

```bash
NODE_ENV=production \
VH_STORYCLUSTER_VECTOR_BACKEND=qdrant \
VH_STORYCLUSTER_QDRANT_URL=http://127.0.0.1:6333 \
pnpm --filter @vh/storycluster-engine exec vitest run src/__live_qdrant__.test.ts --config ./vitest.config.ts --reporter=verbose
```

Environment:
- OpenAI provider active via `OPENAI_API_KEY`
- Qdrant active via `http://127.0.0.1:6333`
- Docker image: `qdrant/qdrant:v1.13.6`

Results:
- Same-topic trap dataset: PASS
- Dataset docs: 7
- Bundles produced: 4
- Expected events: 4
- Contamination rate: 0
- Fragmentation rate: 0
- Coherence score: 1.0
- Follow-up identity: preserved
- Follow-up source growth: `wire-a`, `wire-b`, `wire-c`
- Follow-up `cluster_window_end`: 110 -> 130

Observed first bundle:
- `story_id`: `story-3a19b89a4eb0`
- `topic_id`: `3c4a4d6da80e27b4af9510cd8bfd359ca386315847599b76c0f9b2c33d17fd09`
- `headline`: `Officials say recovery talks begin Friday after port attack`

Observed follow-up bundle:
- `story_id`: `story-3a19b89a4eb0`
- `topic_id`: `3c4a4d6da80e27b4af9510cd8bfd359ca386315847599b76c0f9b2c33d17fd09`
- `headline`: `Insurers warn delays will continue after port attack`

Relevant stage metrics from follow-up tick:
- `qdrant_candidate_retrieval.candidates_considered = 1`
- `qdrant_candidate_retrieval.candidates_retained = 1`
- `cross_encoder_rerank.reranked_pairs = 1`
- `llm_adjudication.adjudicated_docs = 0`
- `dynamic_cluster_assignment.clusters_updated = 1`
- `summarize_publish_payloads.summaries_generated = 1`
