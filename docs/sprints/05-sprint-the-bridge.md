# Sprint 5: The Agora - Action (Implementation Plan)

**Context:** `System_Architecture.md` v0.2.0 (Sprint 5: The "Agora" - Action)
**Goal:** Implement the "Action" layer of the Agora. This consists of **HERMES Docs** (secure collaborative editing) and the **Civic Action Kit** (facilitation of verified constituent outreach).
**Status:** [ ] Planning
**Predecessor:** Sprint 4 (Agentic Foundation) — ⚪ Planning

> **Sprint 3 Learnings Applied:**
> - Gun write sanitization (`stripUndefined`, array serialization)
> - Lazy hydration with per-store tracking
> - TTL-based deduplication for Gun callbacks
> - localStorage persistence patterns for user state
> - E2E mock infrastructure with SharedMeshStore

---

## 1. Guiding Constraints & Quality Gates

### 1.1 Non-Negotiables (Engineering Discipline)
- [ ] **LOC Cap:** Hard limit of **350 lines** per file (tests/types exempt).
- [ ] **Coverage:** **100%** Line/Branch coverage for new/modified modules.
- [ ] **Browser-Safe:** No `node:*` imports in client code (except in Electron/Tauri main process).
- [ ] **Security:** E2EE (End-to-End Encryption) for all private documents.
- [ ] **Privacy:** No metadata leakage; "First-to-File" principles apply to public civic data.

### 1.2 True Offline Mode (E2E Compatibility)
- [ ] **True Offline Mode:** Docs and Bridge flows must run with `VITE_E2E_MODE=true` using full mocks (no WebSocket, no real Gun relay), per `ARCHITECTURE_LOCK.md`.

### 1.3 Gun Isolation & Topology
- [ ] **Gun Isolation:** All access to Gun goes through `@vh/gun-client`. No direct `gun` imports in `apps/*`.
- [ ] **TopologyGuard Update:** Extend allowed prefixes to include:
    - `vh/docs/<docId>` — Document metadata (public or encrypted)
    - `vh/docs/<docId>/ops` — CRDT operations (encrypted)
    - `vh/bridge/reports/<reportId>` — Public report metadata (no PII)
    - `vh/bridge/actions/<actionId>` — Action metadata (no PII)

### 1.4 Identity & Trust Gating
- [ ] **Trust Gating (Docs):** Creating and editing shared documents requires `TrustScore >= 0.5`.
- [ ] **Trust Gating (Bridge):** Sending legislative actions requires:
    - `TrustScore >= 0.7` (higher threshold for civic actions)
    - Valid `RegionProof` (constituency verification)
- [ ] **Session Requirement:** Both features require an active session and identity (nullifier).

### 1.5 XP & Privacy
- [ ] **XP & Privacy:** Any XP accrual from Docs/Bridge must write only to the on-device XP ledger (`civicXP` / `projectXP`), never emitting `{district_hash, nullifier, XP}` off-device.

### 1.6 HERMES vs AGORA Naming
- [ ] **Navigation Model:**
    - **HERMES** = Communications layer: Messaging (DMs) + Forum + Docs
    - **AGORA** = Governance & civic action: Civic Action Kit, voting, QF
- [ ] **Routing:**
    - HERMES tab → `/hermes` → surfaces Messaging, Forum, and Docs
    - AGORA tab → `/agora` → surfaces Civic Action Kit, Proposals, Voting

---

## 2. Phase 1: HERMES Docs (Collaborative Editor)

**Objective:** Enable secure, real-time collaborative document editing (Google Docs style) over P2P infrastructure.
**Canonical Reference:** `docs/specs/spec-hermes-docs-v0.md` (to be created)

### 2.1 Data Model & Schema (`packages/data-model`)

#### 2.1.1 Document Schema

**New File:** `packages/data-model/src/schemas/hermes/document.ts`

