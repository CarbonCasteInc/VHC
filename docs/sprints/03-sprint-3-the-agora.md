# Sprint 3: The Agora - Communication (Implementation Plan)

**Context:** `System_Architecture.md` v0.2.0 (Sprint 3: The "Agora" - Communication)
**Goal:** Implement the "Agora" – the civic dialogue layer. This consists of **HERMES Messaging** (secure, private communication) and **HERMES Forum** (threaded civic discourse).
**Status:** ✅ **COMPLETE** — All core functionality verified (Dec 6, 2025)

> ✅ **HERMES Messaging — READY FOR PRODUCTION** (Dec 5, 2025)
>
> All unit tests (242+), E2E tests (10), and manual tests passing.
>
> **Resolved (Phase 1-3 Messaging):**
> - ✅ Gun path architecture — `vh/hermes/inbox/${devicePub}` + authenticated user paths
> - ✅ Directory service — nullifier → devicePub lookup
> - ✅ Gun authentication — `gun.user().auth(devicePair)` on init
> - ✅ Chain wrapper — `on`, `off`, `map` methods for subscriptions
> - ✅ Decryption logic — Correct peer epub for own vs received messages
> - ✅ Gun callback deduplication — TTL-based seen message tracking
> - ✅ Channel persistence — localStorage + Gun hydration
> - ✅ Contact persistence — Per-identity contact storage
>
> **Resolved (Phase 4 Forum — Thread Creation & Hydration):**
> - ✅ Vote persistence — localStorage `vh_forum_votes:<nullifier>`
> - ✅ Thread hydration via `.map().on()` with schema validation
> - ✅ TTL-based deduplication (mirrors messaging)
> - ✅ Index writes on thread creation (date + tag indexes)
> - ✅ `stripUndefined()` helper — Sanitizes objects before Gun write
> - ✅ `serializeThreadForGun()` / `parseThreadFromGun()` — JSON-stringify `tags` array
> - ✅ Gun metadata filtering — Strip `_` property, check required fields first
> - ✅ Lazy hydration — Retry on first user action if client not ready at init
> - ✅ Per-store hydration tracking — WeakSet prevents test isolation issues
> - ✅ **Thread persistence verified** — Threads survive page refresh ✅
> - ✅ **Cross-user sync verified** — Threads appear across browser instances ✅
>
> **Resolved (Phase 4.3 — Comment Persistence):**
> - ✅ **Comment persistence verified** — Comments survive page refresh ✅
> - ✅ **Cross-user comment sync verified** — Comments appear across browser instances ✅

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
- [ ] **TopologyGuard Update:** *(Updated per §2.4.0.3)* Extend TopologyGuard allowed prefixes to include:
    - `vh/directory/` — Public directory (nullifier → devicePub lookup)
    - `vh/hermes/inbox/` — Public inbox (message delivery, keyed by devicePub)
    - `~*/hermes/outbox` — Authenticated outbox (via `gun.user()`)
    - `~*/hermes/chats` — Authenticated chat history (via `gun.user()`)
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
    - **AGORA** = Governance & projects (Sprint 5+): Collaborative documents, project/policy development, decision-making.
- [x] **Routing:**
    - HERMES tab → `/hermes` → surfaces both Messaging and Forum.
    - AGORA tab → `/governance` (or `/agora`) → governance/proposals (Sprint 5+).
- [x] **Elevation Path (Future):** Forum threads can be elevated into AGORA projects based on engagement, upvotes, and tags. *Deferred to Sprint 5.*

---

## 2. Phase 1: HERMES Messaging (The Nervous System)

**Objective:** Enable secure, peer-to-peer, end-to-end encrypted messaging between verified identities.
**Canonical Reference:** `docs/specs/spec-hermes-messaging-v0.md`

### 2.1 Data Model & Schema (`packages/data-model`)
- [x] **Schema Definition:** Implement `Message` and `Channel` exactly as defined in `docs/specs/spec-hermes-messaging-v0.md` §2 in `packages/data-model/src/schemas/hermes/message.ts`:
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

> ⚠️ **SUPERSEDED:** The path structure below is being replaced by §2.4.0. The new architecture uses:
> - `vh/hermes/inbox/${devicePub}` — Public inbox (keyed by SEA pubkey, not nullifier)
> - `gun.user().get('hermes').get('outbox')` — Authenticated outbox
> - `gun.user().get('hermes').get('chats')` — Authenticated chat history
> - Directory service for nullifier → devicePub lookup
>
> See §2.4.0.4 for updated adapter signatures.

- [x] ~~**Gun adapters:** Expose helpers using identity keys (nullifiers):~~
    - ~~`getHermesInboxChain(identityKey: string) -> ChainWithGet<Message>`~~
    - ~~`getHermesOutboxChain(identityKey: string) -> ChainWithGet<Message>`~~
    - ~~`getHermesChatChain(identityKey: string, channelId: string) -> ChainWithGet<Message>`~~
- [x] ~~**Namespace Topology:** Implement paths per `spec-hermes-messaging-v0.md` §3.1:~~
    - ~~`~<recipient_identityKey>/hermes/inbox` — Sender writes encrypted message reference here.~~
    - ~~`~<sender_identityKey>/hermes/outbox` — Sender writes copy for multi-device sync.~~
    - ~~`~<user_identityKey>/hermes/chats/<channelId>` — Local view of the conversation.~~
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

> ❌ **BLOCKED (Dec 4, 2025).** Three critical issues prevent messaging:
> 1. **Gun path architecture** — Paths use `~${nullifier}/...` but nullifiers aren't valid Gun SEA pubkeys
> 2. **No directory service** — Can't look up recipient's `devicePub` for message delivery
> 3. **No Gun authentication** — Need `gun.user().auth(devicePair)` on init for authenticated writes
>
> These cause `Unverified data` and `DataError: The JWK's "x" member defines an octet string of length 37 bytes but should be 32`

---

#### 2.4.0 CRITICAL: Gun Authentication & Path Architecture (Blocking)

**Problem Summary:**

The current implementation uses `~${nullifier}/hermes/inbox` paths, but Gun's `~pubkey/` namespace requires a **valid 32-byte ECDSA public key**. Nullifiers (e.g., `dev-nullifier-xxx`) are arbitrary strings that Gun SEA rejects with "Unverified data."

