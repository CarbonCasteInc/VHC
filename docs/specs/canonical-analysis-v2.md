# canonical-analysis-v2 Contract (Quorum Synthesis)

**Status:** Planned (Direction Locked)  
**Owner:** VENN Engine / Data Model  
**Reference:** `System_Architecture.md` §6.3, `docs/specs/canonical-analysis-v1.md`

## 1. Goals

- Mitigate first-to-file poisoning by requiring a quorum of candidate analyses.
- Preserve transparency: show agreement vs. divergence across candidates.
- Keep canonical analyses public, identity-free, and reproducible from source text.
- Ensure early candidate analyses explicitly critique and refine summaries/tables against the source text for accuracy.

## 2. Default Parameters (v2)

- `quorumSize`: 5
- `timeoutMs`: 24h (`86_400_000`)
- `challengeWindowMs`: 7d (`604_800_000`)
- `weighting`: `equal` (trust-weighted is optional)

## 3. Type Definition

> `AnalysisResult` is the same contract as v1 (see `docs/specs/canonical-analysis-v1.md`).

```typescript
export interface CandidateAnalysis {
  id: string;              // Hash of candidate payload
  urlHash: string;
  analysis: AnalysisResult;
  engine?: {
    id: string;            // 'remote-gateway', 'local-mlc', etc.
    kind: 'remote' | 'local';
    modelName: string;
  };
  warnings?: string[];     // Guardrail warnings (non-fatal)
  createdAt: number;       // ms since epoch
}

export interface DivergencePoint {
  topic: string;           // e.g., "cause", "intent", "impact"
  positions: Array<{
    candidateId: string;
    stance: string;        // Short description of the candidate's position
  }>;
}

export interface QuorumMeta {
  quorumSize: number;      // Default: 5
  timeoutMs: number;       // Default: 24h
  reachedAt: number;       // When quorum reached or timeout elapsed
  candidateCount: number;  // How many candidates were collected
  weighting: 'equal' | 'trust-weighted';
}

export interface CanonicalAnalysisV2 {
  schemaVersion: 'canonical-analysis-v2';
  url: string;
  urlHash: string;
  timestamp: number;       // ms since epoch (canonicalization time)

  // Quorum metadata
  quorum: QuorumMeta;
  candidateIds: string[];  // IDs of candidates included in synthesis

  // Canonical synthesis output
  synthesis: AnalysisResult;
  divergence: DivergencePoint[];

  // Optional supersession
  supersedes?: string;     // analysis_id of previous canonical record
  supersededAt?: number;   // ms since epoch
}
```

## 4. Quorum Flow

### 4.1 Candidate Gathering

- The first open of a new `urlHash` creates a **candidate analysis** and writes it to:
  - `vh/analyses/<urlHash>/candidates/<candidateId>`
- Subsequent opens continue adding candidates until:
  - `candidateCount >= quorumSize`, or
  - `timeoutMs` elapses (default 24h).
- Candidate submission stops once a canonical v2 record exists.
- **Verified-only:** candidate submission requires a verified human session (principal nullifier). Familiars may submit only on behalf of a verified principal and consume the same budgets.
- **Accuracy mandate:** each candidate analysis MUST:
  - Re-read the original article/post.
  - Critique and refine prior candidate summaries/bias tables for accuracy.
  - Preserve the right to disagree; candidates should not be forced to converge.

### 4.2 Synthesis

- When quorum is reached (or timeout triggers):
  - A synthesis engine compares candidate analyses to the source text.
  - It produces `synthesis` (an `AnalysisResult`) plus a `divergence` table.
- Divergence is surfaced as perspectives rather than hidden disagreement.

### 4.3 Periodic Re-Synthesis (Comment-Driven)

- After canonicalization, the analysis is refreshed after every **N verified comments** on the linked thread.
- Defaults:
  - `N = 10` verified comments since the last synthesis.
  - Minimum **3 unique verified principals** since the last synthesis.
  - Debounce: at most one re-synthesis per **30 minutes**.
  - Daily cap: **4** re-syntheses per topic.
- Re-synthesis produces a new canonical record that **supersedes** the prior version.

### 4.4 Canonicalization

- The canonical record is written to:
  - `vh/analyses/<urlHash>` (schemaVersion `canonical-analysis-v2`).
- The canonical `analysis_id` remains the hash of the canonical analysis object.

### 4.5 Challenge & Supersession (Planned)

- A challenge window (default 7 days / `604_800_000` ms) allows supersession if new evidence emerges.
- Superseding records include `supersedes` + `supersededAt` and replace the canonical pointer.
- Previous canonical records may be archived under:
  - `vh/analyses/<urlHash>/versions/<analysisId>`

## 5. Invariants

- No identity or constituency fields in candidates or canonical records.
- `candidateIds.length === quorum.candidateCount`.
- Canonical synthesis MUST reference the source article only (fact-only rule).
- Divergence entries MUST reference existing `candidateId`s.

## 6. Privacy & Replication

- Candidate and canonical analyses are public analyses of public articles.
- Replication to mesh is allowed in plaintext under `vh/analyses/*`.
- If a user opts out of sharing, candidates may remain local only, but quorum may not be reached.

## 7. Testing Requirements

- Candidate pool: add, dedupe, and stop on quorum/timeout.
- Synthesis: produces valid `AnalysisResult` + divergence table.
- Canonicalization: `CanonicalAnalysisV2` validates and is immutable until superseded.
- Supersession: new canonical replaces pointer and references `supersedes`.
