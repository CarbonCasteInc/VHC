# HERMES Forum Spec (v0)

> Status: Normative Spec
> Owner: VHC Spec Owners
> Last Reviewed: 2026-04-26
> Depends On: docs/foundational/System_Architecture.md, docs/CANON_MAP.md


Version: 0.9
Status: Canonical for Season 0 (V2-first alignment)
Context: Public topic discourse, reply/article publishing, and elevation entrypoint.

This spec restores implementation-level details from Sprint 3/3.5 while aligning naming and linkage to V2 topic synthesis.

## 1. Core Principles

1. Forum is the thread lens of a unified topic object.
2. Every thread belongs to exactly one `topicId`.
3. Reply and article posts are both first-class forum content.
4. Ranking and gating are deterministic and transparent.
5. Nomination/elevation is policy-driven and trust-gated.
6. Familiars inherit principal budgets and cannot mint independent influence.

## 2. Data Model

### 2.1 Thread schema

```ts
interface Thread {
  id: string;
  schemaVersion: 'hermes-thread-v0';
  title: string; // <= 200
  content: string; // markdown, <= 10_000
  author: string; // principal nullifier
  timestamp: number;
  topicId: string;
  tags: string[];

  sourceUrl?: string;
  urlHash?: string;
  isHeadline?: boolean;

  // V2 linkage
  sourceSynthesisId?: string; // preferred
  sourceEpoch?: number;

  // Legacy read-only alias
  sourceAnalysisId?: string;

  proposal?: ProposalExtension;

  upvotes: number;
  downvotes: number;
  score: number; // computed view
}

interface ProposalExtension {
  fundingRequest: string;
  recipient: string;
  status: 'draft' | 'active' | 'elevated' | 'funded' | 'closed';
  qfProjectId?: string;
  sourceTopicId?: string;
  createdAt: number;
  updatedAt: number;
}
```

Back-compat notes:

- Threads without proposal remain valid.
- Read path accepts `sourceAnalysisId`; write path emits `sourceSynthesisId`.
- Missing `sourceEpoch` is valid for legacy records.
- News story detail may pass an explicit deterministic `threadId` when creating a headline thread. This is limited to story-linked forum threads and does not change native forum thread id generation.

### 2.2 Topic linkage rules

- One topic can have many threads; each thread has exactly one `topicId`.
- For externally sourced stories, `topicId` may be derived from clustered story identity.
- Story-linked headline threads keep `topicId` on the feed topic, link back to accepted synthesis with `sourceSynthesisId` + `sourceEpoch` when available, and may use a deterministic `news-story:<encoded story-or-topic token>` id so detail cards and `/hermes/$threadId` open the same conversation.
- For native user threads, derive deterministic topic IDs using a prefix + thread ID.

```ts
const THREAD_TOPIC_PREFIX = 'thread:';

function deriveThreadTopicId(threadId: string): string {
  return sha256Hex(`${THREAD_TOPIC_PREFIX}${threadId}`);
}
```

### 2.3 Comment schema (debate stance model)

```ts
interface Comment {
  id: string;
  schemaVersion: 'hermes-comment-v1';
  threadId: string;
  parentId: string | null;
  content: string; // markdown, <= 10_000
  author: string;
  via?: 'human' | 'familiar';
  timestamp: number;

  // stance model (Sprint 3.5+)
  stance: 'concur' | 'counter' | 'discuss';

  // legacy, read-only
  type?: 'reply' | 'counterpoint';
  targetId?: string;

  upvotes: number;
  downvotes: number;
}
```

#### 2.3.1 Migration (v0 -> v1)

Read path requirements:

- Accept both `hermes-comment-v0` and `hermes-comment-v1`
- Map `type: 'counterpoint'` -> `stance: 'counter'`
- Map `type: 'reply'` -> `stance: 'concur'`
- Preserve `targetId` only for legacy compatibility

Write path requirements:

- Always write `schemaVersion: 'hermes-comment-v1'`
- Always write `stance`
- Never write `type` for new comments
- New comments may use `concur`, `counter`, or `discuss`; legacy `type`
  migration maps only `reply` -> `concur` and `counterpoint` -> `counter`.