**Root Cause:**
| Issue | Current | Required |
|-------|---------|----------|
| Inbox path | `~${nullifier}/hermes/inbox` | `vh/hermes/inbox/${devicePub}` (public) |
| Outbox path | `~${nullifier}/hermes/outbox` | `~${devicePub}/hermes/outbox` (authenticated) |
| Gun auth | None | `gun.user().auth(devicePair)` on init |
| Device lookup | None | Directory service: nullifier → devicePub |

**Architecture Decision:**
- **Nullifiers** = Privacy-preserving civic identity (for routing, channel derivation, UI)
- **Device pubkeys** = Gun namespace keys (for authenticated writes)
- **Directory service** = Public lookup from nullifier to device keys

---

##### 2.4.0.1 Directory Service Schema

**New File:** `packages/data-model/src/schemas/hermes/directory.ts`

```typescript
import { z } from 'zod';

export const DirectoryEntrySchema = z.object({
  schemaVersion: z.literal('hermes-directory-v0'),
  nullifier: z.string().min(1),
  devicePub: z.string().min(1),    // Gun SEA pub key (for inbox path)
  epub: z.string().min(1),          // ECDH encryption pub key
  displayName: z.string().optional(),
  registeredAt: z.number(),
  lastSeenAt: z.number()
});

export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;
```

- [ ] Create `packages/data-model/src/schemas/hermes/directory.ts`
- [ ] Export from `packages/data-model/src/index.ts`
- [ ] Add `DirectoryEntry` to `packages/types/src/index.ts`
- [ ] Add unit tests for schema validation

---

##### 2.4.0.2 Directory Gun Adapter

**New File:** `packages/gun-client/src/directoryAdapters.ts`

```typescript
import type { VennClient } from './types';
import type { DirectoryEntry } from '@vh/data-model';

export function getDirectoryChain(client: VennClient, nullifier: string) {
  return client.gun.get('vh').get('directory').get(nullifier);
}

export async function lookupByNullifier(
  client: VennClient, 
  nullifier: string
): Promise<DirectoryEntry | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
    getDirectoryChain(client, nullifier).once((data) => {
      clearTimeout(timeout);
      if (data && typeof data === 'object' && 'devicePub' in data) {
        resolve(data as DirectoryEntry);
      } else {
        resolve(null);
      }
    });
  });
}

export function publishToDirectory(
  client: VennClient,
  entry: DirectoryEntry
): Promise<void> {
  return new Promise((resolve, reject) => {
    getDirectoryChain(client, entry.nullifier).put(entry, (ack) => {
      if (ack?.err) reject(new Error(ack.err));
      else resolve();
    });
  });
}
```

- [ ] Create `packages/gun-client/src/directoryAdapters.ts`
- [ ] Export from `packages/gun-client/src/index.ts`
- [ ] Add unit tests for CRUD operations

---

##### 2.4.0.3 Topology Update

**File:** `packages/gun-client/src/topology.ts`

Update `ALLOWED_PREFIXES`:

```typescript
// Directory (public)
{ pathPrefix: 'vh/directory/', classification: 'public' },

// HERMES inbox (public write - sender delivers here)
{ pathPrefix: 'vh/hermes/inbox/', classification: 'sensitive' },

// HERMES outbox/chats (authenticated - owner only, uses ~pubkey)
{ pathPrefix: '~*/hermes/outbox', classification: 'sensitive' },
{ pathPrefix: '~*/hermes/chats', classification: 'sensitive' },
```

- [ ] Add `vh/directory/` to allowed prefixes
- [ ] Add `vh/hermes/inbox/` to allowed prefixes (public delivery)
- [ ] Keep `~*/hermes/outbox` and `~*/hermes/chats` (authenticated)
- [ ] Remove old `~*/hermes/inbox` entry
- [ ] Update topology tests

---

##### 2.4.0.4 Updated Hermes Adapters

**File:** `packages/gun-client/src/hermesAdapters.ts`

```typescript
// PUBLIC inbox - anyone can write (for message delivery)
export function getHermesInboxChain(client: VennClient, devicePub: string) {
  return client.gun.get('vh').get('hermes').get('inbox').get(devicePub);
}

// AUTHENTICATED outbox - only owner can write
export function getHermesOutboxChain(client: VennClient) {
  return client.gun.user().get('hermes').get('outbox');
}

// AUTHENTICATED chat history - only owner can write
export function getHermesChatChain(client: VennClient, channelId: string) {
  return client.gun.user().get('hermes').get('chats').get(channelId);
}
```

**Key changes:**
- Inbox uses `vh/hermes/inbox/${devicePub}` (public path, devicePub as identifier)
- Outbox/chats use `gun.user()` which writes to authenticated `~${authedPub}/...`
- Remove `identityKey` parameter from outbox/chats (uses authenticated user)

- [ ] Update `getHermesInboxChain` to use `vh/hermes/inbox/${devicePub}`
- [ ] Update `getHermesOutboxChain` to use `gun.user().get('hermes').get('outbox')`
- [ ] Update `getHermesChatChain` to use `gun.user().get('hermes').get('chats')`
- [ ] Update adapter tests
- [ ] Update guarded chain logic for new path structure

---

##### 2.4.0.5 Gun Authentication on Init

**File:** `apps/web-pwa/src/store/index.ts`

Add Gun user authentication during app initialization:

```typescript
async function authenticateGunUser(
  client: VennClient, 
  devicePair: { pub: string; priv: string; epub: string; epriv: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already authenticated
    if (client.gun.user().is) {
      console.info('[vh:gun] Already authenticated');
      resolve();
      return;
    }
    
    client.gun.user().auth(devicePair as any, (ack: any) => {
      if (ack.err) {
        console.error('[vh:gun] Auth failed:', ack.err);
        reject(new Error(ack.err));
      } else {
        console.info('[vh:gun] Authenticated as', devicePair.pub.slice(0, 12) + '...');
        resolve();
      }
    });
  });
}

async function publishDirectoryEntry(
  client: VennClient,
  identity: IdentityRecord
): Promise<void> {
  const entry: DirectoryEntry = {
    schemaVersion: 'hermes-directory-v0',
    nullifier: identity.session.nullifier,
    devicePub: identity.devicePair!.pub,
    epub: identity.devicePair!.epub,
    registeredAt: Date.now(),
    lastSeenAt: Date.now()
  };
  await publishToDirectory(client, entry);
  console.info('[vh:directory] Published entry for', identity.session.nullifier.slice(0, 20) + '...');
}
```

