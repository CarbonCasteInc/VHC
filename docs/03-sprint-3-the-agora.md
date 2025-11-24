# Sprint 3: The Agora - Implementation Checklist

**Context:** `System_Architecture.md` v0.0.1 (Sprint 3: The "Agora")
**Goal:** Implement secure, local-first messaging (HERMES) and establish the bridge to the wider network.
**Status:** [ ] In Progress

### Guiding Constraints & Quality Gates
- [ ] **Non-Negotiables:**
    - [ ] **LOC Cap:** Hard limit of **350 lines** per file (tests/types exempt).
    - [ ] **Coverage:** **100%** Line/Branch coverage for new/modified modules.
    - [ ] **Browser-Safe:** No `node:*` imports in client code.
    - [ ] **Bundle Budget:** Initial < **1 MiB** (gzip). Lazy assets < **10 MiB** (gzip).
    - [ ] **Offline E2E:** Messaging flows must pass with `VITE_E2E_MODE=true`.
    - [ ] **Security:** E2EE (End-to-End Encryption) for all private messages.
    - [ ] **Privacy:** No metadata leakage (sender/receiver anonymity where possible).

---

## Phase 1: HERMES Messaging (P2P)

### 1.1 Secure Transport Layer
- [ ] **Encryption:** Implement SEA (Security, Encryption, Authorization) wrappers for message payloads.
    - **Tests:** Verify encryption/decryption roundtrip and key management.
- [ ] **Schema:** Define `Message` and `Channel` schemas in `data-model`.
    - **Validation:** Zod schemas for payload integrity.
- [ ] **Store:** Implement `useChatStore` for local message persistence (IndexedDB/Gun).

### 1.2 Chat UI & UX
- [ ] **Interface:** Build `ChatLayout`, `ChannelList`, and `MessageThread` components.
    - **UX:** Optimistic UI updates (send immediately, sync in background).
- [ ] **Direct Messages:** 1:1 encrypted chat flow.
    - **E2E:** Verify "Alice -> Bob" message delivery in offline/mock mode.
- [ ] **Group Channels:** Public or Private group chat logic.
    - **Access Control:** Invite-only or Token-gated (future proofing).

---

## Phase 2: The Bridge (Network)

### 2.1 Peer Discovery & Sync
- [ ] **Discovery:** Enhance `gun-client` peer discovery logic.
    - **Tests:** Verify peer connection and reconnection strategies.
- [ ] **Sync:** Robust graph synchronization for offline-first resilience.
    - **Tests:** Verify data consistency after partition healing.

### 2.2 Network Resilience
- [ ] **Relay:** Implement/Configure a relay node strategy (if applicable for hybrid topology).
- [ ] **Diagnostics:** Add "Network Health" visualization to the PWA (Peer count, Latency).

---

## Exit Criteria for Sprint 3
- [ ] **CI Green:** All gates (Unit, Build, E2E, Bundle) passing.
- [ ] **Messaging Live:** Users can send/receive encrypted messages.
- [ ] **Network Stable:** Reliable peer connections and data sync.
- [ ] **Docs:** `manual_test_plan.md` updated for Messaging flows.
