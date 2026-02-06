# HERMES Messaging Spec (v0)

**Version:** 0.2
**Status:** Canonical for Sprint 3 — Implementation Complete (Dec 5, 2025)
**Context:** Secure, local-first, peer-to-peer messaging for TRINITY OS.

---

## 1. Core Principles

1.  **Physics is Trust:** Identity is rooted in hardware (LUMA).
2.  **E2EE Default:** All private messages are End-to-End Encrypted. No plaintext on the wire or mesh.
3.  **Local-First:** Messages live on the user's device. The mesh is for transport and backup (encrypted).
4.  **Out-of-Band Discovery:** No central user directory. Users connect via QR code or direct Public Key sharing.

---

## 2. Data Model

### 2.1 Message Schema
```typescript
interface Message {
  id: string;               // UUID — canonical across all copies (inbox/outbox/chats/devices)
  schemaVersion: 'hermes-message-v0';
  channelId: string;        // Derived from sorted participant identity keys
  
  // Identity Keys (routing & UI)
  // sender and recipient are session nullifiers — the canonical identity key across TRINITY.
  sender: string;           // Sender's session nullifier (identity key)
  recipient: string;        // Recipient's session nullifier (identity key)
  
  timestamp: number;        // Unix timestamp (client-generated)
  
  // Encrypted Payload (SEA.encrypt)
  content: string;          // "ct" string from SEA (never plaintext)
  
  // Metadata (Unencrypted but minimal)
  type: 'text' | 'image' | 'file';
  via?: 'human' | 'familiar'; // Optional provenance (no familiarId by default)
  
  // Integrity & Device Keys (REQUIRED)
  signature: string;        // SEA.sign(id:timestamp:content, senderDevicePair)
  senderDevicePub: string;  // Sender's epub (ECDH encryption public key) — for recipient decryption
  deviceId: string;         // Sender's pub (ECDSA signing key) — for message delivery routing
}
```

**Implementation Note:** 
- `sender` / `recipient` are **nullifiers** (identity-level) for routing and UI
- `senderDevicePub` is the sender's **epub** (ECDH key) — recipient uses this to derive shared secret for decryption
- `deviceId` is the sender's **pub** (ECDSA key) — used for Gun authentication and inbox delivery routing
- Signature hash format: `${id}:${timestamp}:${ciphertext}`

### 2.2 Channel Schema
```typescript
interface Channel {
  id: string;               // Deterministic: sha256(sort([identityKeyA, identityKeyB]).join('|'))
  schemaVersion: 'hermes-channel-v0';
  participants: string[];   // List of identity keys / nullifiers (not device keys)
  lastMessageAt: number;    // Timestamp of last activity
  type: 'dm';               // v0 is strictly 1:1; 'group' is v1+
  
  // Device key caches (for offline encryption/delivery)
  participantEpubs?: Record<string, string>;      // nullifier → epub (ECDH key)
  participantDevicePubs?: Record<string, string>; // nullifier → pub (ECDSA key)
}
```

**v0 Constraint:** `participants.length === 2` is enforced at the data-model layer. Group channels (`type: 'group'`) are reserved for v1+.

**Key Caches:** `participantEpubs` and `participantDevicePubs` cache the device keys learned from:
- Contact exchange (QR/paste)
- Directory service lookup
- Inbound message metadata

This enables offline encryption without repeated directory lookups.

**Channel ID Derivation:**
```typescript
function deriveChannelId(participants: string[]): string {
  const sorted = [...participants].sort();
  return sha256(sorted.join('|'));
}
```

All messaging code must use this canonical derivation to ensure deterministic channel identification.

**Browser-Safe Crypto:** `sha256` must use existing browser-safe crypto utilities (e.g., WebCrypto / `@noble/hashes`) via `packages/crypto`. Do not use `node:crypto` in packages consumed by the web app.

---

## 3. Transport & Storage (GunDB)

### 3.1 Namespace Topology

Gun paths use **device public keys** (not nullifiers) because Gun's `~pubkey/` namespace requires valid 32-byte ECDSA keys.

| Path | Type | Description |
|------|------|-------------|
| `vh/hermes/inbox/<devicePub>/<msgId>` | Public | Recipient's inbox — sender writes here for delivery |
| `~<devicePub>/hermes/outbox/<msgId>` | Authenticated | Sender's outbox — for multi-device sync |
| `~<devicePub>/hermes/chats/<channelId>/<msgId>` | Authenticated | Local chat history |
| `vh/directory/<nullifier>` | Public | Directory service — nullifier → device keys lookup |