Update `init()`:

```typescript
async init() {
  // ... existing client creation ...
  
  const identity = loadIdentity();
  if (identity?.devicePair && client) {
    try {
      await authenticateGunUser(client, identity.devicePair);
      await publishDirectoryEntry(client, identity);
    } catch (err) {
      console.warn('[vh:gun] Auth/directory publish failed, continuing anyway:', err);
    }
  }
}
```

**Note:** `gun.user().auth()` must run on each page load. Gun may persist the session in localStorage but this is not guaranteed. Make init robust to handle auth failures gracefully.

- [ ] Add `authenticateGunUser` function
- [ ] Add `publishDirectoryEntry` function
- [ ] Call both in `init()` after client creation
- [ ] Handle auth failures gracefully (log warning, continue)
- [ ] Add tests for auth flow

---

##### 2.4.0.6 Identity Creation - Publish to Directory

**File:** `apps/web-pwa/src/hooks/useIdentity.ts`

After creating identity, authenticate and publish:

```typescript
async function createIdentity(username: string) {
  // ... existing devicePair generation ...
  
  // Persist identity
  persistIdentity(record);
  
  // Authenticate and publish to directory
  const client = useAppStore.getState().client;
  if (client && record.devicePair) {
    try {
      await authenticateGunUser(client, record.devicePair);
      await publishDirectoryEntry(client, record);
    } catch (err) {
      console.warn('[vh:identity] Directory publish failed:', err);
    }
  }
}
```

- [ ] Import `authenticateGunUser` and `publishDirectoryEntry`
- [ ] Call after identity creation
- [ ] Handle errors gracefully

---

##### 2.4.0.7 Channel Schema - Add devicePub Mapping

**File:** `packages/data-model/src/schemas/hermes/message.ts`

```typescript
export const HermesChannelSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal('hermes-channel-v0'),
  participants: z.array(z.string().min(1)).min(1),  // nullifiers
  participantEpubs: z.record(z.string(), z.string()).optional(),     // nullifier → epub
  participantDevicePubs: z.record(z.string(), z.string()).optional(), // nullifier → devicePub
  lastMessageAt: z.number().int().nonnegative(),
  type: z.enum(['dm', 'group'])
});
```

**File:** `packages/types/src/index.ts`

```typescript
export interface HermesChannel {
  id: string;
  schemaVersion: 'hermes-channel-v0';
  participants: string[];
  participantEpubs?: Record<string, string>;      // nullifier → epub
  participantDevicePubs?: Record<string, string>; // nullifier → devicePub
  lastMessageAt: number;
  type: 'dm' | 'group';
}
```

- [ ] Add `participantDevicePubs` to schema
- [ ] Update `HermesChannel` interface in types
- [ ] Update `createHermesChannel` helper to accept devicePubs
- [ ] Update schema tests

---

##### 2.4.0.8 Contact Exchange - Store Both epub and devicePub

**File:** `apps/web-pwa/src/components/hermes/ScanContact.tsx`

After parsing contact, look up directory and store both keys:

```typescript
const navigateToChannel = async (input: string) => {
  const { nullifier, epub } = parseContactData(input);
  const client = useAppStore.getState().client;
  
  // Look up recipient's devicePub from directory
  let devicePub: string | undefined;
  if (client) {
    const entry = await lookupByNullifier(client, nullifier);
    if (entry) {
      devicePub = entry.devicePub;
      // Use directory epub if contact didn't include it
      if (!epub && entry.epub) {
        // entry.epub can be used
      }
    }
  }
  
  if (!devicePub) {
    setError('Recipient not found in directory. They may not have registered yet.');
    return;
  }
  
  const channel = await getOrCreateChannel(nullifier, epub, devicePub);
  router.navigate({ to: '/hermes/messages/$channelId', params: { channelId: channel.id } });
};
```

- [ ] Import `lookupByNullifier` from `@vh/gun-client`
- [ ] Look up directory after parsing contact
- [ ] Pass `devicePub` to `getOrCreateChannel`
- [ ] Show clear error if recipient not in directory
- [ ] Handle legacy contacts (no devicePub) with helpful error

---

##### 2.4.0.9 Updated getOrCreateChannel Signature

**File:** `apps/web-pwa/src/store/hermesMessaging.ts`

```typescript
async getOrCreateChannel(
  peerNullifier: string, 
  peerEpub?: string,
  peerDevicePub?: string
): Promise<HermesChannel> {
  // ... existing logic ...
  
  const participantDevicePubs: Record<string, string> = {};
  if (peerDevicePub) {
    participantDevicePubs[peerNullifier] = peerDevicePub;
  }
  if (identity.devicePair?.pub) {
    participantDevicePubs[identity.session.nullifier] = identity.devicePair.pub;
  }
  
  const channel = createHermesChannel(
    channelId, 
    participants, 
    Date.now(), 
    participantEpubs,
    participantDevicePubs
  );
  // ...
}
```

- [ ] Update signature to accept `peerDevicePub`
- [ ] Store both epub and devicePub in channel
- [ ] Update all callers

---

##### 2.4.0.10 Updated sendMessage - Use Directory Lookup

**File:** `apps/web-pwa/src/store/hermesMessaging.ts`

