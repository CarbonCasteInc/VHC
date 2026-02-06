# HERMES Forum Spec (v0)

**Version:** 0.4
**Status:** Implementation In-Progress — UI Refactor (Sprint 3.5) pending
**Context:** Public, threaded civic discourse for TRINITY OS.

> **ERRATA (Dec 7, 2025):** v0.4 introduces schema migration from `type` to `stance` and UI refactor to debate-first layout. See §2.2.1 and §3.2.
>
> **Sprint 3.5 Changes:**
> - 🔄 Schema migration: `hermes-comment-v0` → `hermes-comment-v1`
> - 🔄 `type: 'reply' | 'counterpoint'` → `stance: 'concur' | 'counter'`
> - 🔄 UI: Linear thread → Two-column debate layout (Concur | Counter)
> - 🔄 Dual-parse for backward compatibility during migration
>
> **RESOLVED (Dec 6, 2025):**
> - ✅ Gun `undefined` issue — `stripUndefined()` helper (§5.4)
> - ✅ Gun `Array` issue — `serializeThreadForGun()` / `parseThreadFromGun()` helpers (§5.5)
> - ✅ Gun metadata filtering — Check required fields first, strip `_` before parse
> - ✅ Lazy hydration — Retry on first user action if client not ready at init
> - ✅ Thread persistence verified — Threads survive page refresh
> - ✅ Cross-user sync verified — Threads appear across browser instances
> - ✅ Comment persistence verified — Comments persist and sync (Dec 7)

---

## 1. Core Principles

1.  **The Agora:** A public square for debate. Accessible to all, navigable from the global header.
2.  **Unified Feed ↔ Forum:** Headlines and threads are the same civic object viewed through different lenses.
3.  **Proposal Elevation:** Threads can be elevated into proposals with funding metadata and QF linkage.
4.  **Structured Debate:** Not just comments, but **Counterpoints**.
5.  **Sybil Resistance:** Posting and voting requires a verified `TrustScore` (e.g., ≥0.5).
6.  **Community Moderation:** Visibility is driven by `CivicXP` weighted voting and `CivicDecay`.

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
  topicId: string;          // Stable topic key (urlHash or thread-derived)
  tags: string[];           // e.g., ["Infrastructure", "Proposal"]
  
  // Optional: Link to external source / canonical analysis
  sourceUrl?: string;
  urlHash?: string;
  isHeadline?: boolean;
  sourceAnalysisId?: string; // Link to CanonicalAnalysis.topic_id or analysis_id

  // Optional: Proposal extension (elevated thread)
  proposal?: ProposalExtension;
  
  // Engagement (raw counts, canonical)
  upvotes: number;
  downvotes: number;
  score: number;            // Computed: (upvotes - downvotes) * decayFactor
}
```

```typescript
interface ProposalExtension {
  fundingRequest: string;         // RVU amount (display)
  recipient: string;              // recipient address
  status: 'draft' | 'active' | 'elevated' | 'funded' | 'closed';
  qfProjectId?: string;           // set when elevated on-chain
  sourceTopicId?: string;         // optional link to parent topic when multiple proposals exist
  attestationProof?: string;      // optional
  createdAt: number;
  updatedAt: number;
}
```

**Back-compat:** Existing threads without `proposal` remain valid and require no backfill.  
Treat missing `proposal` as “not a proposal.”

#### 2.1.1 Topic Linkage Rules (Unified Model)

- Every headline maps to exactly one thread (shared `topicId`).
- Every user-created thread becomes a headline card (shared `topicId`).
- For URL topics: `topicId = urlHash` (canonical URL hash).
- For native threads: `topicId = sha256(THREAD_TOPIC_PREFIX + threadId)` to keep a stable key.
- `THREAD_TOPIC_PREFIX = "thread:"` (constant; do not vary).
- The scroll is a view over **Topics**, not a separate content system.

### 2.2 Comment Schema

> **Schema Migration (Sprint 3.5):** Transitioning from v0 (`type`) to v1 (`stance`). See §2.2.1 for migration details.

```typescript
// v1 Schema (Sprint 3.5+)
interface Comment {
  id: string;               // UUID
  schemaVersion: 'hermes-comment-v1';  // Bumped from v0
  threadId: string;
  parentId: string | null;  // null if top-level reply to thread — RETAINED
  