```typescript
import { z } from 'zod';

export const HermesDocumentSchema = z.object({
  schemaVersion: z.literal('hermes-document-v0'),
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  owner: z.string().min(1),               // nullifier of creator
  collaborators: z.array(z.string()),     // nullifiers with edit access
  viewers: z.array(z.string()).optional(), // nullifiers with read-only access
  encryptedContent: z.string(),           // Yjs state encoded + encrypted
  createdAt: z.number(),
  lastModifiedAt: z.number(),
  lastModifiedBy: z.string(),             // nullifier of last editor
  type: z.enum(['draft', 'proposal', 'report', 'letter'])
});

export type HermesDocument = z.infer<typeof HermesDocumentSchema>;

export const DocumentOperationSchema = z.object({
  schemaVersion: z.literal('hermes-doc-op-v0'),
  id: z.string().min(1),
  docId: z.string().min(1),
  encryptedDelta: z.string(),             // Yjs update encoded + encrypted
  author: z.string().min(1),              // nullifier
  timestamp: z.number(),
  vectorClock: z.record(z.string(), z.number()) // For ordering
});

export type DocumentOperation = z.infer<typeof DocumentOperationSchema>;
```

- [ ] Create `packages/data-model/src/schemas/hermes/document.ts`
- [ ] Export from `packages/data-model/src/index.ts`
- [ ] Add types to `packages/types/src/index.ts`
- [ ] Add unit tests for schema validation

#### 2.1.2 Access Control Model

```typescript
// Access levels
type DocAccessLevel = 'owner' | 'editor' | 'viewer';

// Permission check
function canEdit(doc: HermesDocument, nullifier: string): boolean {
  return doc.owner === nullifier || doc.collaborators.includes(nullifier);
}

function canView(doc: HermesDocument, nullifier: string): boolean {
  return canEdit(doc, nullifier) || (doc.viewers?.includes(nullifier) ?? false);
}
```

- [ ] Implement `canEdit`, `canView` helpers in `packages/data-model`
- [ ] Add tests for permission logic

### 2.2 CRDT Implementation (`packages/crdt`)

#### 2.2.1 Yjs Integration

**Decision:** Use Yjs for text CRDT (battle-tested, widely adopted) rather than custom Gun-based CRDT.

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    TipTap Editor                         │
│                    (Rich Text UI)                        │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                    Yjs Document                          │
│              (CRDT State Machine)                        │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│               Gun Sync Provider                          │
│         (Encrypted ops via @vh/gun-client)               │
└─────────────────────────────────────────────────────────┘
```

**New File:** `packages/crdt/src/yjs-gun-provider.ts`

```typescript
import * as Y from 'yjs';
import { encryptDocOp, decryptDocOp } from '@vh/gun-client';

export class GunYjsProvider {
  private ydoc: Y.Doc;
  private docId: string;
  private encryptionKey: string;
  
  constructor(ydoc: Y.Doc, docId: string, encryptionKey: string) {
    this.ydoc = ydoc;
    this.docId = docId;
    this.encryptionKey = encryptionKey;
    
    // Listen for local updates
    this.ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== 'gun') {
        this.broadcastUpdate(update);
      }
    });
  }
  
  private async broadcastUpdate(update: Uint8Array) {
    const encrypted = await encryptDocOp(update, this.encryptionKey);
    // Write to Gun: vh/docs/<docId>/ops/<timestamp>
  }
  
  public applyRemoteUpdate(encryptedUpdate: string) {
    const update = decryptDocOp(encryptedUpdate, this.encryptionKey);
    Y.applyUpdate(this.ydoc, update, 'gun');
  }
}
```

- [ ] Add `yjs` dependency to `packages/crdt`
- [ ] Implement `GunYjsProvider` for Gun ↔ Yjs sync
- [ ] Add encryption wrapper for Yjs updates
- [ ] Add tests for CRDT merge scenarios

#### 2.2.2 Encryption for Collaboration

**Document Key Derivation:**

```typescript
// Each document has a unique symmetric key
// Shared with collaborators via their epub (ECDH)
async function deriveDocumentKey(
  docId: string, 
  ownerDevicePair: SEA.Pair
): Promise<string> {
  // Deterministic key from docId + owner secret
  return await SEA.work(docId, ownerDevicePair);
}