```typescript
async sendMessage(recipientNullifier: string, plaintext: HermesPayload, type: HermesMessageType) {
  const identity = ensureIdentity();
  const client = ensureClient();
  const devicePair = identity.devicePair!;
  
  // 1. Get channel and recipient keys
  const channelId = await deriveChannelId([identity.session.nullifier, recipientNullifier]);
  const channel = get().channels.get(channelId);
  
  // 2. Get recipient's epub (for encryption)
  const recipientEpub = channel?.participantEpubs?.[recipientNullifier];
  if (!recipientEpub) {
    throw new Error('Recipient encryption key not available. Ask them to share their contact info again.');
  }
  
  // 3. Get recipient's devicePub (for delivery path)
  let recipientDevicePub = channel?.participantDevicePubs?.[recipientNullifier];
  if (!recipientDevicePub) {
    // Try directory lookup
    const entry = await lookupByNullifier(client, recipientNullifier);
    if (entry?.devicePub) {
      recipientDevicePub = entry.devicePub;
      // Update channel with devicePub for future sends
      // ... update channel state ...
    }
  }
  if (!recipientDevicePub) {
    throw new Error('Recipient not found in directory. They may need to come online first.');
  }
  
  // 4. Encrypt and sign
  const secret = await deriveSharedSecret(recipientEpub, devicePair);
  const ciphertext = await encryptMessagePayload(plaintext, secret);
  const messageId = crypto.randomUUID();
  const timestamp = Date.now();
  const signature = await SEA.sign(`${messageId}:${timestamp}:${ciphertext}`, devicePair);
  
  // 5. Build message
  const message: HermesMessage = { /* ... */ };
  
  // 6. Write to recipient's inbox (PUBLIC path)
  const inbox = getHermesInboxChain(client, recipientDevicePub).get(messageId);
  await putWithAck(inbox, { __encrypted: true, ...message });
  
  // 7. Write to my outbox (AUTHENTICATED path via gun.user())
  const outbox = getHermesOutboxChain(client).get(messageId);
  await putWithAck(outbox, { __encrypted: true, ...message });
  
  // 8. Write to my chat history (AUTHENTICATED path via gun.user())
  const chat = getHermesChatChain(client, channelId).get(messageId);
  await putWithAck(chat, { __encrypted: true, ...message });
}
```

- [ ] Look up `recipientDevicePub` from channel or directory
- [ ] Use `getHermesInboxChain(client, recipientDevicePub)` for delivery
- [ ] Use `getHermesOutboxChain(client)` (no devicePub - uses gun.user())
- [ ] Use `getHermesChatChain(client, channelId)` (uses gun.user())
- [ ] Update channel with devicePub if learned from directory

---

##### 2.4.0.11 Updated Hydration - Subscribe to devicePub Inbox

**File:** `apps/web-pwa/src/store/hermesMessaging.ts`

```typescript
function hydrateFromGun() {
  const identity = loadIdentity();
  const client = resolveClient();
  if (!identity?.devicePair?.pub || !client) return;
  
  const myDevicePub = identity.devicePair.pub;
  
  // Subscribe to my inbox (PUBLIC path - others deliver here)
  console.info('[vh:chat] hydrating inbox', myDevicePub.slice(0, 12) + '...');
  subscribeToChain(getHermesInboxChain(client, myDevicePub));
  
  // Subscribe to my outbox (AUTHENTICATED path)
  subscribeToChain(getHermesOutboxChain(client));
}
```

- [ ] Subscribe to `vh/hermes/inbox/${myDevicePub}`
- [ ] Subscribe to authenticated outbox via `gun.user()`
- [ ] Update logging to use devicePub (truncated)

---

##### 2.4.0.12 Learn devicePub from Inbound Messages

Update `upsertMessage` to learn sender's devicePub:

```typescript
function upsertMessage(state: ChatState, message: HermesMessage, defaultStatus: MessageStatus = 'sent'): ChatState {
  // ... existing logic ...
  
  // Learn sender's devicePub from message
  if (message.deviceId && message.sender) {
    const channel = state.channels.get(message.channelId);
    if (channel && !channel.participantDevicePubs?.[message.sender]) {
      const updatedDevicePubs = { 
        ...channel.participantDevicePubs, 
        [message.sender]: message.deviceId 
      };
      // Update channel...
      console.info('[vh:chat] Learned sender devicePub from message');
    }
  }
  
  // ... rest of function ...
}
```

- [ ] Learn `devicePub` from `message.deviceId` field
- [ ] Update channel's `participantDevicePubs`

---

##### 2.4.0.13 Validate Inbound Messages (Spam Protection)

Since inbox is public, validate messages on read:

```typescript
function validateInboundMessage(message: HermesMessage): boolean {
  // Check required fields
  if (!message.senderDevicePub || !message.signature || !message.deviceId) {
    console.warn('[vh:chat] Rejecting message: missing required fields');
    return false;
  }
  
  // Optionally verify signature
  // const valid = await SEA.verify(signature, senderDevicePub);
  
  return true;
}
```

- [ ] Add validation in subscription handler
- [ ] Log rejected messages
- [ ] Consider async signature verification (v1)

---

##### 2.4.0.14 Tests to Add

| Test | File | Description |
|------|------|-------------|
| Directory schema | `directory.test.ts` | Valid/invalid entries |
| Directory CRUD | `directoryAdapters.test.ts` | Publish, lookup, missing entry |
| Gun auth | `store.test.ts` | Auth succeeds, handles failure |
| Send with directory | `hermesMessaging.test.ts` | Send succeeds when entry present |
| Send without directory | `hermesMessaging.test.ts` | Send fails with clear error |
| Inbox subscription | `hermesMessaging.test.ts` | Subscribes to `vh/hermes/inbox/${devicePub}` |
| Learn devicePub | `hermesMessaging.test.ts` | `upsertMessage` updates channel |
| Authenticated paths | `hermesMessaging.test.ts` | Outbox/chat use `gun.user()` |

- [ ] Add directory schema tests
- [ ] Add directory adapter tests
- [ ] Add Gun auth tests
- [ ] Update messaging store tests for new paths
- [ ] Add devicePub learning tests

---

##### 2.4.0.15 Files Summary

| File | Changes |
|------|---------|
| `packages/data-model/src/schemas/hermes/directory.ts` | **NEW** - Directory entry schema |
| `packages/gun-client/src/directoryAdapters.ts` | **NEW** - Directory CRUD |
| `packages/gun-client/src/hermesAdapters.ts` | Update paths, use gun.user() |
| `packages/gun-client/src/topology.ts` | Add directory, update inbox path |
| `packages/data-model/src/schemas/hermes/message.ts` | Add `participantDevicePubs` |
| `packages/types/src/index.ts` | Update types |
| `apps/web-pwa/src/store/index.ts` | Gun auth + directory publish on init |
| `apps/web-pwa/src/hooks/useIdentity.ts` | Publish on identity creation |
| `apps/web-pwa/src/store/hermesMessaging.ts` | New paths, directory lookup |
| `apps/web-pwa/src/components/hermes/ScanContact.tsx` | Directory lookup on scan |

---

##### 2.4.0.16 Multi-Device Note (v0)

For v0, "last device wins" in directory: if a user registers from a second device, it overwrites the first device's entry. This is acceptable for initial testing.

