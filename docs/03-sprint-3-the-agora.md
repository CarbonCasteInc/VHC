# Sprint 3: The Agora - Communication (Implementation Plan)

**Context:** `System_Architecture.md` v0.2.0 (Sprint 3: The "Agora" - Communication)
**Goal:** Implement the "Agora" – the civic dialogue layer. This consists of **HERMES Messaging** (secure, private communication) and **HERMES Forum** (threaded civic discourse).
**Status:** 🚧 **IN PROGRESS** — Tests passing, manual testing blocked (Dec 4, 2025)

> ⚠️ **ERRATA (Dec 4, 2025):** Unit and E2E tests pass, but runtime wiring gaps prevent successful manual testing. Core schemas, stores, and UI components exist but lack proper hydration, subscription, and encryption key handling. See "Outstanding Implementation Work" subsections under each phase for specifics.

---

## 1. Guiding Constraints & Quality Gates

### 1.1 Non-Negotiables (Engineering Discipline)
- [x] **LOC Cap:** Hard limit of **350 lines** per file (tests/types exempt).
- [x] **Coverage:** **100%** Line/Branch coverage for new/modified modules.
- [x] **Browser-Safe:** No `node:*` imports in client code.
- [x] **Security:** E2EE (End-to-End Encryption) for all private messages.
- [x] **Privacy:** No metadata leakage; "First-to-File" principles apply to public civic data.

### 1.2 True Offline Mode (E2E Compatibility)
- [x] **True Offline Mode:** Messaging and Forum flows must run with `VITE_E2E_MODE=true` using full mocks (no WebSocket, no WebLLM, no real Gun relay), per `ARCHITECTURE_LOCK.md`. E2E tests must assert that no network connections are attempted.

### 1.3 Gun Isolation & Topology
- [x] **Gun Isolation:** All access to Gun goes through `@vh/gun-client`. No direct `gun` imports in `apps/*` or other packages. The Hydration Barrier (`waitForRemote`) must be respected for all read/write operations.
- [x] **TopologyGuard Update:** Extend TopologyGuard allowed prefixes to include:
    - `~*/hermes/inbox/**`
    - `~*/hermes/outbox/**`
    - `~*/hermes/chats/**`
    - `vh/forum/threads/**`
    - `vh/forum/indexes/**`
    - Add unit tests asserting invalid paths are rejected.
    - Ensure Gun adapters for HERMES and Forum go through the guarded namespaces, not via raw mesh.

### 1.4 Identity & Trust Gating
- [x] **Trust Gating (Forum):** Creating threads/comments and voting in HERMES Forum requires `TrustScore >= 0.5` on the current session, aligned with `System_Architecture.md` §4.1.5 and `spec-hermes-forum-v0.md`.
- [x] **Session Requirement (Messaging):** HERMES Messaging requires an active session and identity (nullifier). Messaging adds no additional trustScore threshold beyond the session gate defined in `System_Architecture.md` §4.1.5.

### 1.5 XP & Privacy
- [x] **XP & Privacy:** Any XP accrual from Messaging/Forum must write only to the on-device XP ledger (`civicXP` / `socialXP` in `spec-xp-ledger-v0.md`), never emitting `{district_hash, nullifier, XP}` off-device.

### 1.6 HERMES vs AGORA Naming
- [x] **Navigation Model:**
    - **HERMES** = Communications layer: Messaging (DMs) + Forum (public civic discourse).
    - **AGORA** = Governance & projects (Sprint 4+): Collaborative documents, project/policy development, decision-making.
- [x] **Routing:**
    - HERMES tab → `/hermes` → surfaces both Messaging and Forum.
    - AGORA tab → `/governance` (or `/agora`) → governance/proposals (Sprint 4+).
- [x] **Elevation Path (Future):** Forum threads can be elevated into AGORA projects based on engagement, upvotes, and tags. *Deferred to Sprint 4.*

---

## 2. Phase 1: HERMES Messaging (The Nervous System)

**Objective:** Enable secure, peer-to-peer, end-to-end encrypted messaging between verified identities.
**Canonical Reference:** `docs/spec-hermes-messaging-v0.md`

### 2.1 Data Model & Schema (`packages/data-model`)
- [x] **Schema Definition:** Implement `Message` and `Channel` exactly as defined in `docs/spec-hermes-messaging-v0.md` §2 in `packages/data-model/src/schemas/hermes/message.ts`:
    - `Message`: includes `id`, `channelId`, `sender`, `recipient`, `timestamp`, `type`, encrypted `content`, and `signature`.
    - `sender` / `recipient` are set to the session nullifier (`SessionResponse.nullifier`), the canonical identity key across TRINITY.
    - `Channel`: includes `id` (deterministic hash of sorted participant keys), `participants`, `lastMessageAt`, `type: 'dm'`.
    - Add `schemaVersion: 'hermes-message-v0' | 'hermes-channel-v0'` fields for forward-compatibility.
    - **Note:** Group chats (`type: 'group'`) are explicitly v1+. Sprint 3 is strictly 1:1 DMs.