**Key distinction:**
- **Public paths** (`vh/...`) — Anyone can write, used for message delivery
- **Authenticated paths** (`~<devicePub>/...`) — Requires `gun.user().auth(devicePair)`, only owner can write

**TopologyGuard Classification:**
- `vh/directory/` — Classified as `sensitive` (contains PII: nullifier ↔ device key mapping)
- `vh/hermes/inbox/` — Classified as `sensitive` (encrypted messages)
- `~*/hermes/outbox`, `~*/hermes/chats` — Classified as `sensitive` (authenticated user data)

**Gun Access Rule:** All Gun operations must be performed via `@vh/gun-client`, respecting the Hydration Barrier. No direct `Gun()` calls in app code.

**Gun Adapters:**
```typescript
// Public inbox — keyed by recipient's devicePub (ECDSA pub)
getHermesInboxChain(client: VennClient, devicePub: string): ChainWithGet<Message>

// Authenticated outbox — uses gun.user(), no parameter needed
getHermesOutboxChain(client: VennClient): ChainWithGet<Message>

// Authenticated chat history — uses gun.user()
getHermesChatChain(client: VennClient, channelId: string): ChainWithGet<Message>
```

### 3.2 Encryption (SEA)

**Key Types:**
- `pub` / `priv` — ECDSA keys for signing and Gun authentication
- `epub` / `epriv` — ECDH keys for encryption/decryption

**Shared Secret Derivation (ECDH):**
```typescript
// Sender encrypting for recipient:
secret = await deriveSharedSecret(recipientEpub, { epub: senderEpub, epriv: senderEpriv })

// Recipient decrypting from sender:
secret = await deriveSharedSecret(senderEpub, { epub: recipientEpub, epriv: recipientEpriv })
```

**Critical:** Use the **other party's `epub`** to derive the shared secret. For your own sent messages, use the recipient's epub.

*   **Encryption:** `SEA.encrypt(JSON.stringify(payload), secret)`
*   **Decryption:** `SEA.decrypt(ciphertext, secret)` → parse JSON

**Payload Structure:**
```typescript
interface HermesPayload {
  text?: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'file';
}
```

The plaintext `HermesPayload` is serialized to JSON and encrypted before storage. Only the ciphertext is written to Gun.

### 3.3 Multi-Device Deduplication

*   `id` is canonical for a message across inbox/outbox/chats and across devices.
*   Clients must de-duplicate by `id` when building channel history (messages may exist in multiple Gun locations).
*   `deviceId` is for UX/diagnostics only in v0; it does not affect `id` or dedupe logic.

### 3.4 Attachments
*   **Small (<100KB):** Base64 encoded inside the encrypted `content` payload.
*   **Large (>100KB):**
    1.  Upload encrypted blob to MinIO (Cloud Relay).
    2.  Send `content` as a link/hash: `minio://<bucket>/<key>`.
    3.  Recipient downloads and decrypts using the chat's shared secret.

**Season 0 Storage:** "Large" attachments are stored in the existing MinIO deployment via a thin `@vh/blob-service` wrapper (IPFS is a possible future backend). Do not spin up a separate, incompatible blob service.

### 3.5 Directory Service

The directory service maps **nullifiers** (identity keys) to **device keys** (pub/epub), enabling message delivery without prior contact exchange.

**Schema:**
```typescript
interface DirectoryEntry {
  schemaVersion: 'hermes-directory-v0';
  nullifier: string;        // Identity key
  devicePub: string;        // ECDSA pub — for inbox routing
  epub: string;             // ECDH epub — for encryption
  displayName?: string;     // Optional human-readable name (legacy)
  registeredAt: number;     // First registration timestamp
  lastSeenAt: number;       // Last activity timestamp
  // NOTE: No 'handle' field — handles are local-only (Sprint 3.5 privacy decision)
}
```

> **Privacy Note (Sprint 3.5):** The `DirectoryEntry` schema intentionally does NOT include a `handle` field. User-chosen handles are exchanged peer-to-peer via QR/copy and stored locally in `ContactRecord`. This prevents handles from being exposed on the public Gun mesh.

