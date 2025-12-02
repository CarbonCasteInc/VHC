# Sprint 4: The Agora - Action (Implementation Plan)

**Context:** `System_Architecture.md` v0.2.0 (Sprint 4: The "Agora" - Action)
**Goal:** Implement the "Action" layer of the Agora. This consists of **HERMES Docs** (secure collaborative editing) and the **Sovereign Legislative Bridge** (automated delivery of verified constituent sentiment).
**Status:** [ ] Planning

---

## 1. Guiding Constraints & Quality Gates

- [ ] **Non-Negotiables:**
    - [ ] **LOC Cap:** Hard limit of **350 lines** per file (tests/types exempt).
    - [ ] **Coverage:** **100%** Line/Branch coverage for new/modified modules.
    - [ ] **Browser-Safe:** No `node:*` imports in client code (except in Electron/Tauri main process or Playwright scripts).
    - [ ] **Security:** E2EE (End-to-End Encryption) for all private documents.
    - [ ] **Privacy:** No metadata leakage; "First-to-File" principles apply to public civic data.

---

## 2. Phase 1: HERMES Docs (Collaborative Editor)

**Objective:** Enable secure, real-time collaborative document editing (Google Docs style) over P2P infrastructure.

### 2.1 Data Model & CRDT (`packages/crdt`)
- [ ] **Schema Definition:** Create `packages/data-model/src/schemas/hermes/document.ts`.
    - `Document`: `{ id, title, owner, collaborators[], encryptedContent, lastModified }`
    - `Operation`: `{ docId, op: 'insert' | 'delete' | 'format', position, value, timestamp, author }`
- [ ] **CRDT Implementation:**
    - Leverage `yjs` or custom Gun-based CRDT for text synchronization.
    - Ensure operations are encrypted before propagation.

### 2.2 UI Implementation (`apps/web-pwa`)
- [ ] **Editor Component:**
    - Integrate a rich-text editor framework (e.g., TipTap, Slate, or Quill).
    - Bind editor state to CRDT/Gun store.
- [ ] **Features:**
    - **Live Cursors:** Show collaborator positions (ephemeral state).
    - **Rich Text:** Bold, Italic, Lists, Tables, Images (encrypted blobs).
    - **Access Control:** Share via public key (add to `collaborators` list).

---

## 3. Phase 2: Sovereign Legislative Bridge (The Voice)

**Objective:** Enable users to send verified sentiment reports and community-derived policy proposals directly to legislators (e.g., congress.gov contact forms, government emails, etc.) using local automation, bypassing API blocks.

### 3.1 Data Model & Schema (`packages/data-model`)
- [ ] **Schema Definition:** Create `packages/data-model/src/schemas/hermes/bridge.ts`.
    - `LegislativeAction`: `{ id, targetUrl, formFields: Record<string, string>, sentiment: 'support' | 'oppose', timestamp }`
    - `DeliveryReceipt`: `{ actionId, status: 'pending' | 'success' | 'failed', proofOfDelivery (screenshot/hash), timestamp }`
- [ ] **Constituency Proof:** Integrate `RegionProof` (from Sprint 2) to attach ZK-proof of residency to the action.

### 3.2 Automation Engine (Desktop/Electron)
- [ ] **Playwright Integration:**
    - Set up a "Headless Runner" service in the Desktop app.
    - **Script:** Create generic form-filler script (`fill-legislative-form.ts`).
        - Inputs: Target URL, Field Mapping, User Data.
        - Action: Navigate -> Fill -> Submit -> Capture Screenshot.
- [ ] **Security Sandbox:** Ensure automation scripts cannot exfiltrate data or access unauthorized domains.

### 3.3 UI Implementation (`apps/web-pwa`)
- [ ] **Action Center:**
    - "Write to Representative" flow.
    - Template selection (Topic -> Stance -> Message).
- [ ] **Status Tracking:**
    - View history of sent letters.
    - View delivery receipts (screenshots of success).

---

## 4. Phase 3: Verification & Hardening

### 4.1 Automated Tests
- [ ] **Unit Tests:** 100% coverage for Schema, Encryption, and CRDT logic.
- [ ] **E2E Tests:**
    - **Docs:** Simulator "Alice" and "Bob" edit same doc. Verify eventual consistency.
    - **Bridge:** Mock form server. Verify Playwright script correctly fills and submits form.

### 4.2 Manual Verification Plan
- [ ] **Docs:**
    1. Alice creates doc, shares with Bob.
    2. Both type simultaneously.
    3. Verify text merges correctly.
- [ ] **Bridge:**
    1. Select "Test Representative" (mock target).
    2. Fill form.
    3. Click "Send".
    4. Verify "Success" receipt and screenshot generation.

---

## 5. Risks & Mitigations
- **Risk:** CRDT complexity (overhead/conflicts).
    - *Mitigation:* Use established libraries (Yjs) over Gun if custom implementation proves too brittle.
- **Risk:** CAPTCHAs on legislative forms.
    - *Mitigation:* "Human-in-the-loop" mode where the user solves the CAPTCHA in the embedded browser view.