- [x] **Validation:** Zod schemas for strict runtime checking.
- [x] **Types:** Export TypeScript types to `packages/types`.
- [x] **Channel ID Helper:** Implement `deriveChannelId(participants: string[]): string` in `packages/data-model`, defined as `sha256(sort(participants).join('|'))`. Use browser-safe crypto from `@vh/crypto`. All messaging code must use this canonical derivation.

### 2.2 Transport Layer (`packages/gun-client`) & Messaging Store (`apps/web-pwa`)

#### 2.2.1 Gun Adapters (`packages/gun-client`)
- [x] **Gun adapters:** Expose helpers using identity keys (nullifiers):
    - `getHermesInboxChain(identityKey: string) -> ChainWithGet<Message>`
    - `getHermesOutboxChain(identityKey: string) -> ChainWithGet<Message>`
    - `getHermesChatChain(identityKey: string, channelId: string) -> ChainWithGet<Message>`
- [x] **Namespace Topology:** Implement paths per `spec-hermes-messaging-v0.md` §3.1:
    - `~<recipient_identityKey>/hermes/inbox` — Sender writes encrypted message reference here.
    - `~<sender_identityKey>/hermes/outbox` — Sender writes copy for multi-device sync.
    - `~<user_identityKey>/hermes/chats/<channelId>` — Local view of the conversation.
- [x] **Hydration Barrier:** All helpers must respect `waitForRemote` before writes.

#### 2.2.2 Encryption Wrappers (`packages/gun-client/src/hermesCrypto.ts`)
- [x] **Implement encryption helpers:**
    - `deriveSharedSecret(recipientDevicePub: string, senderDevicePair: SEA.Pair): Promise<string>`
    - `encryptMessagePayload(plaintext: HermesPayload, secret: string): Promise<string>`
    - `decryptMessagePayload(ciphertext: string, secret: string): Promise<HermesPayload>`
- [x] **HermesPayload:** `{ text?: string; attachmentUrl?: string; attachmentType?: 'image' | 'file' }`
- [x] **Implementation:** Use `SEA.secret`, `SEA.encrypt`, `SEA.decrypt` exactly as described in `spec-hermes-messaging-v0.md` §3.2.
- [x] **Privacy:** Do not leak plaintext into Gun; encrypted payload only.

#### 2.2.3 Messaging Store (`apps/web-pwa/src/store/hermesMessaging.ts`)
- [x] **Implement `useChatStore` (Zustand)** that only depends on:
    - `@vh/gun-client` (for graph I/O)
    - `@vh/data-model` (for Zod validation)
    - `@vh/types` (for identity / trustScore)
- [x] **API:**
    - `sendMessage(recipientIdentityKey, plaintext, type: 'text' | 'image' | 'file')`
    - `subscribeToChannel(channelId) -> unsubscribe()`
- [x] **Internally:**
    - Derive `channelId` via `deriveChannelId`.
    - Encrypt + sign, then write to:
        - Recipient inbox (`~recipient/hermes/inbox`)
        - Sender outbox (`~sender/hermes/outbox`)
        - Local chat history (`~sender/hermes/chats/<channelId>`)
- [x] **Deduplication:** De-duplicate messages by `id` when building channel history.
- [x] **Error Handling:**
    - On Gun put error (`ack.err`), mark message as `status: 'failed'` in `useChatStore`. Do not retry automatically.
    - On timeout, follow the "proceed without ack" model from `gun-client`, but keep `status: 'pending'` until message is reflected in inbox/history.
- [x] **E2E Mock (Messaging):** When `VITE_E2E_MODE=true`, inject an in-memory `useChatStore` implementation:
    - Same public API (`sendMessage`, `subscribeToChannel`).
    - Stores messages in local memory only.
    - Does not touch `@vh/gun-client` or open any network connections.

### 2.3 UI Implementation (`apps/web-pwa`)

#### 2.3.1 Components
- [x] `ChatLayout`: Split view (Channel List / Message Thread).
- [x] `ChannelList`: Virtualized list of active conversations.
- [x] `MessageBubble`: Sent/Received styles, timestamp, status (sending/sent/failed).
- [x] `Composer`: Input area with auto-expanding text, send button.
- [x] `ContactQR`: Displays current device's identity key (nullifier) as QR code.
- [x] `ScanContact`: Camera-based QR scanner with fallback to manual entry on desktop.

#### 2.3.2 Features
- [x] **Direct Messages (1:1 only):**
    - Start chat by:
        - Scanning a QR code containing the peer's identity key (nullifier), or
        - Pasting their identity key manually.
    - **No global user search or central directory in v0.**
- [x] **Contact QR & Scanner:**
    - Add "Share Contact" button that shows the current device's identity key as a QR code.
    - Add "Scan Contact" flow (uses camera where available; falls back to manual entry on desktop).
- [x] **Optimistic UI:** Display messages immediately while syncing in background.