**Gun Path:** `vh/directory/<nullifier>`

**Operations:**
```typescript
// Lookup recipient's device keys
lookupByNullifier(client, nullifier): Promise<DirectoryEntry | null>

// Publish own entry (on identity creation and app init)
publishToDirectory(client, entry): Promise<void>
```

**Multi-device (v0):** "Last device wins" — latest `publishToDirectory` overwrites. Formal multi-device sync is v1+.

### 3.6 Gun Authentication

Gun's authenticated namespace (`~pubkey/...`) requires calling `gun.user().auth()` with a valid SEA keypair.

**On App Init:**
```typescript
async function authenticateGunUser(client: VennClient, devicePair: SEAPair): Promise<void> {
  if (client.gun.user().is) return; // Already authenticated
  return new Promise((resolve, reject) => {
    client.gun.user().auth(devicePair, (ack) => {
      if (ack.err) reject(new Error(ack.err));
      else resolve();
    });
  });
}
```

**After Identity Creation:**
1. Generate SEA keypair: `devicePair = await SEA.pair()`
2. Persist in identity record
3. Authenticate with Gun: `await authenticateGunUser(client, devicePair)`
4. Publish to directory: `await publishToDirectory(client, entry)`

### 3.7 Local Persistence

Channels and contacts are persisted to localStorage per-identity for offline access.

**Storage Keys:**
- `vh_channels:<nullifier>` — Map of channel ID → Channel
- `vh_contacts:<nullifier>` — Map of nullifier → ContactRecord

**ContactRecord:**
```typescript
interface ContactRecord {
  nullifier: string;
  epub?: string;
  devicePub?: string;
  displayName?: string;  // Legacy field (from DirectoryEntry)
  handle?: string;       // User-chosen display name (Sprint 3.5+, from QR exchange)
  addedAt: number;
}
```

**Display Name Priority (Sprint 3.5+):**
```typescript
// UI should display names in this order:
const displayName = contact.handle ?? contact.displayName ?? truncate(contact.nullifier);
```

This ensures:
1. User-chosen handles (from QR exchange) take precedence
2. Legacy `displayName` (if present) is fallback
3. Truncated nullifier is last resort for contacts without names

**Hydration Flow:**
1. Load channels/contacts from localStorage (instant)
2. Subscribe to Gun inbox/outbox for real-time updates
3. Merge incoming data, update localStorage on changes

### 3.8 Message Deduplication

Gun may fire `.on()` callbacks multiple times for the same message. Clients must deduplicate:

```typescript
const seenMessages = new Map<string, number>(); // id → timestamp
const SEEN_TTL_MS = 60_000; // 1 minute

function handleMessage(message: Message) {
  const now = Date.now();
  const lastSeen = seenMessages.get(message.id);
  if (lastSeen && (now - lastSeen) < SEEN_TTL_MS) {
    return; // Skip duplicate
  }
  seenMessages.set(message.id, now);
  // Process message...
}
```

---

## 4. Gating & Trust

### 4.1 Session Gating

*   **Requirement:** Messaging requires a valid LUMA session (identity + attestation).
*   **No Additional Threshold:** HERMES Messaging does not introduce any additional trustScore threshold beyond whatever the session gate uses (per `System_Architecture.md` §4.1.5).
*   **UI Enforcement:** If `useIdentity()` returns no active session, the Messaging UI shows a "Create identity to start messaging" gate.

---

## 5. Discovery & Connection (v0)

*   **Mechanism:** Out-of-Band contact exchange + Directory service fallback.

**Contact Data Format:**
```typescript
// QR code / copy-paste contains JSON:
{
  "nullifier": "dev-nullifier-abc123...",
  "epub": "aBcDeFgH...",  // ECDH public key for encryption
  "handle": "Alice"       // User's display name (Sprint 3.5+)
}
```

> **Handle Privacy (Sprint 3.5):** The `handle` field is exchanged peer-to-peer only. It is NOT written to the public `DirectoryEntry` in Gun. Handles are stored locally in `ContactRecord` and never leave the device except via explicit QR/copy sharing.

**Flow:**
1. **Alice** shows QR Code or copies contact JSON (contains `{ nullifier, epub }`)
2. **Bob** scans QR / pastes contact JSON
3. **Bob's app** parses contact data:
   - Extracts `nullifier` and `epub`
   - Looks up `devicePub` from directory service
   - If directory lookup fails, shows error "Recipient not found"