  content: string;          // Markdown, ≤ 10,000 chars
  author: string;           // Author's Nullifier
  via?: 'human' | 'familiar'; // Optional provenance (no familiarId by default)
  timestamp: number;
  
  // NEW: Stance for debate structure (replaces type)
  stance: 'concur' | 'counter';
  
  // DEPRECATED: Kept for migration compatibility
  type?: 'reply' | 'counterpoint';  // Optional, deprecated — do not write
  targetId?: string;                // Optional, deprecated — preserved for legacy counterpoints
  
  // Engagement (raw counts, canonical)
  upvotes: number;
  downvotes: number;
}
```

#### 2.2.1 Schema Migration (v0 → v1)

**Read Path (Hydration):**
- Accept both `hermes-comment-v0` and `hermes-comment-v1`
- For v0 comments:
  - `type: 'counterpoint'` → `stance: 'counter'`
  - `type: 'reply'` → `stance: 'concur'`
  - Preserve `targetId` if present

**Write Path:**
- Always write `schemaVersion: 'hermes-comment-v1'`
- Always write `stance` field
- Never write `type` field (deprecated)
- Preserve `targetId` only for legacy counterpoints during migration

**Zod Implementation:**
```typescript
// Explicit z.union() for dual-parse
export const HermesCommentSchema = z.union([
  HermesCommentSchemaV0,  // deprecated, read-only
  HermesCommentSchemaV1   // current, read/write
]);
```

**Deprecation Timeline:**
- Sprint 3.5: Dual-parse (read v0/v1, write v1 only)
- Sprint 5: Remove v0 read support

**Test Requirements:**
- [ ] v0 inputs hydrate with correct stance mapping
- [ ] v1 inputs pass through unchanged
- [ ] v0 shapes never exit write path (only v1 written to Gun)

**Note:** The `parentId` field provides the tree structure. The `stance` field provides the semantic (support vs oppose). The deprecated `targetId` was redundant with `parentId` for counterpoints.

### 2.3 Content Size Limits

Client-side validation and Zod schemas enforce:
*   `title`: ≤ 200 characters.
*   `content` (thread or comment): ≤ 10,000 characters.
*   UI should truncate long content with "Show more" expansion.

### 2.4 Proposal Elevation Rules

- **Trust-gated:** Elevation requires `trustScore ≥ 0.7` (principal nullifier).
- **Familiar constraint:** Familiars may draft proposal fields, but **cannot elevate** without explicit human approval.
- **One proposal per topic:** Default is one proposal per `topicId`.  
  - If multiple proposals are needed, create a new proposal thread and set `proposal.sourceTopicId` (optional) to link back.
- **Voting separation:** Forum votes affect visibility; proposal support uses QF-style voting (off-chain in Season 0).

---

## 3. UI & UX

### 3.1 The Feed
*   **Global View:** List of **Topics** (external headlines + user threads) sorted by `Hot`, `New`, or `Top`.
*   **Navigation:** Forum is accessed under the HERMES section of the app (e.g., `/hermes/forum`), not under AGORA/governance.

**HERMES vs AGORA Distinction:**
*   **HERMES** = Communications layer: Messaging (DMs) + Forum (public civic discourse).
*   **AGORA** = Governance & projects (Sprint 5+): Collaborative document editing, project/policy development, decision-making.
*   Forum threads can be elevated into AGORA projects in future sprints (based on engagement, upvotes, tags).

### 3.2 Topic Summary Refresh (Verified-Only)

- For topics linked to analyses, re-synthesis is triggered after **N verified comments**.
- Defaults (aligned with `canonical-analysis-v2`):
  - `N = 10` verified comments since last synthesis.
  - Minimum **3 unique verified principals** since last synthesis.
  - Debounce: at most one refresh per **30 minutes**.
  - Daily cap: **4** refreshes per topic.
- Familiars count only if acting on behalf of a verified principal (no extra weight).

### 3.3 The Discussion View

> **UI Refactor (Sprint 3.5):** Migrating from linear thread to two-column debate layout.

**Debate-First Layout (Sprint 3.5+):**
*   **Two Columns:** Concur (left) and Counter (right) at every level.
*   **No Linear Thread:** Comments are organized by `stance`, not arrival order.
*   **Nested Debates:** Clicking any comment zooms to reveal its OWN Concur/Counter columns.
*   **Mirrors VENN:** Format matches the bias table's Frame/Reframe structure.

**Legacy (Pre-Sprint 3.5):**
*   ~~Standard Replies: Nested tree structure (Reddit style).~~
*   ~~Counterpoints (Side-by-Side): Split view for counterpoint children.~~

**Content Sanitization:** All content (Markdown) must be sanitized before rendering (strip scripts, dangerous HTML) using a whitelisted renderer. This prevents XSS and injection attacks.

### 3.4 Score & Hot Ranking

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
*   **Civic Decay:** Old threads/votes lose weight over time (see `docs/specs/spec-civic-sentiment.md`).
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

### 5.4 Gun Write Sanitization (CRITICAL)

**Problem:** Gun's `put()` method throws `Invalid data: undefined` when an object contains keys with `undefined` values. Zod's `.optional()` fields may produce `{ key: undefined }` in parsed output.

**Affected Fields:**
- `Thread.sourceAnalysisId` — Optional, may be undefined
- `Comment.targetId` — Optional (only set for counterpoints)

**Required Sanitization:**

All objects **MUST** be sanitized before writing to Gun:

```typescript
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