#### 2.3.3 Identity & UX Constraints
- [x] **Identity Requirement:** If `useIdentity()` has no active identity/session, the Messaging UI shows a "Create identity to start messaging" gate instead of the chat UI.
- [ ] **Device Label (Optional v0):** When multiple devices are linked, show which device a message came from. Reserve a `deviceId` field in the Message schema for this purpose.

### 2.4 Outstanding Implementation Work (Messaging)

> ⚠️ **Blocking manual testing.** The following items must be completed before messaging can be manually tested end-to-end.

#### 2.4.1 Hydration & Subscriptions
- [ ] **Hydrate on Init:** Update `createRealChatStore` to read `~<my_nullifier>/hermes/chats` and `~<my_nullifier>/hermes/outbox` from Gun on initialization to populate `channels` and `messages` maps.
- [ ] **Call `subscribeToChannel`:** The method exists but is never invoked in production. Wire it into `ChatLayout` or `MessageThread` when a channel is opened.
- [ ] **Channel List Hydration:** Derive channel list from stored messages on reload so conversations persist.

#### 2.4.2 Encryption Key Correctness
- [ ] **Real SEA Keypairs:** In `useIdentity` (or a new `useCrypto` hook), generate and store a **real SEA keypair** (`SEA.pair()`) for the device, not just a random UUID string as `deviceKey`.
- [ ] **Fix `sendMessage`:** Use the real device keypair's `epub`/`epriv` for `deriveSharedSecret`, not the nullifier string.
- [ ] **Sign Messages:** Actually call `SEA.sign()` instead of hardcoding `signature: 'unsigned'`.
- [ ] **Fix Decryption in UI:** Update `MessageBubble` to use the real device keypair and peer's `epub` for `deriveSharedSecret`, not nullifier strings.
- [ ] **ChannelList Decryption:** Decrypt message previews in `ChannelList` instead of rendering ciphertext.

#### 2.4.3 Error Handling & Validation
- [ ] **Timeout → Failed Status:** On Gun write timeout, explicitly set message status to `'failed'` (currently stays `'pending'` forever).
- [ ] **Contact Key Validation:** In `ScanContact`, validate that input looks like a valid identity key before calling `getOrCreateChannel`.
- [ ] **Offline Handling:** Surface clear error when network unavailable during send.

#### 2.4.4 Multi-Device Sync
- [ ] **Outbox Subscription:** Subscribe to `~<my_nullifier>/hermes/outbox` to receive messages sent from other linked devices.
- [ ] **Merge Logic:** When a message arrives from outbox, treat it like an incoming message (decrypt, add to message list).

---

## 3. Phase 2: HERMES Forum (The Agora)

**Objective:** A threaded conversation platform combining Reddit-style threads with VENN's bias/counterpoint tables.
**Canonical Reference:** `docs/spec-hermes-forum-v0.md`

### 3.1 Data Model (`packages/data-model`)

- [x] **Schema Definition:** Implement `Thread` and `Comment` exactly as defined in `docs/spec-hermes-forum-v0.md` §2 in `packages/data-model/src/schemas/hermes/forum.ts`:
    - `Thread`: has `score = (upvotes - downvotes) * decayFactor`.
    - `Comment`: uses `type: 'reply' | 'counterpoint'` and optional `targetId` for counterpoints.
    - Add `schemaVersion: 'hermes-thread-v0' | 'hermes-comment-v0'`.
    - Add `sourceAnalysisId?: string` to `Thread` for linking back to VENN analysis.
    - **Note:** No separate `Counterpoint` type; `Comment` with `type: 'counterpoint'` and `targetId` covers it.
- [x] **Content Size Limits:**
    - `title`: ≤ 200 characters.
    - `content`: ≤ 10,000 characters.
- [x] **Validation:** Use Zod schemas, exported via `packages/types`.

- [x] **Storage Topology:** Implement Gun storage paths per `spec-hermes-forum-v0.md` §5:
    - Threads: `vh/forum/threads/<threadId>`
    - Comments: `vh/forum/threads/<threadId>/comments/<commentId>`
    - Indexes:
        - `vh/forum/indexes/date`
        - `vh/forum/indexes/tags/<tag>/<threadId>`

- [x] **Score & Decay:** Implement score computation as:
    - `score = (upvotes - downvotes) * exp(-λ * ageInHours)`
    - λ ≈ 0.0144 (half-life ~48h). Document the chosen λ in the spec comments.
    - Encapsulate this in a `computeThreadScore(thread, now)` helper in `packages/data-model`.

### 3.2 Forum Store (`apps/web-pwa/src/store/hermesForum.ts`)

- [x] **Implement `useForumStore` (Zustand)** that depends on:
    - `@vh/gun-client` (for graph I/O)
    - `@vh/data-model` (for Zod validation)
    - `@vh/types` (for identity / trustScore)
- [x] **One-Vote-Per-User:** Track vote state per `(user, targetId)`. Updating a vote overwrites the previous one.
- [x] **E2E Mock (Forum):** When `VITE_E2E_MODE=true`, use an in-memory `useForumStore`:
    - Manages threads/comments in memory.
    - Skips Gun entirely.
    - Still enforces trust gating (`trustScore >= 0.5`) using the local identity hook.