// Share key with collaborator
async function shareDocumentKey(
  documentKey: string,
  collaboratorEpub: string,
  ownerDevicePair: SEA.Pair
): Promise<string> {
  const sharedSecret = await SEA.secret(collaboratorEpub, ownerDevicePair);
  return await SEA.encrypt(documentKey, sharedSecret);
}
```

- [ ] Implement `deriveDocumentKey` in `packages/gun-client/src/docsCrypto.ts`
- [ ] Implement `shareDocumentKey` and `receiveDocumentKey`
- [ ] Add tests for key sharing flow

### 2.3 Gun Adapters (`packages/gun-client`)

**New File:** `packages/gun-client/src/docsAdapters.ts`

```typescript
import type { VennClient } from './types';
import { createGuardedChain } from './chain';

// Document metadata
export function getDocsChain(client: VennClient, docId: string) {
  return createGuardedChain(
    client.gun.get('vh').get('docs').get(docId),
    `vh/docs/${docId}`
  );
}

// Document operations (CRDT updates)
export function getDocsOpsChain(client: VennClient, docId: string) {
  return createGuardedChain(
    client.gun.get('vh').get('docs').get(docId).get('ops'),
    `vh/docs/${docId}/ops`
  );
}

// User's document list (authenticated)
export function getUserDocsChain(client: VennClient) {
  return client.gun.user().get('hermes').get('docs');
}

// Shared keys for collaborators
export function getDocKeysChain(client: VennClient, docId: string) {
  return client.gun.user().get('hermes').get('docKeys').get(docId);
}
```

- [ ] Create `packages/gun-client/src/docsAdapters.ts`
- [ ] Export from `packages/gun-client/src/index.ts`
- [ ] Update TopologyGuard with docs paths
- [ ] Add adapter tests

### 2.4 Docs Store (`apps/web-pwa/src/store/hermesDocs.ts`)

```typescript
interface DocsState {
  documents: Map<string, HermesDocument>;
  activeDocId: string | null;
  