Zod contract pattern:

```ts
export const HermesCommentSchema = z.union([
  HermesCommentSchemaV0, // read-only
  HermesCommentSchemaV1, // read/write
]);
```

### 2.3.2 Comment moderation schema

Story-thread comment moderation is an appendable audited record plus a
latest-by-comment pointer. It does not delete the original comment payload.
Readers apply the latest record for a comment; `hidden` records hide content and
reply/vote controls, while `restored` records render the comment normally.

```ts
interface CommentModeration {
  schemaVersion: 'hermes-comment-moderation-v1';
  moderation_id: string;
  thread_id: string;
  comment_id: string;
  status: 'hidden' | 'restored';
  reason_code: string;
  reason?: string;
  operator_id: string;
  created_at: number;
  audit: {
    action: 'comment_moderation';
    supersedes_moderation_id?: string;
    source_report_id?: string;
    notes?: string;
  };
}
```

Storage paths:

- Append/audit path:
  `vh/forum/threads/<thread_id>/comment_moderations/<moderation_id>/`
- Latest effective state path:
  `vh/forum/threads/<thread_id>/comment_moderations/latest/<comment_id>/`

Read/write requirements:

- validate the record with `HermesCommentModerationSchema`;
- reject records whose embedded `thread_id`, `comment_id`, or `moderation_id`
  does not match the path being read;
- preserve audit metadata;
- never render a hidden comment's original markdown, reply composer, or vote
  controls in story detail;
- when the action originates from the news report queue, preserve
  `audit.source_report_id`;
- do not claim user blocking, trust-gated operator roles, notification
  workflow, or a full trust-and-safety console exists from this minimum
  hide/restore path alone.

### 2.3.3 News report intake and operator action records

Accepted synthesis artifacts and story-thread comments can be reported into a
minimum audited operator queue. Reports are workflow/audit records; submitting a
report does not by itself suppress synthesis or hide comment content.

```ts
type NewsReportReasonCode =
  | 'inaccurate_summary'
  | 'bad_frame'
  | 'source_attribution_error'
  | 'policy_violation'
  | 'abusive_content'
  | 'spam'
  | 'other';

type NewsReportStatus = 'pending' | 'reviewed' | 'actioned';

type NewsReportResolution =
  | 'dismissed'
  | 'synthesis_suppressed'
  | 'synthesis_unavailable'
  | 'comment_hidden'
  | 'comment_restored';

type NewsReportTarget =
  | {
      type: 'synthesis';
      topic_id: string;
      synthesis_id: string;
      epoch: number;
      story_id?: string;
    }
  | {
      type: 'story_thread_comment';
      thread_id: string;
      comment_id: string;
      story_id?: string;
      topic_id?: string;
    };

interface NewsReport {
  schemaVersion: 'hermes-news-report-v1';
  report_id: string;
  target: NewsReportTarget;
  reason_code: NewsReportReasonCode;
  reason?: string;
  reporter_id: string;
  reporter_handle?: string;
  created_at: number;
  status: NewsReportStatus;
  audit: {
    action: 'news_report';
    operator_id?: string;
    reviewed_at?: number;
    resolution?: NewsReportResolution;
    correction_id?: string;
    moderation_id?: string;
    notes?: string;
  };
}
```

Storage paths:

- Report record path: `vh/news/reports/<report_id>/`
- Status queue/index path:
  `vh/news/reports/index/status/<status>/<report_id>/`

Read/write requirements:

- validate records with `HermesNewsReportSchema`;
- reject report records whose embedded `report_id` does not match the path
  being read;
- validate status queue pointers and filter stale queue entries by the actual
  report status;
- `pending` reports must not contain operator review metadata;
- `reviewed` reports are dismissals only;
- `actioned` reports must link to a remediation artifact through
  `correction_id` or `moderation_id` as appropriate;
- synthesis actions write existing `topic-synthesis-correction-v1` records
  with `audit.source_report_id`;
- comment actions write existing `hermes-comment-moderation-v1` records with
  `audit.source_report_id`;