### 3.3 UI Implementation (`apps/web-pwa`)

#### 3.3.1 Components
- [x] `ForumFeed`: List of active threads sorted by engagement/time.
- [x] `ThreadView`: Main post + nested comment tree.
- [x] `CommentNode`: The comment content + "Counterpoints" side-panel or expandable section.
- [x] `NewThreadForm`: Form for creating new threads with title, content (Markdown), and tags.
- [x] `CounterpointPanel`: Side-by-side view for original argument and counterpoint(s).

#### 3.3.2 Features
- [x] **Structured Debate:** Users can reply normally OR post a "Counterpoint" which appears distinctly next to the original point (side-by-side or expandable section).
- [x] **Sorting Options:**
    - **Hot:** Descending `score` (includes decay).
    - **New:** Descending `timestamp`.
    - **Top:** Descending `(upvotes - downvotes)` (no decay).
- [x] **Auto-collapse:** Low-score content (negative votes) auto-collapses in the UI.
- [x] **Markdown Sanitization:** Sanitize all Markdown before rendering to prevent XSS (`marked` + `dompurify`).

#### 3.3.3 Trust Gating
- [x] **Trust gating:** All "New Thread", "Reply", "Counterpoint", and Vote buttons are disabled unless:
    - There is an active session/identity, AND
    - `identity.session.trustScore >= 0.5` (as per `spec-hermes-forum-v0.md` §4.1).
- [x] **Non-attested users can still read threads/comments.**

#### 3.3.4 Voting Semantics (v0)
- [x] **Raw Vote Storage:** Persist raw upvotes/downvotes as 1 person = 1 vote (no weighting in storage).
- [x] **One-Vote-Per-User:** For each `(user, targetId)`, only one vote is allowed. Updates overwrite.
- [x] **XP-Weighted Score (Client Only):** Compute a derived XP-weighted score in the client/UI only:
    - `weightedScore = Σ sign(vote) * f(civicXP, tag)`
    - For Sprint 3, implement `f` as a simple monotonic function, e.g., `1 + log10(1 + civicXP_tag)`, but keep the raw counts canonical.
    - **Implementation Note:** Base scoring is in place; XP-weighting is a v1 enhancement using the local XP ledger.
- [x] **Privacy:** Never store per-nullifier XP alongside content in Gun; XP reads come from the local XP ledger only.

#### 3.3.5 VENN Integration
- [x] **VENN Integration:** From a Canonical Analysis view, expose a "Discuss in Forum" CTA that:
    - Creates (or navigates to) a Thread tagged with the analysis/topic id.
    - Stores a `sourceAnalysisId` field on the Thread (string, optional) to link back.

### 3.4 Outstanding Implementation Work (Forum)

> ⚠️ **Blocking manual testing.** The following items must be completed before forum can be manually tested end-to-end.

#### 3.4.1 Hydration & Subscriptions
- [ ] **Hydrate on Init:** Update `createForumStore` to subscribe to `vh/forum/indexes/date` (or `vh/forum/threads`) on mount and populate the `threads` map from Gun.
- [ ] **Live Sync:** Subscribe for live updates so new threads/comments from other users appear without page reload.
- [ ] **Comment Hydration:** Load comments from `vh/forum/threads/<threadId>/comments` when viewing a thread.
- [ ] **Use Index Chains:** The `getForumDateIndexChain` and `getForumTagIndexChain` adapters exist but are never used; wire them for efficient discovery.

#### 3.4.2 VENN → Forum CTA Flow
- [ ] **Deduplicate Threads:** In `HermesForumPage`, check if a thread with `sourceAnalysisId === search.sourceAnalysisId` already exists before showing `NewThreadForm`.
- [ ] **Redirect to Existing:** If found, navigate to `/hermes/forum/$threadId` instead of showing the creation form.
- [ ] **Note:** `AnalysisView.tsx` has the lookup logic, but it fails because `forumStore.threads` is always empty on reload (no hydration).

#### 3.4.3 Error Handling & Validation
- [ ] **Error UI in NewThreadForm:** Add error state and toast/message to display Zod validation errors (e.g., "Title too long", "Content required").
- [ ] **Error UI in CommentComposer:** Same — surface validation failures to the user.
- [ ] **Loading States:** Show loading indicators while hydrating thread/comment data.

#### 3.4.4 Trust Gate Testing
- [ ] **Allow Low-Trust Identity Creation:** In `useIdentity.createIdentity`, remove or gate the hard throw when `trustScore < 0.5` so a low-trust identity can be persisted for testing the `TrustGate` component.
- [ ] **Dev Toggle Option:** Add a mechanism (e.g., username prefix `untrusted-*` or checkbox in dev mode) that forces the mock attestation to return a low trust score.

---

## 4. XP Hooks – Messaging, Forum & Projects (v0)

**Goal:** XP feels like proto-income for real civic work, not a lootbox for button mashing.

### 4.1 General XP Rules (v0)

