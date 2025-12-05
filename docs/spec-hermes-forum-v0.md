# HERMES Forum Spec (v0)

**Version:** 0.2
**Status:** Implementation In-Progress (Dec 5, 2025)
**Context:** Public, threaded civic discourse for TRINITY OS.

> **ERRATA (Dec 5, 2025):** v0.2 adds hydration, real-time subscriptions, vote persistence, deduplication, and index usage requirements based on messaging implementation learnings.

---

## 1. Core Principles

1.  **The Agora:** A public square for debate. Accessible to all, navigable from the global header.
2.  **Structured Debate:** Not just comments, but **Counterpoints**.
3.  **Sybil Resistance:** Posting and voting requires a verified `TrustScore` (e.g., ≥0.5).
4.  **Community Moderation:** Visibility is driven by `CivicXP` weighted voting and `CivicDecay`.

---

## 2. Data Model

### 2.1 Thread Schema
```typescript
interface Thread {
  id: string;               // UUID
  schemaVersion: 'hermes-thread-v0';
  title: string;            // ≤ 200 chars
  content: string;          // Markdown, ≤ 10,000 chars
  author: string;           // Author's Nullifier (identity key)
  timestamp: number;        // Unix timestamp (ms)
  tags: string[];           // e.g., ["Infrastructure", "Proposal"]
  
  // Optional: Link to VENN analysis
  sourceAnalysisId?: string; // Link to CanonicalAnalysis.topic_id or analysis_id
  
  // Engagement (raw counts, canonical)
  upvotes: number;
  downvotes: number;
  score: number;            // Computed: (upvotes - downvotes) * decayFactor
}
```

### 2.2 Comment Schema
```typescript
interface Comment {
  id: string;               // UUID
  schemaVersion: 'hermes-comment-v0';
  threadId: string;
  parentId: string | null;  // null if top-level reply to thread
  
  content: string;          // Markdown, ≤ 10,000 chars
  author: string;           // Author's Nullifier
  timestamp: number;
  
  // Type: distinguishes normal replies from counterpoints
  type: 'reply' | 'counterpoint';
  
  // For Counterpoints: the target being countered
  // Required when type === 'counterpoint', omitted for normal replies
  targetId?: string;
  
  // Engagement (raw counts, canonical)
  upvotes: number;
  downvotes: number;
}
```

**Note:** There is no separate `Counterpoint` interface; the `Comment` type with `type: 'counterpoint'` covers this use case. For counterpoints, `targetId` must be set; for replies, it should be omitted or null.

### 2.3 Content Size Limits

Client-side validation and Zod schemas enforce:
*   `title`: ≤ 200 characters.
*   `content` (thread or comment): ≤ 10,000 characters.
*   UI should truncate long content with "Show more" expansion.

---

## 3. UI & UX

### 3.1 The Feed
*   **Global View:** List of threads sorted by `Hot`, `New`, or `Top`.
*   **Navigation:** Forum is accessed under the HERMES section of the app (e.g., `/hermes/forum`), not under AGORA/governance.

**HERMES vs AGORA Distinction:**
*   **HERMES** = Communications layer: Messaging (DMs) + Forum (public civic discourse).
*   **AGORA** = Governance & projects (Sprint 4+): Collaborative document editing, project/policy development, decision-making.
*   Forum threads can be elevated into AGORA projects in future sprints (based on engagement, upvotes, tags).

### 3.2 The Discussion View
*   **Standard Replies:** Nested tree structure (Reddit style).
*   **Counterpoints (Side-by-Side):**
    *   If a comment has a `counterpoint` child, the UI renders a split view.
    *   **Left:** Original Argument.
    *   **Right:** The Counterpoint(s).
    *   **Source:** Counterpoints can be user-generated (flagged replies) OR AI-generated (linked to Analysis summaries).
*   **Content Sanitization:** All content (Markdown) must be sanitized before rendering (strip scripts, dangerous HTML) using a whitelisted renderer. This prevents XSS and injection attacks.

### 3.3 Score & Hot Ranking

**Decay Formula:**
```typescript
function computeThreadScore(thread: Thread, now: number): number {
  const ageHours = (now - thread.timestamp) / 3600_000;
  // λ chosen so decayFactor ≈ 0.5 at 48h
  // Half-life = ln(2) / λ = 48h → λ ≈ 0.0144
  const λ = 0.0144;
  const decayFactor = Math.exp(-λ * ageHours);
  return (thread.upvotes - thread.downvotes) * decayFactor;
}
```

**Sorting Options:**
*   **Hot:** Descending `score` (computed with decay).
*   **New:** Descending `timestamp`.
*   **Top:** Descending `(upvotes - downvotes)` (no decay applied).

---

## 4. Sybil Resistance & Moderation

