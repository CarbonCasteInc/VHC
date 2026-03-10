# StoryCluster Quality Gate Summary

Date: 2026-03-07
Branch: coord/storycluster-takeover

Command:

```bash
pnpm test:storycluster:quality
```

Gate coverage:
- fail-closed vector backend behavior
- server production-path behavior
- stage-runner identity continuity
- deterministic coherence audit
- expanded fixture benchmark corpus
- replay persistence / fragmentation / contamination gate

Results:
- command status: PASS
- test files: 5
- tests: 27

Fixture benchmark summary:
- dataset count: 9
- max contamination rate: 0
- max fragmentation rate: 0
- avg coherence score: 1.0

Replay benchmark summary:
- dataset count: 3
- max contamination rate: 0
- max fragmentation rate: 0
- avg coherence score: 1.0
- story_id persistence rate: 1.0
- persistence observations: 8
- persistence retained: 8

Thresholds enforced:
- fixtures: contamination <= 0.02, fragmentation <= 0.05, coherence >= 0.93
- replay: contamination <= 0.05, fragmentation <= 0.08, coherence >= 0.88
- persistence: >= 0.99

Live sampled-corpus benchmark:
- command status: PASS
- provider path: OpenAI + Qdrant production wiring
- artifact root: `/Users/bldt/Desktop/VHC/VHC/docs/reports/evidence/storycluster/live/2026-03-07/sampled-corpus-224928Z`
- fixture datasets: 8
- replay scenarios: 4
- fixture max contamination rate: 0
- fixture max fragmentation rate: 0
- fixture avg coherence score: 1.0
- replay max contamination rate: 0
- replay max fragmentation rate: 0
- replay avg coherence score: 1.0
- replay story_id persistence rate: 1.0
- replay persistence observations: 11
- replay persistence retained: 11