**XP Types & Scope:**
- `socialXP`: Interpersonal graph & messaging (HERMES Messaging).
- `civicXP`: Public discourse & deliberation (HERMES Forum, later VENN).
- `projectXP`: Concrete project/proposal work (Forum threads tagged `Project` / `Proposal`).

**Monotonic, Local-Only:**
- XP is monotonic in v0: only increases; no clawbacks (even if content is later downvoted).
- XP is stored only in the on-device XP ledger (`spec-xp-ledger-v0.md`).
- No `{nullifier, XP}` or raw XP values are written to Gun, relays, or chain.

**Trust Gating:**
- **Messaging XP:** Requires an active LUMA session (identity + attestation). Adds no extra trustScore threshold beyond the global session gate.
- **Forum XP:** Requires `trustScore >= 0.5` on the current session, same as Forum write/vote gating.

**Caps (Defaults, Tunable):**

Per nullifier, local-only:
- **Daily caps:**
    - `socialXP`: max +5/day.
    - `civicXP`: max +15/day.
- **Weekly cap:**
    - `projectXP`: max +20 per rolling 7-day window.

Emission parameters (caps, amounts, thresholds) are Season 0 defaults and can be changed in future versions without retro-editing historical XP.

### 4.2 Messaging XP (`socialXP`) – "Build Real Ties, Not Spam"

**Goal:** Reward forming & sustaining real relationships, not blasting cold DMs.

**A. First Contact Bonus**
- **Event:** User sends the first DM ever to a given identity key (new contact).
- **Reward:** +2 `socialXP`.
- **Constraints:**
    - Only once per unique contact (per nullifier lifetime).
    - Hard cap: at most 3 first-contact XP events per day (theoretical +6, but global cap clips at +5/day).

**B. Sustained Conversation Bonus**
- **Event:** A DM channel between two identities qualifies as a sustained conversation:
    - Within any 48h window:
        - Each participant has sent ≥3 messages, AND
        - Total messages in that window ≥6.
- **Reward:** +1 `socialXP` to each participant.
- **Constraints:**
    - At most 1 sustained-conversation bonus per channel per 7-day window per participant.
    - Only awarded if the user has an active LUMA session at the time the condition is detected.

**C. Daily Messaging Cap**
- Total messaging-derived XP is clipped at +5 `socialXP` per day per nullifier.
- If a new event would exceed the daily cap, award only the remaining room (or zero).

### 4.3 Forum XP (`civicXP`) – "Reward Received Contributions, Not Just Noise"

**Goal:** XP flows to people thinking in public (threads, comments, counterpoints) and having other verified humans find that work useful.

**A. Base Participation XP**

**New Thread (Authoring)**
- **Event:** User creates a new Forum Thread (any tag).
- **Reward:** +2 `civicXP` to the author (once per thread).
- **Constraints:**
    - XP only if `trustScore >= 0.5` at creation time.
    - At most 3 XP-earning thread creations per day → max +6 `civicXP`/day from thread creation.

**Substantive Comment / Counterpoint**
- **Event:** User posts a Comment (`type: 'reply' | 'counterpoint'`) with "substantive" content (heuristic: ≥280 chars).
- **Reward:**
    - On a thread **not** authored by the commenter: +1 `civicXP` for the first 3 substantive comments per thread (per user).
    - On a thread authored by the commenter: +1 `civicXP` for the first 2 substantive comments per thread (per user), then 0 (prevents infinite self-bumping).
- **Constraints:**
    - Global cap: at most +10 `civicXP` per day from comment/counterpoint creation.

**B. Quality Bonus XP (Community Reception)**

All quality bonuses trigger on net score:
```typescript
netScore = upvotes - downvotes; // from verified voters only (trustScore >= 0.5)
```

XP is awarded once on crossing each threshold (track per `{contentId, threshold}` locally).

**Thread Quality Bonuses**
- **Event:** A Thread authored by the user crosses thresholds:
    - `netScore >= 3` (previously <3): +1 `civicXP`.
    - `netScore >= 10` (previously <10): +2 `civicXP`.
- **Cap:** Max +3 `civicXP` per thread from quality bonuses.

**Comment / Counterpoint Quality Bonuses**
- **Event:** A Comment (reply or counterpoint) crosses thresholds:
    - `netScore >= 3`: +1 `civicXP`.
    - `netScore >= 10`: additional +1 `civicXP` (total +2).
- **Cap:** Max +2 `civicXP` per comment from quality bonuses.

**No Negative XP in v0**
- If scores later drop (e.g., from 5 to -1), XP is not clawed back. Emissions are strictly monotonic in v0.

**C. Voting**
- **No XP from Votes (v0):** Casting up/downvotes does not grant XP.
- **Rationale:** Voting is cheap and easily farmed. In Season 0, XP should mostly reward higher-friction work: writing threads, comments, counterpoints that others endorse.

### 4.4 Project XP (`projectXP`) – "From Talk → Build"

**Goal:** Encourage users to start & maintain real projects/proposals, and to contribute quality critique and design help. This is proto "creator income".