  // Actions
  createDocument(title: string, type: DocumentType): Promise<HermesDocument>;
  openDocument(docId: string): Promise<void>;
  shareDocument(docId: string, collaboratorNullifier: string): Promise<void>;
  updateDocument(docId: string, update: Uint8Array): Promise<void>;
  deleteDocument(docId: string): Promise<void>;
  loadUserDocuments(): Promise<HermesDocument[]>;
}
```

**Implementation Tasks:**
- [ ] Implement `useDocsStore` (Zustand)
- [ ] Add hydration from Gun on init
- [ ] Add TTL-based deduplication for ops (mirror Forum pattern)
- [ ] Add localStorage persistence for document list
- [ ] Implement E2E mock store (`createMockDocsStore`)
- [ ] Add unit tests for store actions

### 2.5 UI Implementation (`apps/web-pwa`)

#### 2.5.1 Components

- [ ] `DocsLayout`: Split view (Document List / Editor)
- [ ] `DocumentList`: List of user's documents with type icons
- [ ] `DocumentEditor`: TipTap-based rich text editor
- [ ] `CollaboratorPanel`: Show/manage document collaborators
- [ ] `ShareModal`: Add collaborators by nullifier or QR scan
- [ ] `DocumentHeader`: Title, last modified, collaborator avatars

#### 2.5.2 Editor Features

- [ ] **Rich Text:** Bold, Italic, Underline, Strikethrough
- [ ] **Structure:** Headings (H1-H3), Lists (bullet/numbered), Blockquotes
- [ ] **Tables:** Basic table support
- [ ] **Links:** Inline hyperlinks
- [ ] **Live Cursors:** Show collaborator positions (ephemeral, not persisted)
- [ ] **Presence:** Show who's currently viewing/editing

#### 2.5.3 Document Types

| Type | Purpose | XP Category |
|------|---------|-------------|
| `draft` | Personal notes, WIP | None |
| `proposal` | Elevatable to QF | `projectXP` |
| `report` | Civic analysis summary | `civicXP` |
| `letter` | Bridge letter draft | `civicXP` |

- [ ] Implement document type selection in create flow
- [ ] Add type-specific templates
- [ ] Wire XP based on document type and actions

### 2.6 Outstanding Tasks (Docs)

| Task | Priority | Estimate |
|------|----------|----------|
| Yjs integration + Gun provider | HIGH | 3d |
| Document encryption layer | HIGH | 2d |
| TipTap editor setup | HIGH | 2d |
| Collaborator key sharing | HIGH | 2d |
| E2E mock store | MEDIUM | 1d |
| Live cursors | MEDIUM | 1d |
| Document templates | LOW | 0.5d |

---

## 3. Phase 2: Civic Action Kit (Facilitation)

**Objective:** Enable users to generate verified civic reports and contact their representatives via user-initiated channels (email/phone/share/export). No automated form submission by default.
**Canonical Reference:** `docs/specs/spec-civic-action-kit-v0.md`

### 3.1 Data Model & Schema (`packages/data-model`)

#### 3.1.1 Civic Action Schema

**New File:** `packages/data-model/src/schemas/hermes/bridge.ts`

```typescript
import { z } from 'zod';

export const RepresentativeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string(),                      // "Senator", "Representative"
  state: z.string().length(2),            // "CA", "NY"
  district: z.string().optional(),        // For House reps
  party: z.string().optional(),
  contactUrl: z.string().url().optional(),// Official contact page (manual use)
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional()
});

export type Representative = z.infer<typeof RepresentativeSchema>;

export const LegislativeActionSchema = z.object({
  schemaVersion: z.literal('hermes-action-v0'),
  id: z.string().min(1),
  author: z.string().min(1),              // nullifier
  representativeId: z.string().min(1),
  reportId: z.string().min(1),            // Local report reference
  deliveryMethod: z.enum(['email', 'phone', 'share', 'export', 'manual']),
  constituencyProof: z.object({
    district_hash: z.string(),
    nullifier: z.string(),
    merkle_root: z.string()
  }),
  createdAt: z.number(),
  status: z.enum(['draft', 'ready', 'shared', 'sent', 'failed']),
  sourceDocId: z.string().optional(),     // If drafted in HERMES Docs
  sourceThreadId: z.string().optional()   // If linked from Forum thread
});

export type LegislativeAction = z.infer<typeof LegislativeActionSchema>;

export const DeliveryReceiptSchema = z.object({
  schemaVersion: z.literal('hermes-receipt-v0'),
  id: z.string().min(1),
  actionId: z.string().min(1),
  status: z.enum(['pending', 'success', 'failed']),
  timestamp: z.number(),
  deliveryMethod: z.enum(['email', 'phone', 'share', 'export', 'manual']),
  errorMessage: z.string().optional()
});

export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;
```

- [ ] Create `packages/data-model/src/schemas/hermes/bridge.ts`
- [ ] Export schemas and types
- [ ] Add unit tests for schema validation

#### 3.1.2 Representative Database

```typescript
// Static database of representatives (updated periodically)
// Stored in: apps/web-pwa/src/data/representatives.json
interface RepresentativeDB {
  version: string;
  lastUpdated: number;
  representatives: Representative[];
}

