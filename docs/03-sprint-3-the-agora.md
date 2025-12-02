# Sprint 3: The Agora - Communication (Implementation Plan)

**Context:** `System_Architecture.md` v0.2.0 (Sprint 3: The "Agora" - Communication)
**Goal:** Implement the "Agora" – the civic dialogue layer. This consists of **HERMES Messaging** (secure, private communication) and **HERMES Forum** (threaded civic discourse).
**Status:** [ ] Planning

---

## 1. Guiding Constraints & Quality Gates

- [ ] **Non-Negotiables:**
    - [ ] **LOC Cap:** Hard limit of **350 lines** per file (tests/types exempt).
    - [ ] **Coverage:** **100%** Line/Branch coverage for new/modified modules.
    - [ ] **Browser-Safe:** No `node:*` imports in client code.
    - [ ] **Security:** E2EE (End-to-End Encryption) for all private messages.
    - [ ] **Privacy:** No metadata leakage; "First-to-File" principles apply to public civic data.

---

## 2. Phase 1: HERMES Messaging (The Nervous System)

**Objective:** Enable secure, peer-to-peer, end-to-end encrypted messaging between verified identities.

### 2.1 Data Model & Schema (`packages/data-model`)
- [ ] **Schema Definition:** Create `packages/data-model/src/schemas/hermes/message.ts`.
    - `Message`: `{ id, sender, recipient, timestamp, content (encrypted), signature }`
    - `Channel`: `{ id, participants[], type: 'dm' | 'group', lastMessageAt }`
    - **Validation:** Zod schemas for strict runtime checking.
- [ ] **Types:** Export TypeScript types to `packages/types`.

### 2.2 Transport Layer (`packages/gun-client`)
- [ ] **Encryption Wrappers:** Implement SEA (Security, Encryption, Authorization) helpers.
    - `encryptMessage(content, sharedKey)`
    - `decryptMessage(encryptedContent, sharedKey)`
- [ ] **Storage Logic:** Implement `useChatStore` (Zustand + Gun).
    - `sendMessage(recipient, content)`: Encrypt -> Sign -> Put to Gun.
    - `subscribeToMessages(channelId)`: Live query for new messages.
    - **Privacy:** Ensure messages are stored in user-scoped, encrypted paths (`~user/hermes/chats/...`).

### 2.3 UI Implementation (`apps/web-pwa`)
- [ ] **Components:**
    - `ChatLayout`: Split view (Channel List / Message Thread).
    - `ChannelList`: Virtualized list of active conversations.
    - `MessageBubble`: Sent/Received styles, timestamp, status (sending/sent/read).
    - `Composer`: Input area with auto-expanding text, send button.
- [ ] **Features:**
    - **Direct Messages:** 1:1 flow. Lookup user by Nullifier/Handle -> Start Chat.
    - **Optimistic UI:** Display messages immediately while syncing in background.

---

## 3. Phase 2: HERMES Forum (The Agora)

**Objective:** A threaded conversation platform combining Reddit-style threads with VENN's bias/counterpoint tables.

### 3.1 Data Model (`packages/data-model`)
- [ ] **Schema Definition:** Create `packages/data-model/src/schemas/hermes/forum.ts`.
    - `Thread`: `{ id, title, content, author, timestamp, tags[], upvotes, downvotes }`
    - `Comment`: `{ id, threadId, parentId, content, author, timestamp, upvotes, counterpoints[] }`
    - `Counterpoint`: `{ id, commentId, content, author, timestamp, upvotes }`

### 3.2 UI Implementation (`apps/web-pwa`)
- [ ] **Components:**
    - `ForumFeed`: List of active threads sorted by engagement/time.
    - `ThreadView`: Main post + nested comment tree.
    - `CommentNode`: The comment content + "Counterpoints" side-panel or expandable section.
- [ ] **Features:**
    - **Structured Debate:** Users can reply normally OR post a "Counterpoint" which appears distinctly next to the original point.
    - **Voting:** Upvote/Downvote logic (using `civicXP` weight if applicable).

---

## 4. Phase 3: Verification & Hardening

### 4.1 Automated Tests
- [ ] **Unit Tests:** 100% coverage for Schema and Encryption logic.
- [ ] **E2E Tests:**
    - **Messaging:** Simulator "Alice" sends message to "Bob". Verify delivery and decryption.
    - **Forum:** Create Thread, Comment, Counterpoint. Verify structure.

### 4.2 Manual Verification Plan
- [ ] **Messaging:**
    1. Open App in two browser windows (Incognito).
    2. Create two identities.
    3. Start DM.
    4. Exchange messages.
    5. Verify persistence (reload page).
- [ ] **Forum:**
    1. Create Thread.
    2. Post Comment.
    3. Add Counterpoint to Comment.
    4. Verify visual layout (side-by-side or distinct).

---

## 5. Risks & Mitigations
- **Risk:** GunDB sync latency for real-time chat.
    - *Mitigation:* Aggressive local caching and optimistic UI.