Project XP rides on Forum structures and tags.

**A. Project / Proposal Threads**

**Project/Proposal Thread Creation**
- **Event:** User creates a Thread tagged `Project` or `Proposal` (canonical tag set).
- **Reward:**
    - +2 `projectXP` to the author.
    - +1 `civicXP` to the author (on top of the base +2 `civicXP` from thread creation, if applied).
- **Constraints:**
    - At most 2 XP-earning Project/Proposal threads per 7-day window per user.

**B. Project Updates (For Initiators)**

**Milestone Update Comments (Author Only)**
- **Event:** On their own Project/Proposal thread, the author posts a comment flagged `isUpdate = true` with substantive content (progress, roadmap, budget, etc.).
- **Reward:** +1 `projectXP` per qualifying update.
- **Constraints:**
    - At most 3 update-credits per project thread per 7-day window per author.

**C. Collaborator Contributions (Other Participants)**

**Substantive Collaborator Comment**
- **Event:** User posts a substantive comment/counterpoint on a Project/Proposal thread they did not author, and that comment later reaches `netScore >= 3`.
- **Reward:**
    - On posting: +1 `civicXP` (from general comment rules).
    - On hitting `netScore >= 3`: additional +1 `projectXP` (quality-confirmed collaboration).
- **Constraints:**
    - At most 2 collaborator `projectXP` events per project thread per user.
    - At most +5 `projectXP` per week from collaborator contributions per user.

**D. Outcome Bonus (Optional v0, S0-Configurable)**

**Funded / Selected Projects**
- **Event:** A curated process (off-chain tool or governance script) marks a Project/Proposal thread as funded/selected (e.g., QF outcome).
- **Reward:** One-time +5 `projectXP` to the primary author.
- **Scope, Season 0:**
    - Dev/curator-driven only; no public UI for triggering.
    - Lets you prototype a "founder bonus" without wiring XP→RVU yet.

### 4.5 Restatement: Privacy & Topology

- XP, XP deltas, and `{district_hash, nullifier, XP}` tuples are **never** written to Gun, relays, or chain.
- Messaging & Forum see only:
    - Identity-level keys (nullifier / stable pubkey).
    - Trust gating info (does this session meet the threshold? yes/no).
    - Raw thread/comment scores and content per existing specs.
- **XP → GWC linkage stays off-chain in Season 0:**
    - XP is the local participation ledger that will later prototype RVU distribution weights (`spec-rvu-economics-v0.md` §8).
    - Season 0: Clients may show local XP dashboards and simulated "share of pool" numbers, but no on-chain minting logic depends on XP yet.

### 4.6 XP Implementation Tasks

**Centralized XP Logic:** All XP emission logic lives in a dedicated module to prevent XP updates from scattering across React components.

- [x] **XP Ledger Helpers (`apps/web-pwa/src/store/xpLedger.ts`):**
    - Implement `useXpLedger` (Zustand) managing `XpLedger` per `spec-xp-ledger-v0.md`.
    - Expose:
        - `applyMessagingXP(event: MessagingXPEvent): void` — handles first-contact and sustained-conversation bonuses.
        - `applyForumXP(event: ForumXPEvent): void` — handles thread/comment creation and quality bonuses.
        - `applyProjectXP(event: ProjectXPEvent): void` — handles project creation, updates, and collaborator bonuses.
    - Internally enforce daily/weekly caps and track per-entity thresholds (e.g., `{contentId, threshold}` for quality bonuses).
    - Store ledger in `localStorage: vh_xp_ledger`.

- [x] **Wire XP Updates from Messaging Store:**
    - In `useChatStore`, after successful `sendMessage`:
        - Emit `MessagingXPEvent` for first-contact bonus (if new contact).
        - Emit `MessagingXPEvent` for sustained-conversation bonus (if 48h window criteria met).
    - Call `useXpLedger.applyMessagingXP(event)`.

- [x] **Wire XP Updates from Forum Store:**
    - In `useForumStore`, after successful thread/comment creation:
        - Emit `ForumXPEvent` with `type: 'thread_created' | 'comment_created'`.
    - On vote count changes (observed via subscription):
        - Emit `ForumXPEvent` with `type: 'quality_bonus'` when thresholds crossed.
    - Call `useXpLedger.applyForumXP(event)`.

- [x] **Unit Tests for XP Module:**
    - First-contact bonus fires once per contact, respects 3/day cap.
    - Sustained-conversation bonus respects 48h window and 1/week/channel limit.
    - Thread/comment creation XP respects daily caps and self-comment limits.
    - Quality bonus fires exactly once per `{contentId, threshold}`.
    - Project XP respects weekly caps.
    - No XP emitted when `trustScore < 0.5` for Forum events.
    - Monotonicity: XP never decreases.

### 4.7 Outstanding Implementation Work (XP Wiring)

> ⚠️ **Blocking manual testing.** XP awarded from messaging/forum does not appear in the UI.