### 4.1 Gating
*   **Read:** Open to all (Public).
*   **Write/Vote:** Requires `TrustScore >= 0.5` (Verified Human).
*   **Anonymous Mode (Future):** "Sister Forum" for low-trust/anon accounts (no legislative weight).

**UI Enforcement:** If `useIdentity().trustScore < 0.5`, disable "New Thread", "Reply", "Counterpoint", and all vote buttons. Show a "Verify identity to participate" message on interaction attempt.

### 4.2 Voting Power

**Raw Vote Storage (Canonical):**
*   **1 Person = 1 Vote:** Store raw `upvotes` / `downvotes` counts. No weighting at the storage layer.

**One-Vote-Per-User Semantics:**
*   For each `(user, targetId)` (thread or comment), only a single up/down/neutral vote is allowed.
*   Updating a vote overwrites the previous one; canonical `upvotes` / `downvotes` reflect the latest state.
*   Vote state per user: `{ targetId: 'up' | 'down' | null }`. Null = no vote / retracted.

**Vote State Persistence (CRITICAL):**
*   Vote state MUST be persisted to prevent double-voting after page refresh.
*   **v0 (localStorage):** Store per-identity: `vh_forum_votes:<nullifier>` → `Record<targetId, 'up' | 'down' | null>`
*   **v1+ (Gun authenticated):** `~<devicePub>/forum/votes/<targetId>` for cross-device sync.
*   On app init, load vote state from localStorage before allowing any vote actions.
*   On vote change, immediately persist to localStorage.

**XP Weighting (Optional v0, Derived View Only):**
*   XP-weighted voting is a **derived view only** in v0.
*   Canonical stored fields remain raw `upvotes` / `downvotes`.
*   XP-weighted scores are computed **on-device** using the local XP ledger:
    ```typescript
    // Example: Simple monotonic weight function
    function xpWeight(civicXP: number, tag: string): number {
      const tagXP = getTagXP(civicXP, tag); // e.g., XP for "Infrastructure"
      return 1 + Math.log10(1 + tagXP);
    }
    
    // Weighted score (client-only, not stored)
    const weightedScore = votes.reduce((sum, vote) => {
      return sum + Math.sign(vote.value) * xpWeight(vote.userCivicXP, thread.tags[0]);
    }, 0);
    ```
*   **Privacy:** Never store per-nullifier XP alongside content in Gun. XP reads come from the local XP ledger only.

### 4.3 Moderation
*   **Default:** Community driven. Low score auto-collapses content in the UI.
*   **Admin Keys:** Hard-coded set of keys (Governance Council) can forcibly hide/remove illegal content (Child Safety, etc.).
*   **Civic Decay:** Old threads/votes lose weight over time (see `spec-civic-sentiment.md`).
*   **Moderation Events:**
    *   Moderator hide/remove actions must be represented as separate signed records (`ModerationEvent`).
    *   Validated against a hard-coded set of moderator keys in the client.
    *   This keeps moderation auditable and transparent.

```typescript
interface ModerationEvent {
  id: string;
  targetId: string;         // Thread or Comment ID
  action: 'hide' | 'remove';
  moderator: string;        // Moderator's public key
  reason: string;
  timestamp: number;
  signature: string;        // Signed by moderator key
}
```

---

## 5. Storage (GunDB)

*   **Namespace:**
    *   Threads: `vh/forum/threads/<threadId>`
    *   Comments: `vh/forum/threads/<threadId>/comments/<commentId>`
*   **Indexing:**
    *   `vh/forum/indexes/date/<threadId>` — Thread timestamp for date-sorted discovery.
    *   `vh/forum/indexes/tags/<tag>/<threadId>` — Threads indexed by tag.
*   **Integrity:** Client validates schemas before rendering. Gating by trustScore is enforced at action time (creating threads/comments/votes) on the local device, not re-validated for remote content.

**Gun Access Rule:** All Gun operations must be performed via `@vh/gun-client`, respecting the Hydration Barrier. No direct `Gun()` calls in app code.

### 5.1 Real-Time Sync & Hydration

**Hydration on Init:**
```typescript
function hydrateFromGun(client: VennClient, store: ForumStore) {
  const threadsChain = client.gun.get('vh').get('forum').get('threads');
  
  threadsChain.map().on((data, key) => {
    // Skip Gun metadata nodes
    if (!data || typeof data !== 'object' || data._ !== undefined) return;
    
    // Validate schema before ingestion
    const result = HermesThreadSchema.safeParse(data);
    if (result.success && !isDuplicate(result.data.id)) {
      store.setState(s => addThread(s, result.data));
    }
  });
}
```