Future (v1+) could support multiple devices per nullifier:
```
vh/directory/${nullifier}/devices/${devicePub}
```

---

#### 2.4.1 Hydration & Subscriptions (Previously Implemented)
- [x] **Hydrate on Init:** *(Needs update for new paths - see §2.4.0.11)*
- [x] **Call `subscribeToChannel`:** *(Implemented)*
- [x] **Channel List Hydration:** *(Implemented)*

#### 2.4.2 Encryption Key Correctness (Partially Implemented)
- [x] **Real SEA Keypairs:** *(Implemented)*
- [x] **Sender Device Key:** *(Implemented)*
- [ ] **Recipient Device Key:** ⚠️ See §2.4.0.10 for fix
- [x] **Sign Messages:** *(Implemented)*
- [x] **Fix Decryption in UI:** *(Implemented)*
- [ ] **ChannelList Decryption:** *(Deferred)*

#### 2.4.3 Error Handling & Validation
- [ ] **Timeout → Failed Status**
- [ ] **Contact Key Validation**
- [ ] **Offline Handling**
- [ ] **Inbox Spam Validation:** See §2.4.0.13

#### 2.4.4 Multi-Device Sync
- [x] **Outbox Subscription:** *(Needs update for authenticated path)*
- [x] **Merge Logic:** *(Implemented)*

---

## 3. Phase 2: HERMES Forum (The Agora)

**Objective:** A threaded conversation platform combining Reddit-style threads with VENN's bias/counterpoint tables.
**Canonical Reference:** `docs/specs/spec-hermes-forum-v0.md`

### 3.1 Data Model (`packages/data-model`)

- [x] **Schema Definition:** Implement `Thread` and `Comment` exactly as defined in `docs/specs/spec-hermes-forum-v0.md` §2 in `packages/data-model/src/schemas/hermes/forum.ts`:
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

> ⚠️ **Blocking manual testing.** Based on messaging learnings, the following gaps prevent forum manual testing.
>
> **Current State (Dec 5, 2025):**
> - Threads vanish on page refresh (no hydration)
> - Other users' content doesn't appear (no subscriptions)
> - Double-voting possible after refresh (vote state not persisted)
> - Index chains exist but unused

---

#### 3.4.0 CRITICAL: Vote State Persistence

**Problem:** `userVotes: Map<string, 'up' | 'down' | null>` is in-memory only. After refresh:
- User's vote state is lost
- But thread/comment upvotes/downvotes counts were already changed
- User can vote again → **double-voting bug**

**Fix:**
```typescript
const VOTES_KEY_PREFIX = 'vh_forum_votes:';

function loadVotesFromStorage(nullifier: string): Map<string, 'up' | 'down' | null> {
  const raw = localStorage.getItem(`${VOTES_KEY_PREFIX}${nullifier}`);
  return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
}

function persistVotes(nullifier: string, votes: Map<string, 'up' | 'down' | null>) {
  localStorage.setItem(`${VOTES_KEY_PREFIX}${nullifier}`, JSON.stringify(Object.fromEntries(votes)));
}
```

- [x] Add `loadVotesFromStorage` and `persistVotes` helpers
- [x] Load vote state on store init (block voting until loaded)
- [x] Persist immediately on every vote change
- [x] Add unit test for vote persistence

---

#### 3.4.1 Hydration & Subscriptions

**Problem:** `createForumStore` creates empty maps; `loadThreads()` reads only local state.

**Fix:** Add `hydrateFromGun()` mirroring messaging pattern:

```typescript
function hydrateFromGun(client: VennClient, store: StoreApi<ForumState>) {
  const threadsChain = client.gun.get('vh').get('forum').get('threads');
  
  threadsChain.map().on((data, key) => {
    // Skip Gun metadata nodes
    if (!data || typeof data !== 'object' || '_' in data) return;
    
    // Dedupe check (TTL-based)
    if (isDuplicate(key)) return;
    
    // Validate schema
    const result = HermesThreadSchema.safeParse(data);
    if (result.success) {
      store.setState(s => addThread(s, result.data));
    }
  });
}
```

**Deduplication (mirrors messaging):**
```typescript
const seenThreads = new Map<string, number>();
const SEEN_TTL_MS = 60_000;
const SEEN_CLEANUP_THRESHOLD = 100;

function isDuplicate(id: string): boolean {
  const now = Date.now();
  const lastSeen = seenThreads.get(id);
  if (lastSeen && (now - lastSeen) < SEEN_TTL_MS) return true;
  seenThreads.set(id, now);
  // Cleanup old entries...
  return false;
}
```

- [x] Add `hydrateFromGun()` subscribing to `vh/forum/threads` via `.map().on()`
- [x] Add schema validation with `safeParse()` before ingestion
- [x] Add Gun metadata filtering (`data._` check)
- [x] Add TTL-based deduplication (same pattern as messaging)
- [x] Call `hydrateFromGun()` in store initialization
- [x] Add comment subscriptions per active thread view
- [ ] Unsubscribe on component unmount (deferred — not critical)

---

#### 3.4.2 Index Chain Usage

**Problem:** `getForumDateIndexChain` and `getForumTagIndexChain` exist but are never called.

**Fix:** Write to indexes on thread creation:

```typescript
// In createThread(), after writing thread:
getForumDateIndexChain(client).get(thread.id).put({ timestamp: thread.timestamp });
thread.tags.forEach(tag => {
  getForumTagIndexChain(client, tag.toLowerCase()).get(thread.id).put(true);
});
```

- [x] Write to date index on thread creation
- [x] Write to tag indexes on thread creation
- [ ] Consider seeding hydration from date index for efficiency (deferred — not critical)

---

#### 3.4.3 VENN → Forum CTA Flow

**Problem:** `forumStore.threads` is empty on reload, so duplicate check fails.

**Fix:** After hydration works, the existing lookup logic in `AnalysisView.tsx` should work. Verify:

- [ ] Ensure "Discuss in Forum" checks `forumStore.threads` for existing `sourceAnalysisId`
- [ ] Navigate to existing thread if found
- [ ] Only show `NewThreadForm` if no match

---

#### 3.4.4 Error Handling & Validation

- [ ] Add error UI in `NewThreadForm` for Zod validation errors
- [ ] Add error UI in `CommentComposer` for validation failures
- [ ] Add loading states while hydrating thread/comment data

---