#### 4.7.1 Unify XP Ledger Stores — **CRITICAL**
- [ ] **Two Conflicting Stores Exist:**
    - `apps/web-pwa/src/store/xpLedger.ts` — Used by `hermesMessaging.ts` and `hermesForum.ts`. Has `applyMessagingXP()`, `applyForumXP()`, `applyProjectXP()`.
    - `apps/web-pwa/src/hooks/useXpLedger.ts` — Used by `WalletPanel.tsx`, `ProposalList.tsx`, `useGovernance.ts`. Has `addXp()`, `calculateRvu()`, `claimDailyBoost()`.
- [ ] **Result:** When a user posts a forum thread or sends a message, XP is awarded via `store/xpLedger.ts`, but `WalletPanel` reads from `hooks/useXpLedger.ts` — a completely different Zustand store. **The UI never updates.**
- [ ] **Fix:** Delete `hooks/useXpLedger.ts`. Refactor `store/xpLedger.ts` to also export a `useXpLedger` hook with the UI-facing methods (`addXp`, `calculateRvu`, `claimDailyBoost`), or merge the two interfaces. Update `WalletPanel` and other UI components to import from `../store/xpLedger`.
- [ ] **Align Caps:** Ensure the unified store's caps match this document (§4.1).

---

## 5. Phase 3: Verification & Hardening

### 5.1 App Store Wiring (E2E)
- [x] **App Store Wiring (E2E):** Ensure `init()` (in `useAppStore`) checks `VITE_E2E_MODE` and:
    - Skips `createClient()` / Gun init.
    - Wires Messaging to in-memory `useChatStore` mock.
    - Wires Forum to in-memory `useForumStore` mock.
    - Still enforces trust gating using the local identity hook.

### 5.2 Automated Tests

#### 5.2.1 Unit Tests (100% Coverage)
- [x] `Message` & `Channel` Zod schemas (valid/invalid cases).
- [x] `Thread` & `Comment` schemas (including `type: 'counterpoint'` and optional `targetId` cases).
- [x] `deriveChannelId` determinism (same inputs → same output).
- [x] Encryption helpers: `encryptMessagePayload` / `decryptMessagePayload` round-trips.
- [x] `computeThreadScore` decay behavior over time.
- [x] TopologyGuard: assert invalid paths are rejected for HERMES/Forum namespaces.

#### 5.2.2 Integration Tests (Vitest)
- [x] `useChatStore.sendMessage` writes to inbox/outbox/chats with no plaintext in Gun.
- [x] Message deduplication by `id` works across inbox/outbox/chats.
- [x] Forum store:
    - Cannot create threads/comments when `trustScore < 0.5`.
    - Can vote only once per user per target; updates are idempotent.
- [x] XP emission:
    - First contact bonus fires once per contact.
    - Daily caps are respected.
    - Quality bonuses fire on threshold crossing.

#### 5.2.3 E2E Tests (Playwright, with `VITE_E2E_MODE=true`)

**Multi-User E2E Infrastructure (Implemented):**
- [x] **SharedMeshStore:** In-memory mock mesh shared across isolated Playwright browser contexts (`packages/e2e/src/fixtures/multi-user.ts`).
- [x] **User Fixtures:** `alice` and `bob` fixtures with `context.exposeFunction` for cross-context mesh sync.
- [x] **Unique E2E Identities:** Each mock identity gets a unique nullifier to prevent collision in multi-user tests.
- [x] **Testing Strategy:** Documented in `docs/TESTING_STRATEGY.md`.

**Single-User Flows:**
- [x] **Golden Path E2E:** Identity → Attestation → Wallet → UBE → Analysis (`full-flow.spec.ts`).
- [x] **Tracer Bullet:** Basic Identity → Analysis loop (`tracer-bullet.spec.ts`).

**Multi-User Flows:**
- [x] **Isolated Contexts:** Alice and Bob have separate identities; both can access HERMES.
- [x] **Shared Mesh Sync:** Data written by Alice is visible to Bob via shared mesh.
- [x] **Forum Integration:**
    - Authenticated user with `trustScore >= 0.5` creates thread, reply, and counterpoint.
    - User with `trustScore < 0.5` can read but sees "verify identity" gate on write/vote.
- [x] **Messaging E2E:**
    - Bob enters Alice's identity key and sends a message.
    - Alice sees the message via shared mesh sync.

### 5.3 Manual Verification Plan

#### 5.3.1 Messaging
- [ ] Open App in two browser windows (Incognito).
- [ ] Create two identities.
- [ ] Start DM via QR scan or manual key entry.
- [ ] Exchange messages.
- [ ] Verify persistence (reload page).
- [ ] **Verify encryption:** Inspect the raw Gun payload under `~<recipient_identityKey>/hermes/inbox` and confirm it is encrypted (no message text visible in dev tools).
- [ ] **Multi-device sync:** Link a second device and confirm chat history appears on both after hydration.