4. **Bob's app** creates channel with `deriveChannelId([aliceNullifier, bobNullifier])`
5. **Bob** sends first message → written to Alice's inbox at `vh/hermes/inbox/<aliceDevicePub>`

**Directory Service:** While contact exchange provides `epub` directly, the directory service provides `devicePub` for message routing. Users must have published to the directory (happens on identity creation/app init) to receive messages.

**Legacy Support:** If contact data is just a nullifier string (no JSON), the app falls back to directory-only lookup for both `epub` and `devicePub`.

---

## 6. Offline & Sync

*   **Relays:** Gun relays hold the encrypted graph data.
*   **Sync:** When Bob comes online, his client:
    1. Loads channels/contacts from `localStorage` (instant offline access)
    2. Authenticates with Gun: `gun.user().auth(devicePair)`
    3. Publishes to directory (updates `lastSeenAt`)
    4. Subscribes to inbox: `vh/hermes/inbox/<bobDevicePub>` (public path)
    5. Subscribes to outbox: `~<bobDevicePub>/hermes/outbox` (authenticated path)
*   **Persistence:** 
    - `localStorage: vh_channels:<nullifier>` — Channel metadata and device key caches
    - `localStorage: vh_contacts:<nullifier>` — Contact records
    - Messages are stored in Zustand state (in-memory) with Gun as source of truth

---

## 7. Error Handling

*   **Gun Put Error (`ack.err`):** Mark message as `status: 'failed'` in the local store. Do not retry automatically.
*   **Timeout:** Follow the "proceed without ack" model from `gun-client`. Keep `status: 'pending'` until the message is reflected in inbox/history.
*   **Decryption Failure:** Log warning, display placeholder message ("Unable to decrypt"). Do not crash.

---

## 8. Future Proofing (v1+)

*   **Group Chats:** Will require Multi-Cast Encryption (sender encrypts N times or uses a shared group key rotated on membership change). `Channel.type: 'group'` is reserved.
*   **Push Notifications:** Encrypted push payloads via a blind relay service.
*   **Device Sync Protocol:** Formal protocol for syncing chat history across devices beyond basic Gun replication.

---

## 9. Implementation Checklist

**Core (Complete):**
- [x] Implement `Message` and `Channel` schemas in `packages/data-model/src/schemas/hermes/message.ts`
- [x] Implement `deriveChannelId` helper in `packages/data-model` using `@vh/crypto` (browser-safe)
- [x] Implement encryption wrappers in `packages/gun-client/src/hermesCrypto.ts`
- [x] Implement Gun adapters: `getHermesInboxChain`, `getHermesOutboxChain`, `getHermesChatChain`
- [x] Implement `useChatStore` in `apps/web-pwa/src/store/hermesMessaging.ts`
- [x] Implement UI components: `ChatLayout`, `ChannelList`, `MessageBubble`, `Composer`, `ContactQR`, `ScanContact`
- [x] Write unit tests for schemas, `deriveChannelId`, and encryption round-trips
- [x] Write E2E tests for message flow with mock attestation

**Directory & Auth (Complete):**
- [x] Implement `DirectoryEntry` schema in `packages/data-model/src/schemas/hermes/directory.ts`
- [x] Implement directory adapters: `lookupByNullifier`, `publishToDirectory`
- [x] Implement Gun authentication: `authenticateGunUser()` on app init
- [x] Update Gun adapters to use `devicePub` paths and `gun.user()` for authenticated writes
- [x] Update `ContactQR` to export JSON `{ nullifier, epub }`
- [x] Update `ScanContact` to parse JSON contact format and lookup directory

**Persistence & Polish (Complete):**
- [x] Implement channel persistence: `vh_channels:<nullifier>` in localStorage
- [x] Implement contact persistence: `vh_contacts:<nullifier>` in localStorage
- [x] Implement message deduplication with TTL-based seen tracking
- [x] Gate debug logging behind `vh_debug_chat` localStorage flag
- [x] Fix decryption to use correct peer epub for own vs received messages
- [x] Add `on`, `off`, `map` to `createGuardedChain` for subscription support

**Remaining (Low Priority):**
- [ ] Improve message status handling (timeout → explicit status)
- [ ] Show decrypted preview in ChannelList
- [ ] Wire contacts into dedicated UI panel
