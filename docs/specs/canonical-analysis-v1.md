# canonical-analysis-v1 (DEPRECATED)

Status: Deprecated, legacy compatibility only
Owner: VENN Engine / Data Model
Effective date: 2026-02-08

`canonical-analysis-v1` remains supported only to read existing URL-keyed records.
It is not the canonical build target for Season 0.

Canonical target is now `topic-synthesis-v2` in `docs/specs/topic-synthesis-v2.md`.

## 1. Deprecation policy

1. New product features must not depend on first-to-file URL analysis.
2. New sentiment/discussion identifiers must use `{topic_id, epoch, synthesis_id}`.
3. V1 objects may be read and mapped into TopicId for migration.
4. No new public write paths should be introduced for v1 objects.

## 2. Legacy shape (read-only compatibility)

```ts
interface CanonicalAnalysisV1 {
  schemaVersion: 'canonical-analysis-v1';
  url: string;
  urlHash: string;
  summary: string;
  bias_claim_quote: string[];
  justify_bias_claim: string[];
  biases: string[];
  counterpoints: string[];
  perspectives?: Array<{ frame: string; reframe: string }>;
  sentimentScore: number;
  confidence?: number;
  engine?: {
    id: string;
    kind: 'remote' | 'local';
    modelName: string;
  };
  warnings?: string[];
  timestamp: number;
}
```

## 3. Migration guidance

- Existing records may be projected into topic cards for backward compatibility.
- Migration should derive a `TopicId` and create v2 synthesis epochs as soon as eligible inputs are available.
- V1 and V2 can coexist during migration windows, but V2 must own canonical routing and UI.