// Before any Gun write:
const cleanThread = stripUndefined(thread);
getForumThreadChain(client, cleanThread.id).put(cleanThread, callback);
```

**Why Messaging Avoids This:**
- Messaging constructs objects with guaranteed-defined values
- No optional fields are passed without explicit assignment
- All device keys (`deviceId`, `senderDevicePub`) are always present

**Status:** ✅ RESOLVED — `stripUndefined()` helper implemented and applied.

### 5.5 Gun Array Serialization — RESOLVED ✅

**Problem (Resolved):** GunDB does not natively support JavaScript arrays in `put()` operations. The `tags: string[]` field in `HermesThread` triggers `Invalid data: Array` error.

**Why Messaging Doesn't Have This Issue:**
- `HermesChannel` contains `participants: string[]` BUT channels are **never written to Gun**
- Channel state is stored in **localStorage only** (via `persistSnapshot`)
- Only `HermesMessage` objects (no arrays) are written to Gun
- Forum threads must be shared state in Gun, so arrays are exposed to `put()`

**Affected Fields:**
- `HermesThread.tags` — Must be JSON-stringified before Gun write
- `HermesComment` — No arrays, not affected

**Required Serialization:**

```typescript
/** Serialize thread for Gun storage (handles undefined + arrays) */
function serializeThreadForGun(thread: HermesThread): Record<string, unknown> {
  const clean = stripUndefined(thread);
  return {
    ...clean,
    tags: JSON.stringify(clean.tags)  // Gun cannot handle arrays
  };
}

/** Parse thread from Gun storage (handles stringified arrays) */
function parseThreadFromGun(data: Record<string, unknown>): Record<string, unknown> {
  let tags = data.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      console.warn('[vh:forum] Failed to parse tags, defaulting to empty array');
      tags = [];
    }
  }
  return { ...data, tags };
}