// Lookup by region proof
function findRepresentatives(
  regionProof: ConstituencyProof
): Representative[] {
  // Match district_hash to representatives
}
```

- [ ] Create `apps/web-pwa/src/data/representatives.json` with sample data
- [ ] Implement `findRepresentatives` lookup
- [ ] Add script to update representative data from public APIs

### 3.2 Report Generator + Native Intents

#### 3.2.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     PWA (Web)                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Action Center UI                    │    │
│  │   (Draft → Report → Share/Send)                  │    │
│  └───────────────────────┬─────────────────────────┘    │
└──────────────────────────┼──────────────────────────────┘
                           │ Native intents
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Email / Phone / Share Sheet / Download (User-Initiated)│
│  - mailto: / tel: / share / export PDF                  │
└─────────────────────────────────────────────────────────┘
```

#### 3.2.2 Report Generation (`apps/web-pwa`)

- [ ] Generate PDF report from Doc/Forum thread (local-only).
- [ ] Export/share via native intents (`mailto:`, `tel:`, share sheet, download).
- [ ] Always show contact info for manual use.

### 3.3 Gun Adapters (`packages/gun-client`)

**New File:** `packages/gun-client/src/bridgeAdapters.ts`

```typescript
// User's actions (authenticated)
export function getUserActionsChain(client: VennClient) {
  return client.gun.user().get('hermes').get('bridge').get('actions');
}

// User's receipts (authenticated)
export function getUserReceiptsChain(client: VennClient) {
  return client.gun.user().get('hermes').get('bridge').get('receipts');
}

// Aggregate action count per representative (public, anonymous)
export function getRepActionCountChain(client: VennClient, repId: string) {
  return client.gun.get('vh').get('bridge').get('stats').get(repId);
}
```

- [ ] Create `packages/gun-client/src/bridgeAdapters.ts`
- [ ] Export from index
- [ ] Add adapter tests

### 3.4 Bridge Store (`apps/web-pwa/src/store/hermesBridge.ts`)

```typescript
interface BridgeState {
  actions: Map<string, LegislativeAction>;
  receipts: Map<string, DeliveryReceipt>;
  // Actions
  createAction(data: Omit<LegislativeAction, 'id' | 'status'>): Promise<LegislativeAction>;
  markShared(actionId: string, method: LegislativeAction['deliveryMethod']): Promise<DeliveryReceipt>;
  loadUserActions(): Promise<LegislativeAction[]>;
  loadUserReceipts(): Promise<DeliveryReceipt[]>;
  
  // Lookup
  findRepresentatives(regionProof: ConstituencyProof): Representative[];
}
```

- [ ] Implement `useBridgeStore` (Zustand)
- [ ] Add localStorage persistence
- [ ] Implement E2E mock store
- [ ] Add unit tests

### 3.5 UI Implementation (`apps/web-pwa`)

#### 3.5.1 Components

- [ ] `BridgeLayout`: Main action center view
- [ ] `RepresentativeSelector`: Find reps by region
- [ ] `ActionComposer`: Draft letter with templates
- [ ] `ActionHistory`: Sent letters with receipts
- [ ] `ReceiptViewer`: View delivery metadata

#### 3.5.2 User Flows

**Flow 1: Write to Representative**
1. User opens Bridge → sees their representatives (from RegionProof)
2. Selects representative
3. Chooses topic + stance (or starts from Forum thread)
4. Drafts letter (or uses template)
5. Reviews and generates report
6. Chooses delivery method (email/phone/share/export/manual)
7. Sees confirmation with delivery metadata

**Flow 2: Elevate Forum Thread**
1. Popular Forum thread (net score ≥ 10) shows "Send to Rep" button
2. One-click generates draft letter from thread content
3. User reviews and sends

- [ ] Implement representative lookup by region
- [ ] Build letter composer with templates
- [ ] Add thread-to-letter elevation flow
- [ ] Build receipt viewer

### 3.6 Outstanding Tasks (Bridge)