#### 5.3.2 Forum
- [ ] Create Thread.
- [ ] Post Comment.
- [ ] Add Counterpoint to Comment.
- [ ] Verify visual layout (side-by-side or distinct expandable section).
- [ ] **Auto-collapse:** Verify that hiding low-score content (auto-collapse) kicks in when votes are negative.
- [ ] **Sorting:** Verify that "Hot" sorting differs from "New" for older-but-upvoted threads.

---

### 5.4 Outstanding Implementation Work (Verification & E2E)

> ⚠️ **Blocking E2E test fidelity.** The mock client doesn't support subscriptions.

#### 5.4.1 Mock/E2E Client Subscriptions
- [ ] **Extend Mock Gun Client:** The mock client in `store/index.ts` (used when `VITE_E2E_MODE=true`) only supports `.once()` and `.put()`. Add `.on()` and `.map()` support so messaging/forum subscriptions work in tests.
- [ ] **Live Sync in E2E:** Without subscription support, multi-user E2E tests can't verify real-time data flow.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| GunDB sync latency for real-time chat | Aggressive local caching and optimistic UI. |
| Plaintext leakage in mesh | E2EE via SEA; integration tests assert encrypted payloads only. |
| Scope creep (group chat, push notifications) | Defer explicitly to v1+; strict backlog hygiene. |
| Identity/trust divergence | Reuse `useIdentity` hook; single source of truth for trustScore. |
| E2E test flakiness with network mocks | True Offline Mode with full mocks; no network I/O in E2E. |
| XP farming / Sybil attacks | Caps, substantive content heuristics, quality-gated bonuses. |

---

## 7. Dependencies & Deliverables

### 7.1 Package Dependencies
- `@vh/gun-client` — Gun adapters and encryption helpers.
- `@vh/data-model` — Zod schemas for Message, Channel, Thread, Comment.
- `@vh/types` — Shared TypeScript types.
- `@vh/crypto` — Browser-safe hashing utilities for `deriveChannelId`.

### 7.2 Deliverables
- [x] Secure 1:1 E2EE Messaging with QR-based contact discovery.
- [x] Threaded Civic Forum with counterpoint structure and trust-gated participation.
- [x] XP hooks for Messaging, Forum, and Project contributions.
- [x] Full test coverage (unit, integration, E2E) — **9 E2E tests passing**.
- [x] Updated specs (`spec-hermes-messaging-v0.md`, `spec-hermes-forum-v0.md`).

---

## 8. Sprint 3 Status Summary

**Status:** 🚧 In Progress (Dec 4, 2025)
**Automated Tests:** ✅ Passing
**Manual Testing:** ❌ Blocked by implementation gaps

### 8.1 Test Results
| Suite | Tests | Status |
|-------|-------|--------|
| Unit (Vitest) | All | ✅ Passing |
| Integration (Vitest) | All | ✅ Passing |
| E2E Single-User | 2 | ✅ Passing |
| E2E Multi-User | 7 | ✅ Passing |
| **Total E2E** | **9** | ✅ **All Passing** |

### 8.2 Key Implementations (Complete)
1. **Schemas:** `Message`, `Channel`, `Thread`, `Comment`, `ModerationEvent` with Zod validation
2. **Gun Adapters:** Hermes inbox/outbox/chats, Forum threads/comments/indexes
3. **Encryption Helpers:** SEA-based E2E encryption via `hermesCrypto.ts`
4. **Stores:** `useChatStore`, `useForumStore`, `useXpLedger` (Zustand)
5. **UI:** Full HERMES Messaging and Forum interfaces with trust gating
6. **Testing:** Multi-user E2E infrastructure with shared mock mesh

### 8.3 Blocking Gaps Summary

| Area | Gap | Impact | Section |
|------|-----|--------|---------|
| Messaging | No hydration on init | Messages lost on reload | §2.4.1 |
| Messaging | Invalid encryption keys | Decryption fails | §2.4.2 |
| Messaging | `subscribeToChannel` never called | No live updates | §2.4.1 |
| Messaging | Timeout stays `pending` | Misleading status | §2.4.3 |
| Forum | No hydration on init | Threads lost on reload | §3.4.1 |
| Forum | Index chains unused | No efficient discovery | §3.4.1 |
| Forum | VENN CTA dedup fails | Duplicate threads | §3.4.2 |
| Forum | Low-trust identity blocked | Can't test TrustGate | §3.4.4 |
| XP | Two conflicting stores | UI never updates | §4.7.1 |
| E2E | Mock client lacks `.on()` | No live sync in tests | §5.4.1 |

### 8.4 Files Summary
- **14 files** modified in final pass (+145/-32 lines)
- All HERMES components now have `data-testid` attributes
- Mock forum store wired to shared mesh for cross-context sync

### 8.5 Next Steps
1. Complete outstanding implementation work (§2.4, §3.4, §4.7, §5.4)
2. Execute manual test checklist (`docs/MANUAL_TEST_CHECKLIST_SPRINT3.md`)
3. Upon successful manual testing, mark Sprint 3 as ✅ Complete
4. Proceed to `docs/04-sprint-4-the-bridge.md` for The Bridge (Attestation Bridge, Cross-Device Sync, AGORA Governance)