- `/admin/reports` is a minimal internal operator queue for refresh, dismiss,
  suppress/unavailable synthesis, and hide/restore comment actions.

Out of scope for the current implementation: public policy text, user block UX,
trust-gated operator-role enforcement, notifications/escalation, and a broader
case-management console.

### 2.4 Post type contract (reply vs article)

```ts
type PostType = 'reply' | 'article';

interface ForumPost {
  id: string;
  schemaVersion: 'hermes-post-v0';
  threadId: string;
  parentId: string | null;
  topicId: string;
  author: string;
  via?: 'human' | 'familiar';
  type: PostType;
  content: string;
  timestamp: number;
  upvotes: number;
  downvotes: number;

  // required when type='article'
  articleRefId?: string;
}
```

Constraints:

- `reply` max 240 chars (hard block)
- `article` is longform and Docs-backed
- If reply input exceeds 240, client must block send and surface `Convert to Article`

### 2.5 Size limits and proposal elevation rules

- `title <= 200`
- `thread/content/comment <= 10_000`
- Reply hard cap `<= 240`

Proposal/elevation rules:

- Elevation requires `trustScore >= 0.7`
- Familiars may draft but cannot elevate without explicit human approval
- Default policy is one active proposal extension per topic unless explicitly forked

## 3. UI and UX Contracts

### 3.1 Feed and navigation

- Forum is the discourse layer for topic/thread cards in the unified feed.
- User-created forum heads and engaged topic conversations surface through the
  main feed `Topics` filter and through expanded-card discussion affordances.
- Once a forum topic has enough healthy conversation depth for synthesis, its
  expanded feed card uses the same constituent parts as a news story detail:
  synthesized summary, frame/reframe table, stance controls, engagement counts,
  then user comments/replies below the table.
- Direct HERMES/forum routes may remain available for deep links, messages, and
  internal flows, but the public app shell must not require a primary HERMES
  tab before a user can discover forum cards.
- Feed lists topics/threads and supports deterministic sort modes.
- HERMES and AGORA boundary:
  - HERMES: discourse (messaging, forum, docs)
  - AGORA: support/elevation/forwarding and governance rails
  - In the public feed UI, AGORA functions are woven into stance, engagement,
    nomination, and user/profile controls rather than exposed as a separate
    primary feed mode.

### 3.2 Topic synthesis refresh linkage

Forum activity is one input to V2 synthesis refresh:

- Trigger: every 10 verified comments with >=3 unique verified principals
- Debounce: 30 minutes
- Daily cap: 4 per topic

Forum references synthesis by `{topicId, synthesisId, epoch}`. Legacy `analysis_id` naming is read-only.

### 3.3 Discussion view

Current structure:

- Thread cards in feed
- Debate-oriented comment rendering (concur/counter)
- Sort options: `Hot`, `New`, `Top`
- Sanitized markdown rendering for all user text

### 3.4 Score and hot ranking formula

```ts
function computeThreadScore(thread: Thread, now: number): number {
  const ageHours = (now - thread.timestamp) / 3_600_000;
  const lambda = 0.0144; // ~48h half-life
  const decayFactor = Math.exp(-lambda * ageHours);
  return (thread.upvotes - thread.downvotes) * decayFactor;
}
```

Sort behavior:

- `Hot`: descending decayed score
- `New`: descending timestamp
- `Top`: descending raw `(upvotes - downvotes)`

## 4. Sybil Resistance, Voting, and Moderation

### 4.1 Trust gating

- Read is public.
- Write/vote requires verified session (`trustScore >= 0.5`).
- Elevation/finalize actions require `trustScore >= 0.7`.

UI enforcement:

- Disable create/reply/vote affordances for low-trust sessions
- Show explicit reason and next action (verify identity)

### 4.2 Voting semantics

Canonical storage stays raw and unweighted:

- Store `upvotes`/`downvotes` counts only
- One-vote-per-user-per-target semantics
- Changing vote overwrites prior state

```ts
type VoteState = 'up' | 'down' | null;
type VoteMap = Record<string, VoteState>; // targetId -> state
```

Persistence requirements:

- Persist vote state to avoid double-voting on refresh
- Local key format: `vh_forum_votes:<nullifier>`
- Optional future mirror in authenticated Gun user-space

XP-weighted views:

- Optional on-device derived ranking view only
- Never store per-nullifier XP alongside public content

### 4.3 Moderation model

- Community voting controls visibility by default
- Low-score content may auto-collapse in UI
- Moderator actions represented as explicit auditable events

```ts
interface ModerationEvent {
  id: string;
  targetId: string;
  action: 'hide' | 'remove';
  moderator: string;
  reason: string;
  timestamp: number;
  signature: string;
}
```

## 5. Nomination and Elevation

### 5.1 Nomination policy contract

```ts
interface NominationPolicy {
  minUniqueVerifiedNominators: number;
  minTopicEngagement: number;
  minArticleSupport?: number;
  coolDownMs: number;
}

interface NominationEvent {
  id: string;
  topicId: string;
  sourceType: 'news' | 'topic' | 'article';
  sourceId: string;
  nominatorNullifier: string;
  createdAt: number;
}
```

### 5.2 Elevation outputs

When threshold policy is satisfied, emit elevation jobs producing:

- `BriefDoc`
- `ProposalScaffold`
- `TalkingPoints`

Outputs must reference current synthesis context:

- `sourceTopicId`
- `sourceSynthesisId`
- `sourceEpoch`

## 6. Storage (GunDB) and Hydration

### 6.1 Namespace and indexing

Primary paths:

- Threads: `vh/forum/threads/<threadId>`
- Comments: `vh/forum/threads/<threadId>/comments/<commentId>`
- Posts (reply/article): `vh/forum/threads/<threadId>/posts/<postId>`
- Nominations: `vh/forum/nominations/<nominationId>`
- Elevation state: `vh/forum/elevation/<topicId>`

Index paths:

- `vh/forum/indexes/date/<threadId>`
- `vh/forum/indexes/tags/<tag>/<threadId>`

### 6.2 Hydration and real-time sync

```ts
function hydrateFromGun(client: VennClient, store: ForumStore): void {
  const threads = client.gun.get('vh').get('forum').get('threads');

  threads.map().on((data) => {
    if (!data || typeof data !== 'object') return;

    // required fields check first (avoid false metadata drops)
    if (!('id' in data) || !('schemaVersion' in data) || !('title' in data)) return;

    const parsed = parseThreadFromGun(data as Record<string, unknown>);
    const result = HermesThreadSchema.safeParse(parsed);
    if (!result.success || isDuplicate(result.data.id)) return;

    store.setState((s) => addThread(s, result.data));
  });
}
```

Subscription requirements:

1. Subscribe to thread map on init
2. Subscribe to comments/posts when thread opens
3. Unsubscribe on unmount

### 6.3 Deduplication

```ts
const seenThreads = new Map<string, number>();
const SEEN_TTL_MS = 60_000;
const SEEN_CLEANUP_THRESHOLD = 100;

function isDuplicate(id: string): boolean {
  const now = Date.now();
  const lastSeen = seenThreads.get(id);
  if (lastSeen && now - lastSeen < SEEN_TTL_MS) {
    return true;
  }

  seenThreads.set(id, now);

  if (seenThreads.size > SEEN_CLEANUP_THRESHOLD) {
    for (const [key, ts] of seenThreads) {
      if (now - ts > SEEN_TTL_MS) seenThreads.delete(key);
    }
  }

  return false;
}
```

### 6.4 Local persistence

- Vote state local persistence as described in Section 4.2
- Optional cached thread snapshot for faster startup
- All hydrated data validated with Zod before ingest

### 6.5 Gun write sanitization (critical)

Problem: Gun rejects object keys with `undefined` values.

Required helper:

```ts
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
```

Apply `stripUndefined` before every Gun `put()` for threads/comments/posts.

### 6.6 Gun array serialization for thread tags

Problem: Gun does not reliably accept JS arrays in all paths.

Required helpers:

```ts
function serializeThreadForGun(thread: Thread): Record<string, unknown> {
  const clean = stripUndefined(thread as unknown as Record<string, unknown>);
  return {
    ...clean,
    tags: JSON.stringify(thread.tags),
  };
}

function parseThreadFromGun(data: Record<string, unknown>): Record<string, unknown> {
  let tags: unknown = data.tags;

  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = [];
    }
  }

  const { proposal: rawProposal, _: _meta, ...rest } = data;
  const result: Record<string, unknown> = { ...rest, tags };

  if (rawProposal && typeof rawProposal === 'object' && !Array.isArray(rawProposal)) {
    const { _: _proposalMeta, ...cleanProposal } = rawProposal as Record<string, unknown>;
    result.proposal = cleanProposal;
  }

  return result;
}
```

### 6.7 Legacy compatibility aliases

- Read alias: `sourceAnalysisId` -> `sourceSynthesisId`
- New writes must only emit V2 naming
- Compatibility code remains until explicit migration cutoff

## 7. V2 Topic Synthesis Integration

Forum reads synthesis via:

- `topicId`
- `epoch`
- `synthesisId`

The discussion view may expose an epoch badge and synthesis warning state to indicate if the topic digest has moved since the user opened the thread.

## 8. XP Integration

Suggested Season 0 emission points (local-first):

- Thread creation (bounded daily cap)
- Substantive reply/article publish
- Constructive voted contribution (bounded)
- Nomination participation (bounded)

All XP values must be applied through XP ledger budgets; no separate forum-only influence multiplier is allowed.

## 9. Implementation Checklist

Core:

- [x] Thread/comment/post schemas in `packages/data-model`
- [x] Forum store supports threads + comments for the MVP story-detail path
- [ ] Reply/article post publication path beyond comments
- [x] Trust gating for write/vote/elevate boundaries
- [x] Ranking (`Hot/New/Top`) and score computation

Storage and sync:

- [x] Gun adapters for threads/comments/indexes
- [x] Gun adapters for audited comment hide/restore moderation
- [x] Gun adapters for typed news report intake and status queue indexes
- [ ] Gun adapters for standalone post publication path
- [x] Hydration with required-field checks and Zod validation
- [x] Deduplication TTL map
- [x] Serialization helpers for `undefined` + `tags[]`

V2 alignment:

- [x] `sourceSynthesisId` + epoch linkage wired for story-created forum threads
- [x] Deterministic `news-story:*` story-thread ids wired for story detail; exact id matches win before legacy topic/source heuristics
- [x] Legacy read alias for `sourceAnalysisId`
- [ ] Nomination/elevation writes with policy enforcement

UX:

- [x] Reply 240-char hard cap
- [x] Story-detail reply list/composer renders below accepted synthesis frame/reframe table
- [x] Thread create/comment load/comment post failures surface as recoverable UI states
- [x] Audited hide/restore moderation state hides story-reply content with provenance
- [x] Minimum report intake and `/admin/reports` operator action queue for accepted synthesis and story replies
- [ ] User block UX, trust-gated operator roles, notifications/escalation, and broader moderation queue/admin affordances
- [ ] Convert-to-article CTA + docs handoff
- [ ] Article publish back into topic/forum surface

## 10. Test Requirements

1. v0/v1 comment dual-parse migration behavior.
2. Strip-undefined helper prevents Gun write failures.
3. Thread tag serialization/deserialization correctness.
4. Vote idempotency and persistence across refresh.
5. Sorting correctness for `Hot`, `New`, `Top`.
6. Reply overflow triggers convert-to-article path.
7. Nomination thresholds trigger elevation jobs.
8. V2 linkage by `{topicId, synthesisId, epoch}`.
9. Privacy invariant checks (no secrets in public forum paths).
10. Feed-shell regression: forum cards remain discoverable through the `Topics` filter without requiring a primary HERMES tab in the public app chrome.
11. Comment moderation schema rejects malformed/path-mismatched payloads, preserves audit metadata, and hides moderated story-reply content without changing deterministic `news-story:*` thread identity.
12. News report schema and Gun adapters reject malformed/path-mismatched payloads, preserve operator audit metadata, and route pending reports to audited synthesis correction or comment moderation actions.