| Task | Priority | Estimate |
|------|----------|----------|
| Schema definitions | HIGH | 0.5d |
| Representative database | HIGH | 1d |
| Bridge store | HIGH | 1d |
| PDF report generation | HIGH | 2d |
| Native intents wiring | HIGH | 1d |
| E2E mock store | MEDIUM | 0.5d |
| Thread-to-letter flow | MEDIUM | 1d |
| Representative data updates | LOW | 1d |

---

## 4. XP Hooks (Docs & Bridge)

### 4.1 Docs XP (`projectXP` / `civicXP`)

**A. Document Creation**
- **Event:** User creates a document with type `proposal` or `report`
- **Reward:** +1 `projectXP` (proposal) or +1 `civicXP` (report)
- **Constraints:** Max 3 document creation XP per day

**B. Collaborative Contribution**
- **Event:** User contributes substantive edits (≥100 chars added) to another user's document
- **Reward:** +1 `civicXP`
- **Constraints:** Max 1 per document per day

**C. Document Elevation**
- **Event:** Document is elevated to a Forum thread or QF proposal
- **Reward:** +2 `projectXP` to owner

### 4.2 Bridge XP (`civicXP`)

**A. Letter Sent**
- **Event:** User successfully sends a letter to a representative
- **Reward:** +3 `civicXP`
- **Constraints:**
    - Requires valid RegionProof (must be constituent)
    - Max 1 per representative per 7-day window
    - Max +9 `civicXP` per week from Bridge

**B. Thread Elevation**
- **Event:** User elevates a Forum thread to a legislative action
- **Reward:** +1 `civicXP` (on top of send bonus)

### 4.3 Implementation

- [ ] Add `applyDocsXP(event: DocsXPEvent)` to `store/xpLedger.ts`
- [ ] Add `applyBridgeXP(event: BridgeXPEvent)` to `store/xpLedger.ts`
- [ ] Wire XP calls in `hermesDocs.ts` and `hermesBridge.ts`
- [ ] Add unit tests for XP emission rules

---

## 5. Phase 3: Verification & Hardening

### 5.1 Automated Tests

#### 5.1.1 Unit Tests (100% Coverage)
- [ ] `Document` and `DocumentOperation` Zod schemas
- [ ] `LegislativeAction` and `DeliveryReceipt` schemas
- [ ] CRDT merge logic (Yjs + Gun provider)
- [ ] Document encryption/decryption round-trips
- [ ] Bridge delivery method validation

#### 5.1.2 Integration Tests (Vitest)
- [ ] `useDocsStore` creates and shares documents
- [ ] Collaborator can decrypt shared document
- [ ] `useBridgeStore` stores and tracks actions
- [ ] Trust gating for both Docs and Bridge

#### 5.1.3 E2E Tests (`VITE_E2E_MODE=true`)

**Docs E2E:**
- [ ] Alice creates document, shares with Bob
- [ ] Both edit simultaneously (mock CRDT sync)
- [ ] Verify merged content

**Bridge E2E:**
- [ ] User drafts letter to mock representative
- [ ] Generates report and selects delivery method
- [ ] Mock share intent returns success receipt
- [ ] Receipt displays delivery metadata

### 5.2 Manual Verification Plan

#### 5.2.1 Docs Manual Tests
- [ ] Create document of each type
- [ ] Share with another user (two browsers)
- [ ] Edit simultaneously, verify merge
- [ ] Offline edit, reconnect, verify sync
- [ ] Verify encryption (inspect Gun payload)

#### 5.2.2 Bridge Manual Tests
- [ ] Find representatives by region
- [ ] Draft letter using template
- [ ] Generate report (PDF)
- [ ] Verify delivery via email/phone/share/export

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| CRDT complexity | Use Yjs (battle-tested) over custom implementation |
| Document encryption key sharing | Leverage existing SEA patterns from messaging |
| Contact data drift | Versioned representative DB + update script |
| User privacy on export | Local-only reports; user-initiated sharing |
| Abuse of Bridge for spam | Rate limits, high trust threshold (0.7), RegionProof required |