**Subscription Requirements:**
1. On app init: Subscribe to `vh/forum/threads` via `.map().on()` for new thread discovery.
2. On thread view: Subscribe to `vh/forum/threads/<threadId>/comments` for live comments.
3. Unsubscribe on unmount to prevent memory leaks.

**Index Writes (On Thread Creation):**
```typescript
// After writing thread to vh/forum/threads/<threadId>
getForumDateIndexChain(client).get(thread.id).put({ timestamp: thread.timestamp });
thread.tags.forEach(tag => {
  getForumTagIndexChain(client, tag.toLowerCase()).get(thread.id).put(true);
});
```

### 5.2 Deduplication

Gun may fire `.on()` callbacks multiple times for the same thread/comment. Use TTL-based tracking:

```typescript
const seenThreads = new Map<string, number>(); // id → timestamp
const SEEN_TTL_MS = 60_000; // 1 minute
const SEEN_CLEANUP_THRESHOLD = 100;

function isDuplicate(id: string): boolean {
  const now = Date.now();
  const lastSeen = seenThreads.get(id);
  if (lastSeen && (now - lastSeen) < SEEN_TTL_MS) {
    return true; // Skip duplicate
  }
  seenThreads.set(id, now);
  
  // Cleanup old entries
  if (seenThreads.size > SEEN_CLEANUP_THRESHOLD) {
    for (const [key, ts] of seenThreads) {
      if (now - ts > SEEN_TTL_MS) seenThreads.delete(key);
    }
  }
  return false;
}
```

### 5.3 Local Persistence

**Vote State:** `vh_forum_votes:<nullifier>` — See §4.2 Vote State Persistence.

**Schema Validation:** All data read from Gun must be validated with Zod schemas before ingestion:
- `HermesThreadSchema.safeParse(data)`
- `HermesCommentSchema.safeParse(data)`
- Reject invalid data silently (log warning in debug mode).

---

## 6. VENN Integration

*   **Discuss in Forum CTA:** From a Canonical Analysis view, users can click "Discuss in Forum" to:
    1.  Check if a Thread with `sourceAnalysisId` matching the analysis exists.
    2.  If exists: Navigate to that Thread.
    3.  If not: Pre-populate a new Thread form with:
        *   Title: Article headline.
        *   `sourceAnalysisId`: The analysis ID.
        *   Tags: Derived from analysis metadata.
*   **Counterpoints from Analysis:** AI-generated counterpoints from VENN analysis can be suggested as starting points for user-generated counterpoints in the forum.

---

## 7. Implementation Checklist

**Core (Complete):**
- [x] Implement `Thread` and `Comment` schemas in `packages/data-model/src/schemas/hermes/forum.ts`
- [x] Implement `computeThreadScore` helper with documented λ value
- [x] Implement Gun storage adapters for threads, comments, and indexes
- [x] Implement `useForumStore` in `apps/web-pwa/src/store/hermesForum.ts`
- [x] Implement UI components: `ForumFeed`, `ThreadView`, `CommentNode`, `CounterpointPanel`
- [x] Implement trust gating in UI (disable write/vote when `trustScore < 0.5`)
- [x] Implement Markdown sanitization for content rendering
- [x] Implement sorting (Hot/New/Top) and auto-collapse for low-score content
- [x] Implement one-vote-per-user semantics (in-memory)
- [x] Implement content size limits (title ≤200, content ≤10,000)
- [x] Implement VENN integration ("Discuss in Forum" CTA)
- [x] Write unit tests for schemas and `computeThreadScore`
- [x] Write integration tests for trust gating and vote idempotency
- [x] Write E2E tests for forum flows

**Hydration & Sync (Phase 4 — Pending):**
- [ ] Implement `hydrateFromGun()` subscribing to `vh/forum/threads` via `.map().on()`
- [ ] Add schema validation (safeParse) and Gun metadata filtering on hydration
- [ ] Implement comment subscriptions per active thread view
- [ ] Implement deduplication with TTL-based seen tracking (mirrors messaging pattern)
- [ ] Unsubscribe on component unmount to prevent leaks

**Vote Persistence (Phase 4 — CRITICAL):**
- [ ] Persist vote state to localStorage: `vh_forum_votes:<nullifier>`
- [ ] Load vote state on app/store init
- [ ] Persist immediately on vote change
- [ ] Block voting until vote state is loaded (prevent race conditions)

**Index Usage (Phase 4 — Medium):**
- [ ] Write to `getForumDateIndexChain` on thread creation
- [ ] Write to `getForumTagIndexChain` for each tag on thread creation
- [ ] Consider seeding hydration from date index for efficiency

**CTA Dedup (Phase 4 — Medium):**
- [ ] Ensure "Discuss in Forum" checks for existing thread by `sourceAnalysisId` before creating
- [ ] Navigate to existing thread if found
