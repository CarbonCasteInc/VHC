# HERMES Forum Spec (v0)

**Version:** 0.1
**Status:** Canonical for Sprint 3
**Context:** Public, threaded civic discourse for TRINITY OS.

---

## 1. Core Principles

1.  **The Agora:** A public square for debate. Accessible to all, navigable from the global header.
2.  **Structured Debate:** Not just comments, but **Counterpoints**.
3.  **Sybil Resistance:** Posting and voting requires a verified `TrustScore` (e.g., >0.5).
4.  **Community Moderation:** Visibility is driven by `CivicXP` weighted voting and `CivicDecay`.

---

## 2. Data Model

### 2.1 Thread Schema
```typescript
interface Thread {
  id: string;             // UUID
  title: string;
  content: string;        // Markdown
  author: string;         // Author's Nullifier (Public Key)
  timestamp: number;
  tags: string[];         // e.g., ["Infrastructure", "Proposal"]
  
  // Engagement
  upvotes: number;
  downvotes: number;
  score: number;          // Computed: (up - down) * decay_factor
}
```

### 2.2 Comment/Counterpoint Schema
```typescript
interface Comment {
  id: string;
  threadId: string;
  parentId: string | null; // null if top-level reply to thread
  
  content: string;
  author: string;
  timestamp: number;
  
  // Type
  type: 'reply' | 'counterpoint';
  
  // For Counterpoints
  targetId: string;       // ID of the comment/post being countered
  
  // Engagement
  upvotes: number;
  downvotes: number;
}
```

---

## 3. UI & UX

### 3.1 The Feed
*   **Global View:** List of threads sorted by `Hot` (Score + Time Decay), `New`, or `Top`.
*   **Navigation:** "Forum" link in the main app header.

### 3.2 The Discussion View
*   **Standard Replies:** Nested tree structure (Reddit style).
*   **Counterpoints (Side-by-Side):**
    *   If a comment has a `counterpoint` child, the UI renders a split view.
    *   **Left:** Original Argument.
    *   **Right:** The Counterpoint(s).
    *   **Source:** Counterpoints can be user-generated (flagged replies) OR AI-generated (linked to Analysis summaries).

---

## 4. Sybil Resistance & Moderation

### 4.1 Gating
*   **Read:** Open to all (Public).
*   **Write/Vote:** Requires `TrustScore >= 0.5` (Verified Human).
*   **Anonymous Mode (Future):** "Sister Forum" for low-trust/anon accounts (no legislative weight).

### 4.2 Voting Power
*   **1 Person = 1 Vote (Base):** Standard.
*   **XP Weighting (Optional v0):** Votes can be weighted by the user's `CivicXP` in the relevant domain (e.g., "Infrastructure" XP boosts votes on infrastructure threads).

### 4.3 Moderation
*   **Default:** Community driven. Low score hides content.
*   **Admin Keys:** Hard-coded set of keys (Governance Council) can forcibly hide/remove illegal content (Child Safety, etc.).
*   **Civic Decay:** Old threads/votes lose weight over time (see `spec-civic-sentiment.md`).

---

## 5. Storage (GunDB)

*   **Namespace:** `vh/forum/threads/...` (Public Graph).
*   **Indexing:**
    *   `vh/forum/indexes/date`
    *   `vh/forum/indexes/tags`
*   **Integrity:** All posts signed by Author. Client validates signature + TrustScore before rendering.