---

## 7. Dependencies & Deliverables

### 7.1 New Package Dependencies
- `yjs` — CRDT implementation for collaborative editing
- `@tiptap/react` — Rich text editor framework
- `@tiptap/extension-*` — TipTap extensions (collaboration, placeholder, etc.)
- `pdf-lib` (or equivalent) — Local report generation (TBD)

### 7.2 Deliverables
- [ ] Secure collaborative document editing with E2EE
- [ ] Real-time collaboration with live cursors
- [ ] Civic Action Kit (reports + contact directory + native intents)
- [ ] Delivery receipts with method metadata
- [ ] Full test coverage (unit, integration, E2E)
- [ ] Updated specs (`spec-hermes-docs-v0.md`, `spec-civic-action-kit-v0.md`)

---

## 8. Sprint 5 Status Summary

**Status:** [ ] Planning
**Predecessor:** Sprint 3 — ✅ COMPLETE (Dec 6, 2025)  
**Dependency:** Sprint 4 (Agentic Foundation) Phase 0–1 — ⛔ Required before Sprint 5 execution

### 8.1 Phase Breakdown

| Phase | Scope | Estimate | Status |
|-------|-------|----------|--------|
| 1 | HERMES Docs | ~2 weeks | [ ] Not Started |
| 2 | Civic Action Kit | ~2 weeks | [ ] Not Started |
| 3 | Verification | ~1 week | [ ] Not Started |

### 8.2 Key Files to Create

| File | Description |
|------|-------------|
| `packages/data-model/src/schemas/hermes/document.ts` | Document & Operation schemas |
| `packages/data-model/src/schemas/hermes/bridge.ts` | Action & Receipt schemas |
| `packages/crdt/src/yjs-gun-provider.ts` | Gun sync provider for Yjs |
| `packages/gun-client/src/docsAdapters.ts` | Gun adapters for docs |
| `packages/gun-client/src/docsCrypto.ts` | Document encryption helpers |
| `packages/gun-client/src/bridgeAdapters.ts` | Gun adapters for bridge |
| `apps/web-pwa/src/store/hermesDocs.ts` | Docs store |
| `apps/web-pwa/src/store/hermesBridge.ts` | Bridge store |
| `apps/web-pwa/src/bridge/reportGenerator.ts` | Local report generator |
| `docs/specs/spec-hermes-docs-v0.md` | Docs specification |
| `docs/specs/spec-civic-action-kit-v0.md` | Civic Action Kit specification |

### 8.3 Prerequisites from Sprint 3

All met:
- [x] Gun authentication (`authenticateGunUser`)
- [x] Directory service (nullifier → devicePub)
- [x] E2EE messaging patterns (SEA encryption)
- [x] Forum for thread elevation
- [x] XP ledger infrastructure
- [x] E2E mock infrastructure (SharedMeshStore)
- [x] Gun write sanitization patterns

### 8.4 Next Steps

1. **Create spec documents** (`spec-hermes-docs-v0.md`, `spec-civic-action-kit-v0.md`)
2. **Implement schemas** (document, bridge)
3. **Build Yjs + Gun provider** (CRDT layer)
4. **Build TipTap editor** (UI)
5. **Build report generator + native intents**
6. **Wire E2E mocks and tests**
7. **Manual verification**

---

## 9. Appendix: Representative Contact Example

```json
{
  "id": "ca-sen-feinstein",
  "name": "Dianne Feinstein",
  "title": "Senator",
  "state": "CA",
  "party": "D",
  "contactUrl": "https://www.feinstein.senate.gov/public/index.cfm/e-mail-me",
  "email": "senator@example.gov",
  "phone": "+1-202-555-0100",
  "website": "https://www.feinstein.senate.gov"
}
```

This contact record powers the Civic Action Kit without automated form submission.