// Usage in createThread:
const threadForGun = serializeThreadForGun(withScore);
getForumThreadChain(client, threadForGun.id).put(threadForGun as any, ...);

// Usage in hydrateFromGun:
const parsedData = parseThreadFromGun(data);
const result = HermesThreadSchema.safeParse(parsedData);
```

**Note:** Index writes (`getForumTagIndexChain`) remain unaffected — they iterate over the original `tags` array before serialization.

**Additional Fixes Applied (Dec 6, 2025):**
- ✅ **Gun metadata filtering** — Changed from `'_' in data` (too aggressive) to checking required fields first (`id`, `schemaVersion`, `title`), then stripping `_` before schema parsing
- ✅ **Lazy hydration** — Made `hydrateFromGun` retry on first user action if Gun client wasn't ready at store init
- ✅ **Per-store tracking** — Changed hydration flag from module-level boolean to `WeakSet<StoreApi>` for test isolation

**Status:** ✅ RESOLVED — Thread creation and hydration verified in manual testing.

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

**Hydration & Sync (Phase 4 — Complete):**
- [x] Implement `hydrateFromGun()` subscribing to `vh/forum/threads` via `.map().on()`
- [x] Add schema validation (safeParse) and Gun metadata filtering on hydration
- [x] Implement comment subscriptions per active thread view
- [x] Implement deduplication with TTL-based seen tracking (mirrors messaging pattern)
- [ ] Unsubscribe on component unmount to prevent leaks (deferred)

**Vote Persistence (Phase 4 — Complete):**
- [x] Persist vote state to localStorage: `vh_forum_votes:<nullifier>`
- [x] Load vote state on app/store init
- [x] Persist immediately on vote change
- [x] Block voting until vote state is loaded (prevent race conditions)

**Index Usage (Phase 4 — Complete):**
- [x] Write to `getForumDateIndexChain` on thread creation
- [x] Write to `getForumTagIndexChain` for each tag on thread creation
- [ ] Consider seeding hydration from date index for efficiency (deferred)

**Gun Write Sanitization (Phase 4.1 — Complete):**
- [x] Add `stripUndefined<T>()` helper to remove undefined keys
- [x] Apply to thread objects before `getForumThreadChain().put()`
- [x] Apply to comment objects before `getForumCommentsChain().put()`
- [x] Unit test for `stripUndefined` behavior

**Gun Array Serialization (Phase 4.2 — Complete ✅):**
- [x] Add `serializeThreadForGun()` helper (combines undefined + array handling)
- [x] Add `parseThreadFromGun()` helper (JSON-parse tags with try/catch)
- [x] Update `createThread()` to use serialization helper
- [x] Update `hydrateFromGun()` to use parse helper before schema validation
- [x] **Update `createMockForumStore`** to mirror serialization/parsing for E2E test fidelity
- [x] Gun metadata filtering — Check required fields first, strip `_` before parse
- [x] Lazy hydration — Retry on first user action if client not ready
- [x] Per-store hydration tracking (`WeakSet` for test isolation)
- [x] Verify thread creation works in manual testing ✅
- [x] Verify thread hydration works after page refresh ✅
- [x] Verify cross-user sync — Threads appear across browser instances ✅

**Comment Persistence (Phase 4.3 — IN PROGRESS 🚧):**
- [ ] Verify `createComment()` writes to Gun correctly (`getForumCommentsChain`)
- [ ] Verify `loadComments()` subscribes to correct Gun path
- [ ] Apply Gun metadata filtering (same as thread fix)
- [ ] Apply `stripUndefined()` to comment writes (if not already)
- [ ] Add debug logging to comment write/hydration flow
- [ ] Test comment persistence after page refresh
- [ ] Test comment sync across browser instances

**CTA Dedup (Phase 4.4 — Pending):**
- [ ] Ensure "Discuss in Forum" checks for existing thread by `sourceAnalysisId` before creating
- [ ] Navigate to existing thread if found
