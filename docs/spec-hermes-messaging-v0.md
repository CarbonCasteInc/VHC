# HERMES Messaging Spec (v0)

**Version:** 0.1
**Status:** Canonical for Sprint 3
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
  id: string;             // UUID
  channelId: string;      // Derived from sorted participant keys
  sender: string;         // Sender's Public Key (Nullifier)
  recipient: string;      // Recipient's Public Key
  timestamp: number;      // Unix timestamp (client-generated)
  
  // Encrypted Payload (SEA.encrypt)
  content: string;        // "ct" string from SEA
  
  // Metadata (Unencrypted but minimal)
  type: 'text' | 'image' | 'file';
  
  // Integrity
  signature: string;      // SEA.sign(id + timestamp + content, senderKey)
}
```

### 2.2 Channel Schema
```typescript
interface Channel {
  id: string;             // Deterministic: hash(sort([keyA, keyB]))
  participants: string[]; // List of Public Keys
  lastMessageAt: number;  // Timestamp of last activity
  type: 'dm';             // v0 is strictly 1:1
}
```

---

## 3. Transport & Storage (GunDB)

### 3.1 Namespace Topology
*   **User Inbox:** `~<recipient_pub>/hermes/inbox`
    *   Sender writes encrypted message reference here.
*   **User Outbox:** `~<sender_pub>/hermes/outbox`
    *   Sender writes copy here for their own multi-device sync.
*   **Chat History:** `~<user_pub>/hermes/chats/<channelId>`
    *   Local view of the conversation.

### 3.2 Encryption (SEA)
*   **Shared Secret:** ECDH (Elliptic Curve Diffie-Hellman).
    *   `secret = SEA.secret(recipientPub, senderPair)`
*   **Encryption:** `SEA.encrypt(text, secret)`
*   **Decryption:** `SEA.decrypt(ciphertext, secret)`

### 3.3 Attachments
*   **Small (<100KB):** Base64 encoded inside the encrypted `content` payload.
*   **Large (>100KB):**
    1.  Upload encrypted blob to IPFS or MinIO (Cloud Relay).
    2.  Send `content` as a link/hash: `ipfs://<hash>` or `minio://<bucket>/<key>`.
    3.  Recipient downloads and decrypts using the chat's shared secret.

---

## 4. Discovery & Connection (v0)

*   **Mechanism:** Strictly Out-of-Band.
*   **Flow:**
    1.  Alice shows QR Code (Public Key) to Bob.
    2.  Bob scans QR Code.
    3.  App derives `channelId` -> Starts Chat.
    4.  Bob sends first message -> Alice receives in `inbox`.

---

## 5. Offline & Sync

*   **Relays:** Gun relays hold the encrypted graph data.
*   **Sync:** When Bob comes online, his client subscribes to `~<bob_pub>/hermes/inbox`.
*   **Persistence:** `localStorage` + IndexedDB (via `gun-client` adapter) stores the decrypted history locally.

---

## 6. Future Proofing (v1+)

*   **Group Chats:** Will require Multi-Cast Encryption (sender encrypts N times or uses a shared group key rotated on membership change).
*   **Push Notifications:** Encrypted push payloads via a blind relay service.