#### 3.4.5 Trust Gate Testing

- [ ] Allow low-trust identity creation (gate the throw, don't block persistence)
- [ ] Add dev toggle (e.g., `untrusted-*` username prefix) for low trust score

---

#### 3.4.6 Files Summary (Phase 4)

| File | Changes |
|------|---------|
| `apps/web-pwa/src/store/hermesForum.ts` | ✅ Hydration, subscriptions, dedup, vote persistence |
| `apps/web-pwa/src/store/hermesForum.test.ts` | ✅ Tests for persistence and hydration |
| `packages/gun-client/src/forumAdapters.ts` | ✅ Already has `.map()` support |
| `docs/specs/spec-hermes-forum-v0.md` | ✅ Updated to v0.2 with sync/persistence sections |

---

#### 3.4.7 Gun `undefined` Value Issue — ✅ RESOLVED

> **Status:** ✅ RESOLVED (Dec 5, 2025)
> **Identified:** Dec 5, 2025 (Claude, Codex, Gemini collaborative investigation)

**Problem:**

When creating a forum thread, Gun throws:
```
Invalid data: undefined at vh.forum.threads.<uuid>.author.content.downvotes.id.schemaVersion.score.sourceAnalysisId
```

**Root Cause Analysis:**

1. **Zod optional fields produce `{ key: undefined }`**: When `sourceAnalysisId` is not provided, `HermesThreadSchema.parse()` may output `{ sourceAnalysisId: undefined }` instead of omitting the key entirely.

2. **Gun cannot handle `undefined` values**: When Gun's `put()` encounters an object with `undefined` values, it attempts to traverse the object graph and throws "Invalid data: undefined".

3. **The error path shows Gun walking object properties as path segments**: The bizarre path (`author.content.downvotes.id...`) indicates Gun is iterating over object keys looking for valid data.

4. **Same issue in `createComment`**: The `targetId` parameter is passed directly to the object literal, so when `undefined`, it creates `{ targetId: undefined }`.

**Why Messaging Works:**

HERMES Messaging avoids this issue because:
- Message objects are constructed with guaranteed-defined values
- Optional fields like `deviceId` are always set to actual values (from `devicePair.pub`)
- No optional fields are passed through without explicit assignment

**Proposed Fix:**

Add a `stripUndefined` utility and apply to all Gun writes:

```typescript
// Add to hermesForum.ts (or a shared utility)
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

// In createThread:
const cleanThread = stripUndefined(withScore);
getForumThreadChain(client, cleanThread.id).put(cleanThread as HermesThread, ...);

// In createComment:
const cleanComment = stripUndefined(comment);
getForumCommentsChain(client, threadId).get(comment.id).put(cleanComment, ...);
```

**Implementation Checklist:**

- [x] Add `stripUndefined<T>()` helper function to `hermesForum.ts`
- [x] Wrap `withScore` with `stripUndefined()` before `getForumThreadChain().put()`
- [x] Wrap `comment` with `stripUndefined()` before `getForumCommentsChain().put()`
- [x] Add unit test verifying `stripUndefined` removes undefined keys
- [ ] ~~Verify thread creation works in manual testing~~ — Blocked by §3.4.8
- [ ] Verify comment creation works in manual testing
- [x] Applied to mock store as well

---

#### 3.4.8 Gun Array Issue — RESOLVED ✅

> **Status:** ✅ RESOLVED (Dec 6, 2025)
> **Originally Identified:** Dec 5, 2025 (Follow-up to §3.4.7 fix)

**Problem:**

After fixing the `undefined` issue (§3.4.7), thread creation now fails with:
```
Invalid data: Array at vh.forum.threads.<uuid>.author.content.downvotes.id.schemaVersion.score.tags
```

**Root Cause:**

GunDB does not natively support JavaScript arrays in `put()` operations. The `tags: string[]` field in `HermesThread` triggers this error.

**Why Messaging Doesn't Have This Issue:**

- `HermesChannel` contains `participants: string[]` BUT channels are **never written to Gun**
- Channel state is stored in **localStorage only** (via `persistSnapshot`)
- Only `HermesMessage` objects (no arrays) are written to Gun
- Forum threads must be shared state in Gun, so arrays are exposed to `put()`

**Affected Fields:**

- `HermesThread.tags` — Array of strings, **must be serialized**
- `HermesComment` — No arrays, not affected
- `DirectoryEntry` — No arrays, not affected

**Proposed Fix:**

Add helpers to serialize arrays before Gun write and parse on hydration:

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
```

**Usage:**

```typescript
// In createThread:
const threadForGun = serializeThreadForGun(withScore);
getForumThreadChain(client, threadForGun.id).put(threadForGun as any, ...);

// In hydrateFromGun:
const parsedData = parseThreadFromGun(data as Record<string, unknown>);
const result = HermesThreadSchema.safeParse(parsedData);
```

**Note:** Index writes (`getForumTagIndexChain`) remain unaffected because they iterate over the original `tags` array before serialization.

**Implementation Checklist:**

- [x] Add `serializeThreadForGun()` helper (combines `stripUndefined` + array serialization)
- [x] Add `parseThreadFromGun()` helper (handles stringified arrays with try/catch)
- [x] Update `createThread()` to use `serializeThreadForGun()` before Gun write
- [x] Update `hydrateFromGun()` to use `parseThreadFromGun()` before schema validation
- [x] **Update `createMockForumStore`** to mirror serialization/parsing for E2E test fidelity
- [x] Verify thread creation works in manual testing ✅
- [x] Verify thread hydration works after page refresh ✅

**Additional Fixes Applied (Dec 6, 2025):**

- [x] **Gun metadata filtering** — Changed filter from `'_' in data` (too aggressive) to checking required fields first (`id`, `schemaVersion`, `title`), then stripping `_` before parsing
- [x] **Lazy hydration** — Made `hydrateFromGun` retry on first user action (`createThread`, `loadThreads`) if Gun client wasn't ready at store init
- [x] **Per-store tracking** — Changed `hydrationStarted` from module-level boolean to `WeakSet<StoreApi>` for test isolation

---

#### 3.4.9 Comment Persistence — ✅ COMPLETE

> **Status:** ✅ COMPLETE (Dec 6, 2025)
> **Verified:** Comments persist across page refresh and sync across browsers

**Implementation (Applied same patterns as threads):**

- [x] `createComment()` uses `stripUndefined()` before Gun write
- [x] `loadComments()` subscribes to `vh/forum/threads/${threadId}/comments`
- [x] Gun metadata filtering — Strip `_` property, check required fields first
- [x] Deduplication — Split `isCommentSeen()` / `markCommentSeen()` pattern
- [x] Test comment persistence after page refresh ✅
- [x] Test comment sync across browser instances ✅

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

> ✅ **Phase 1 Complete (Dec 4, 2025).** XP ledger unified; UI now reflects XP awards.

#### 4.7.1 Unify XP Ledger Stores — ✅ **COMPLETE**
- [x] **Two Conflicting Stores Existed:**
    - `apps/web-pwa/src/store/xpLedger.ts` — Used by `hermesMessaging.ts` and `hermesForum.ts`. Has `applyMessagingXP()`, `applyForumXP()`, `applyProjectXP()`.
    - `apps/web-pwa/src/hooks/useXpLedger.ts` — Used by `WalletPanel.tsx`, `ProposalList.tsx`, `useGovernance.ts`. Has `addXp()`, `calculateRvu()`, `claimDailyBoost()`.
- [x] **Result:** When a user posts a forum thread or sends a message, XP is awarded via `store/xpLedger.ts`, but `WalletPanel` reads from `hooks/useXpLedger.ts` — a completely different Zustand store. **The UI never updates.** *(FIXED)*
- [x] **Fix:** Delete `hooks/useXpLedger.ts`. Refactor `store/xpLedger.ts` to also export a `useXpLedger` hook with the UI-facing methods (`addXp`, `calculateRvu`, `claimDailyBoost`), or merge the two interfaces. Update `WalletPanel` and other UI components to import from `../store/xpLedger`. *(Implemented: unified store exports all methods; old hook deleted; WalletPanel/useGovernance updated)*
- [x] **Align Caps:** Ensure the unified store's caps match this document (§4.1). *(Implemented: per-nullifier persistence with daily/weekly caps)*

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
- [ ] **Verify encryption:** Inspect the raw Gun payload under `vh/hermes/inbox/<recipientDevicePub>` and confirm it is encrypted (no message text visible in dev tools).
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

**Status:** ✅ Complete (Dec 6, 2025)
**Automated Tests:** ✅ Passing (242+ unit, 10 E2E, 100% coverage)
**Manual Testing:** ✅ All core flows verified

### 8.1 Test Results (Dec 5, 2025)
| Suite | Tests | Status |
|-------|-------|--------|
| Unit Tests (`@vh/web-pwa`) | 96 | ✅ Passing |
| Package Tests (data-model, gun-client, crypto, crdt) | 138 | ✅ Passing |
| E2E Single-User | 2 | ✅ Passing |
| E2E Multi-User | 8 | ✅ Passing |
| **Total** | **244** | ✅ **All Passing** |

### 8.2 Key Implementations (Complete)
1. **Schemas:** `Message`, `Channel`, `Thread`, `Comment`, `ModerationEvent`, `DirectoryEntry` with Zod validation
2. **Gun Adapters:** Hermes inbox/outbox/chats (with subscription support), Forum threads/comments/indexes, Directory service
3. **Encryption Helpers:** SEA-based E2E encryption via `hermesCrypto.ts`
4. **Stores:** `useChatStore`, `useForumStore`, `useXpLedger` (Zustand)
5. **UI:** Full HERMES Messaging and Forum interfaces with trust gating
6. **Testing:** Multi-user E2E infrastructure with shared mock mesh
7. **Gun Authentication:** `authenticateGunUser()` + directory publishing on init
8. **Chain Wrapper:** `createGuardedChain` now supports `on`, `off`, `map` for subscriptions

### 8.3 Blocking Gaps Summary

**Resolved (Phase 1 - Dec 4, 2025):**
| Area | Gap | Resolution |
|------|-----|------------|
| Messaging | No hydration on init | ✅ `hydrateFromGun()` implemented |
| Messaging | Sender encryption keys invalid | ✅ Real SEA `devicePair` in identity |
| Messaging | `subscribeToChannel` never called | ✅ Wired in `ChatLayout` useEffect |
| XP | Two conflicting stores | ✅ Unified into `store/xpLedger.ts` |
| Messaging | Outbox not subscribed | ✅ Subscribed in hydration |
| Messaging | Contact exchange missing epub | ✅ `{ nullifier, epub }` JSON format |

**Resolved (Phase 2 - Dec 5, 2025):**
| Area | Gap | Resolution |
|------|-----|------------|
| Messaging | Gun path uses nullifier | ✅ Now uses `vh/hermes/inbox/${devicePub}` + authenticated paths |
| Messaging | No directory service | ✅ `directoryAdapters.ts` with `lookupByNullifier`, `publishToDirectory` |
| Messaging | No Gun authentication | ✅ `authenticateGunUser()` on init, publishes to directory |
| Messaging | Chain wrapper missing `.on()` | ✅ Added `on`, `off`, `map` passthrough in `createGuardedChain` |
| Messaging | E2E test truncated contact | ✅ Added `contact-data` testid with full JSON |
| Messaging | Own messages won't decrypt | ✅ Fixed ECDH to use recipient's epub for own messages |

> **Manual Test Result (Dec 5, 2025):** Messages now send and appear in recipient's browser. Core E2E flow works.

**Resolved (Phase 3 - Dec 5, 2025):**
| Area | Gap | Resolution |
|------|-----|------------|
| Messaging | Gun callback deduplication | ✅ TTL-based `seenMessages` Map with 60s expiry |
| Messaging | Channel persistence | ✅ `vh_channels:${nullifier}` localStorage + Gun hydration |
| Messaging | Contact persistence | ✅ `vh_contacts:${nullifier}` localStorage, captured on channel creation |
| Messaging | Debug logging | ✅ `vh_debug_chat` localStorage toggle, default off |

> **Manual Test Result (Dec 5, 2025):** ✅ ALL PASSED
> - Messages appear in both browsers
> - No deduplication warning
> - Channels persist across refresh
> - Contacts persist (no re-add needed)
> - Messages deliver after refresh

**Remaining (Phase 4 - LOW Priority):**
| Area | Gap | Impact |
|------|-----|--------|
| Messaging | Timeout stays `pending` | Misleading status after write timeout |
| Messaging | ChannelList shows ciphertext | Poor UX preview |

**Resolved (Phase 4 - Forum Code):**
| Area | Gap | Status | Section |
|------|-----|--------|---------|
| Forum | Vote state persistence | ✅ localStorage `vh_forum_votes:<nullifier>` | §3.4.0 |
| Forum | Hydration on init | ✅ `hydrateFromGun()` via `.map().on()` | §3.4.1 |
| Forum | Subscriptions | ✅ Thread + comment subscriptions | §3.4.1 |
| Forum | Deduplication | ✅ TTL-based seen tracking | §3.4.1 |
| Forum | Index chain writes | ✅ Date + tag indexes on create | §3.4.2 |

**Resolved (Phase 4.1 - Gun Undefined):**
| Area | Gap | Status | Section |
|------|-----|--------|---------|
| Forum | Gun `undefined` values | ✅ `stripUndefined()` helper applied | §3.4.7 |

**Resolved (Phase 4.2 - Gun Array):**
| Area | Gap | Status | Section |
|------|-----|--------|---------|
| Forum | Gun `Array` values | ✅ `serializeThreadForGun()` / `parseThreadFromGun()` applied | §3.4.8 |
| Forum | Gun metadata filtering | ✅ Check required fields first, strip `_` before parse | §3.4.8 |
| Forum | Lazy hydration | ✅ Retry on first user action if client not ready | §3.4.8 |

**Resolved (Phase 4.3 - Comment Persistence):**
| Area | Gap | Status | Section |
|------|-----|--------|---------|
| Forum | Comment persistence | ✅ Comments survive refresh | §3.4.9 |
| Forum | Comment cross-user sync | ✅ Comments appear across browsers | §3.4.9 |

**Pending (Phase 4.4 - After Comments):**
| Area | Gap | Impact | Priority | Section |
|------|-----|--------|----------|---------|
| Forum | VENN CTA dedup | Duplicate threads possible | MEDIUM | §3.4.3 |
| Forum | Error UI | No validation feedback | LOW | §3.4.4 |
| Forum | Low-trust testing | Can't test TrustGate | LOW | §3.4.5 |

### 8.4 Files Summary

**Phase 2 (Dec 5, 2025):** 23 files changed (+600/-100 lines approx.)
- **Directory Service:** `packages/data-model/src/schemas/hermes/directory.ts`, `packages/gun-client/src/directoryAdapters.ts`
- **Gun Auth:** `apps/web-pwa/src/store/index.ts` — `authenticateGunUser()`, `publishDirectoryEntry()`
- **Chain Wrapper:** `packages/gun-client/src/chain.ts` — Added `on`, `off`, `map` passthrough for subscriptions
- **Decryption Fix:** `apps/web-pwa/src/components/hermes/MessageBubble.tsx` — Use recipient's epub for own messages
- **E2E Fix:** `apps/web-pwa/src/components/hermes/ContactQR.tsx` — `contact-data` testid
- **E2E Test:** `packages/e2e/src/multi-user/messaging.spec.ts` — Directory seeding, full contact JSON
- **Topology/Adapters:** Updated paths to `vh/hermes/inbox/${devicePub}` + authenticated user paths
- **Debug Logging:** `hermesMessaging.ts` — Comprehensive subscription/send logging

**Phase 1 (Dec 4, 2025):** 19 files changed (+355/-306 lines)
- Unified XP ledger: deleted `hooks/useXpLedger.ts`, consolidated into `store/xpLedger.ts`
- Identity: `devicePair` (SEA keypair) generated and persisted
- Messaging: hydration, subscriptions, signing, schema updates (`senderDevicePub`, `signature`)
- Tests: migrated XP tests, updated identity/messaging/schema tests

**Previous pass:** 14 files modified (+145/-32 lines)
- All HERMES components now have `data-testid` attributes
- Mock forum store wired to shared mesh for cross-context sync

### 8.5 Next Steps

**~~Phase 2 - Gun Auth & Directory:~~** ✅ COMPLETE (Dec 5, 2025)
**~~Phase 3 - UX Polish:~~** ✅ COMPLETE (Dec 5, 2025) — Manual tests passed!

**~~Phase 4 - Forum Code:~~** ✅ COMPLETE (Dec 5, 2025)
- ✅ Vote persistence, hydration, subscriptions, dedup, index writes — All implemented

**~~Phase 4.1 - Gun Undefined Fix:~~** ✅ COMPLETE (Dec 5, 2025)
- ✅ `stripUndefined()` helper added and applied to thread/comment writes
- ✅ 242 tests passing

**~~Phase 4.2 - Gun Array Fix:~~** ✅ COMPLETE (Dec 6, 2025)
- ✅ `serializeThreadForGun()` / `parseThreadFromGun()` helpers implemented
- ✅ Gun metadata filtering fixed (check required fields first, strip `_` before parse)
- ✅ Lazy hydration (retry on first user action if client not ready)
- ✅ Per-store hydration tracking (`WeakSet` for test isolation)
- ✅ Thread creation works in manual testing ✅
- ✅ Thread hydration works after page refresh ✅
- ✅ Cross-user sync verified — Threads appear across browser instances ✅

**~~Phase 4.3 - Comment Persistence:~~** ✅ COMPLETE (Dec 6, 2025)
- ✅ Comment write/hydration flow verified
- ✅ Comment persistence after refresh verified
- ✅ Cross-browser comment sync verified

**Phase 4.4 - Remaining Forum Polish (OPTIONAL):**
1. **CTA dedup** — Fix "Discuss in Forum" lookup (§3.4.3) — **MEDIUM**
2. Trust gate testing (§3.4.5) — **LOW**
3. Error handling UI (§3.4.4) — **LOW**

**Phase 5 - Polish (OPTIONAL - LOW PRIORITY):**
4. Improve message status handling (timeout → explicit status)
5. Decrypt channel preview in ChannelList
6. Wire contacts into UI (contact list panel)

**✅ SPRINT 3 CORE COMPLETE — Ready for Sprint 4 (Agentic Foundation):**
- All tests passing: 242+ unit + 10 E2E ✅
- Manual test checklist complete ✅
- Messaging: ✅ PASSED
- Forum Threads: ✅ PASSED
- Forum Comments: ✅ PASSED
- **Proceed to `docs/sprints/04-sprint-agentic-foundation.md`**
