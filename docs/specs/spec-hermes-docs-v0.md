# HERMES Docs Spec (v0)

**Version:** 0.3
**Status:** Canonical for Season 0 (promoted from Draft on 2026-02-13 after Wave 2 Beta Stage 2 implementation)
**Context:** Secure collaborative editing plus Reply-to-Article publish flow for TRINITY Season 0.

---

## 1. Core Principles

1.  **E2EE Default:** All document content is End-to-End Encrypted. No plaintext on the wire or mesh.
2.  **Real-Time Collaboration:** Multiple users can edit simultaneously with CRDT-based conflict resolution.
3.  **Local-First:** Documents live on the user's device. The mesh provides sync and encrypted backup.
4.  **Access Control:** Owners control who can view/edit via explicit sharing (no public discovery).
5.  **Document Types:** Different types serve different civic purposes (drafts, proposals, reports, letters, articles).

---

## 2. Data Model

### 2.1 Document Schema

```typescript
interface HermesDocument {
  id: string;                     // UUID — canonical document identifier
  schemaVersion: 'hermes-document-v0';
  
  // Metadata
  title: string;                  // ≤ 200 chars
  type: 'draft' | 'proposal' | 'report' | 'letter' | 'article';
  
  // Ownership & Access
  owner: string;                  // Creator's nullifier (identity key)
  collaborators: string[];        // Nullifiers with edit access
  viewers?: string[];             // Nullifiers with read-only access
  
  // Content (encrypted)
  encryptedContent: string;       // SEA.encrypt(Yjs state, documentKey)
  
  // Timestamps
  createdAt: number;              // Unix timestamp (ms)
  lastModifiedAt: number;         // Updated on each edit
  lastModifiedBy: string;         // Nullifier of last editor
  
  // Publish linkage (V2-first)
  sourceTopicId?: string;         // TopicId for source topic
  sourceSynthesisId?: string;     // accepted synthesis_id at draft/publish time
  sourceEpoch?: number;
  sourceThreadId?: string;        // If created from forum context
  publishedArticleId?: string;    // If published as topic/article object
  publishedAt?: number;

  // Legacy aliases (read compatibility)
  elevatedToThreadId?: string;
  elevatedToProposalThreadId?: string;
  elevatedToActionId?: string;
}
```

### 2.2 Document Operation Schema

```typescript
interface DocumentOperation {
  id: string;                     // UUID — unique operation identifier
  schemaVersion: 'hermes-doc-op-v0';
  docId: string;                  // Parent document ID
  
  // Content (encrypted)
  encryptedDelta: string;         // SEA.encrypt(Yjs update bytes, documentKey)
  
  // Authorship
  author: string;                 // Nullifier of editor
  via?: 'human' | 'familiar';     // Optional provenance (no familiarId by default)
  timestamp: number;              // Unix timestamp (ms)
  
  // Ordering
  vectorClock: Record<string, number>;  // { [nullifier]: lamport_clock }
}
```

### 2.3 Document Key Schema

```typescript
interface DocumentKeyShare {
  schemaVersion: 'hermes-doc-key-v0';
  docId: string;
  
  // Encrypted document key (per collaborator)
  // Encrypted using ECDH shared secret between owner and collaborator
  encryptedKey: string;           // SEA.encrypt(documentKey, sharedSecret)
  
  // For verification
  ownerNullifier: string;
  collaboratorNullifier: string;
  sharedAt: number;
}
```

### 2.4 Content Size Limits

- `title`: ≤ 200 characters
- Document content: ≤ 500,000 characters (practical limit)
- Single operation delta: ≤ 10,000 bytes (after encryption)
- Max collaborators per document: 10 (v0 limit)
- Max viewers per document: 50 (v0 limit)

### 2.5 Document Types

| Type | Purpose | Trust Threshold | XP Category |
|------|---------|-----------------|-------------|
| `draft` | Personal notes, work-in-progress | 0.5 | None |
| `proposal` | Elevatable to QF / governance | 0.5 | `projectXP` |
| `report` | Civic analysis summary | 0.5 | `civicXP` |
| `letter` | Civic Action Kit draft | 0.7 | `civicXP` |
| `article` | Publishable longform topic contribution | 0.5 | `projectXP` |

`letter` keeps a higher threshold because its primary purpose is representative-forwarding preparation.

### 2.6 Reply-to-Article publish linkage

```typescript
interface DocPublishLink {
  docId: string;
  topicId: string;
  synthesisId?: string;
  epoch?: number;
  threadId?: string;
  articleId: string;
  publishedAt: number;
}
```

Rules:

- Reply overflow conversion creates a draft with `type: 'article'`.
- Publishing writes public article payload to `vh/topics/<topicId>/articles/<articleId>`.
- New publish flows should reference V2 synthesis via `sourceSynthesisId` + `sourceEpoch` when available.

---

## 3. CRDT Architecture

### 3.1 Technology Choice

**Decision:** Use **Yjs** for text CRDT implementation.

**Rationale:**
- Battle-tested in production (Notion, Figma, etc.)
- Built-in support for rich text (via TipTap/ProseMirror bindings)
- Efficient binary encoding (Y.encodeStateAsUpdate)
- Awareness protocol for live cursors

### 3.2 Sync Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    TipTap Editor                         │
│              (ProseMirror + React)                       │
└─────────────────────┬───────────────────────────────────┘
                      │ Yjs Doc
┌─────────────────────▼───────────────────────────────────┐
│                    Y.Doc                                 │
│              (In-Memory CRDT)                            │
└─────────────────────┬───────────────────────────────────┘
                      │ Y.on('update')
┌─────────────────────▼───────────────────────────────────┐
│               GunYjsProvider                             │
│   - Encrypt update → Gun                                 │
│   - Gun callback → Decrypt → Y.applyUpdate               │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                    GunDB                                 │
│      ~<devicePub>/docs/<docId>/ops/<opId> (encrypted)    │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Provider Implementation

```typescript
class GunYjsProvider {
  private ydoc: Y.Doc;
  private docId: string;
  private documentKey: string;
  private client: VennClient;
  private awareness: awarenessProtocol.Awareness;
  
  constructor(params: {
    ydoc: Y.Doc;
    docId: string;
    documentKey: string;
    client: VennClient;
  }) {
    // Initialize
    this.ydoc = params.ydoc;
    this.docId = params.docId;
    this.documentKey = params.documentKey;
    this.client = params.client;
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    
    // Listen for local updates
    this.ydoc.on('update', this.handleLocalUpdate.bind(this));
    
    // Subscribe to remote updates
    this.subscribeToRemoteUpdates();
  }
  
  private async handleLocalUpdate(update: Uint8Array, origin: any) {
    if (origin === 'remote') return; // Don't re-broadcast remote updates
    
    const op: DocumentOperation = {
      id: crypto.randomUUID(),
      schemaVersion: 'hermes-doc-op-v0',
      docId: this.docId,
      encryptedDelta: await SEA.encrypt(
        base64Encode(update),
        this.documentKey
      ),
      author: getMyNullifier(),
      timestamp: Date.now(),
      vectorClock: this.getVectorClock()
    };
    
    // Write to Gun
    getDocsOpsChain(this.client, this.docId)
      .get(op.id)
      .put(stripUndefined(op));
  }
  
  private subscribeToRemoteUpdates() {
    getDocsOpsChain(this.client, this.docId)
      .map()
      .on(async (data, key) => {
        if (!data || isOperationSeen(key)) return;
        
        const result = DocumentOperationSchema.safeParse(data);
        if (!result.success) return;
        
        const op = result.data;
        if (op.author === getMyNullifier()) return; // Skip own ops
        
        markOperationSeen(key);
        
        try {
          const decrypted = await SEA.decrypt(
            op.encryptedDelta,
            this.documentKey
          );
          const update = base64Decode(decrypted);
          Y.applyUpdate(this.ydoc, update, 'remote');
        } catch (err) {
          console.warn('[vh:docs] Failed to decrypt operation', key);
        }
      });
  }
  
  destroy() {
    this.awareness.destroy();
    // Unsubscribe from Gun
  }
}
```

### 3.4 Deduplication

Following the Forum pattern:

```typescript
const seenOperations = new Map<string, number>();
const SEEN_TTL_MS = 60_000;
const SEEN_CLEANUP_THRESHOLD = 500;

function isOperationSeen(id: string): boolean {
  const now = Date.now();
  const lastSeen = seenOperations.get(id);
  return !!(lastSeen && now - lastSeen < SEEN_TTL_MS);
}

function markOperationSeen(id: string): void {
  const now = Date.now();
  seenOperations.set(id, now);
  if (seenOperations.size > SEEN_CLEANUP_THRESHOLD) {
    for (const [key, ts] of seenOperations) {
      if (now - ts > SEEN_TTL_MS) seenOperations.delete(key);
    }
  }
}
```

---

## 4. Encryption

### 4.1 Document Key Management

Each document has a unique symmetric key derived by the owner:

```typescript
async function deriveDocumentKey(
  docId: string,
  ownerDevicePair: SEA.Pair
): Promise<string> {
  // Deterministic key derivation
  return await SEA.work(docId, ownerDevicePair);
}
```

### 4.2 Key Sharing with Collaborators

When sharing a document:

```typescript
async function shareDocumentKey(
  documentKey: string,
  collaboratorEpub: string,
  ownerDevicePair: SEA.Pair
): Promise<string> {
  // ECDH shared secret
  const sharedSecret = await SEA.secret(collaboratorEpub, ownerDevicePair);
  // Encrypt document key with shared secret
  return await SEA.encrypt(documentKey, sharedSecret);
}

async function receiveDocumentKey(
  encryptedKey: string,
  ownerEpub: string,
  myDevicePair: SEA.Pair
): Promise<string> {
  // ECDH shared secret (same as owner computed)
  const sharedSecret = await SEA.secret(ownerEpub, myDevicePair);
  // Decrypt document key
  return await SEA.decrypt(encryptedKey, sharedSecret);
}
```

### 4.3 Content Encryption

All content is encrypted before Gun writes:

```typescript
// Encrypt Yjs state for storage
async function encryptDocContent(
  ydoc: Y.Doc,
  documentKey: string
): Promise<string> {
  const state = Y.encodeStateAsUpdate(ydoc);
  const base64State = base64Encode(state);
  return await SEA.encrypt(base64State, documentKey);
}

// Decrypt Yjs state from storage
async function decryptDocContent(
  encryptedContent: string,
  documentKey: string
): Promise<Uint8Array> {
  const base64State = await SEA.decrypt(encryptedContent, documentKey);
  return base64Decode(base64State);
}
```

---

## 5. Storage (GunDB)

### 5.1 Namespace Topology

| Path | Type | Description |
|------|------|-------------|
| `~<devicePub>/docs/<docId>` | Auth | Document metadata + encrypted content |
| `~<devicePub>/docs/<docId>/ops/<opId>` | Auth | Encrypted CRDT operations |
| `vh/topics/<topicId>/articles/<articleId>` | Public | Published article object (token/identity free) |
| `~<devicePub>/hermes/docs` | Auth | User's document list |
| `~<devicePub>/hermes/docKeys/<docId>` | Auth | Received document keys |

Rule:

- Draft docs and draft ops must not be written under public `vh/*` namespaces.
- Public docs artifacts are publish outputs (for example topic articles), not private draft state.

### 5.2 Document Metadata Storage

```typescript
// Write document metadata
async function saveDocument(
  client: VennClient,
  doc: HermesDocument
): Promise<void> {
  const cleanDoc = stripUndefined({
    ...doc,
    collaborators: JSON.stringify(doc.collaborators),
    viewers: JSON.stringify(doc.viewers ?? [])
  });
  
  await new Promise<void>((resolve, reject) => {
    getDocsChain(client, doc.id).put(cleanDoc, (ack) => {
      if (ack?.err) reject(new Error(ack.err));
      else resolve();
    });
  });
}

// Parse document from Gun (handle JSON arrays)
function parseDocumentFromGun(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  
  if (typeof result.collaborators === 'string') {
    try {
      result.collaborators = JSON.parse(result.collaborators);
    } catch {
      result.collaborators = [];
    }
  }
  
  if (typeof result.viewers === 'string') {
    try {
      result.viewers = JSON.parse(result.viewers);
    } catch {
      result.viewers = [];
    }
  }
  
  return result;
}
```

### 5.3 Hydration Flow

```typescript
async function hydrateFromGun(
  resolveClient: () => VennClient | null,
  store: StoreApi<DocsState>
) {
  const client = resolveClient();
  if (!client) return;
  
  // Subscribe to user's document list
  getUserDocsChain(client).map().on(async (data, docId) => {
    if (!data || isDocumentSeen(docId)) return;
    
    // Fetch full document
    const docData = await getDocsChain(client, docId).once();
    if (!docData) return;
    
    const parsed = parseDocumentFromGun(docData);
    const result = HermesDocumentSchema.safeParse(parsed);
    
    if (result.success) {
      markDocumentSeen(docId);
      store.setState(s => addDocument(s, result.data));
    }
  });
}
```

---

## 6. Access Control

### 6.1 Permission Model

```typescript
type DocAccessLevel = 'owner' | 'editor' | 'viewer' | 'none';

function getAccessLevel(doc: HermesDocument, nullifier: string): DocAccessLevel {
  if (doc.owner === nullifier) return 'owner';
  if (doc.collaborators.includes(nullifier)) return 'editor';
  if (doc.viewers?.includes(nullifier)) return 'viewer';
  return 'none';
}

function canEdit(doc: HermesDocument, nullifier: string): boolean {
  const level = getAccessLevel(doc, nullifier);
  return level === 'owner' || level === 'editor';
}

function canView(doc: HermesDocument, nullifier: string): boolean {
  return getAccessLevel(doc, nullifier) !== 'none';
}

function canShare(doc: HermesDocument, nullifier: string): boolean {
  return doc.owner === nullifier;
}

function canDelete(doc: HermesDocument, nullifier: string): boolean {
  return doc.owner === nullifier;
}
```

### 6.2 Trust Gating

| Action | Required Trust Score |
|--------|---------------------|
| Create document | ≥ 0.5 |
| Edit document | ≥ 0.5 |
| View shared document | ≥ 0.5 |
| Publish `article` type | ≥ 0.5 |
| Create `letter` type | ≥ 0.7 |

---

## 7. UI & UX

### 7.1 Document List View

- Grid/list view of user's documents
- Filter by type (draft, proposal, report, letter, article)
- Sort by: Last Modified, Created, Title
- Quick actions: Open, Share, Delete

### 7.2 Editor View

- TipTap-based rich text editor
- Real-time collaboration with live cursors
- Collaborator presence indicators
- Auto-save every 5 seconds
- Offline indicator with pending changes count

### 7.3 Editor Features (v0)

| Feature | Status |
|---------|--------|
| Bold, Italic, Underline | Required |
| Headings (H1-H3) | Required |
| Bullet/Numbered Lists | Required |
| Blockquotes | Required |
| Links | Required |
| Tables | Optional (v1) |
| Images | Optional (v1) |
| Code blocks | Optional (v1) |

### 7.4 Sharing Flow

1. Owner clicks "Share" button
2. Enter collaborator's nullifier or scan QR code
3. Select access level (Editor or Viewer)
4. System looks up collaborator's epub from directory
5. Document key is encrypted and stored for collaborator
6. Collaborator sees document in their list

---

## 8. Local Persistence

### 8.1 Storage Keys

| Key | Content |
|-----|---------|
| `vh_docs_list:<nullifier>` | Array of document IDs |
| `vh_docs_keys:<nullifier>` | Map of docId → documentKey |
| `vh_docs_cache:<docId>` | Cached document content (encrypted) |

### 8.2 Persistence Flow

```typescript
function persistDocumentList(nullifier: string, docIds: string[]): void {
  localStorage.setItem(
    `vh_docs_list:${nullifier}`,
    JSON.stringify(docIds)
  );
}

function loadDocumentList(nullifier: string): string[] {
  const raw = localStorage.getItem(`vh_docs_list:${nullifier}`);
  return raw ? JSON.parse(raw) : [];
}

function persistDocumentKey(nullifier: string, docId: string, key: string): void {
  const keys = loadDocumentKeys(nullifier);
  keys[docId] = key;
  localStorage.setItem(
    `vh_docs_keys:${nullifier}`,
    JSON.stringify(keys)
  );
}
```

---

## 9. XP Integration

### 9.1 Document Creation XP

| Document Type | XP Reward | Cap |
|---------------|-----------|-----|
| `draft` | 0 | — |
| `proposal` | +1 `projectXP` | 3/day |
| `report` | +1 `civicXP` | 3/day |
| `letter` | +1 `civicXP` | 3/day |
| `article` | +1 `projectXP` | 3/day |

### 9.2 Collaboration XP

- **Substantive edit** (≥100 chars added) to another user's document: +1 `civicXP`
- Cap: 1 per document per day, 5 per day total

### 9.3 Elevation XP

- Document elevated to Forum thread: +2 `projectXP`
- Document used for Civic Action Kit action: +2 `civicXP`

---

## 10. Implementation Checklist

### 10.1 Data Model
- [ ] Create `HermesDocumentSchema` in `packages/data-model`
- [ ] Create `DocumentOperationSchema` in `packages/data-model`
- [ ] Create `DocumentKeyShareSchema` in `packages/data-model`
- [ ] Export types to `packages/types`
- [ ] Add schema validation tests

### 10.2 CRDT Layer
- [ ] Add `yjs` dependency to `packages/crdt`
- [ ] Implement `GunYjsProvider`
- [ ] Implement operation deduplication
- [ ] Add CRDT merge tests

### 10.3 Encryption
- [ ] Implement `deriveDocumentKey` in `packages/gun-client`
- [ ] Implement `shareDocumentKey` / `receiveDocumentKey`
- [ ] Implement `encryptDocContent` / `decryptDocContent`
- [ ] Add encryption round-trip tests

### 10.4 Gun Adapters
- [ ] Create `packages/gun-client/src/docsAdapters.ts`
- [ ] Update TopologyGuard for docs paths
- [ ] Add adapter tests

### 10.5 Store
- [ ] Implement `useDocsStore` in `apps/web-pwa`
- [ ] Add hydration from Gun
- [ ] Add localStorage persistence
- [ ] Implement E2E mock store
- [ ] Add store tests

### 10.6 UI
- [ ] Set up TipTap with Yjs binding
- [ ] Implement `DocsLayout` component
- [ ] Implement `DocumentList` component
- [ ] Implement `DocumentEditor` component
- [ ] Implement `ShareModal` component
- [ ] Implement reply-overflow `Convert to Article` draft handoff
- [ ] Implement publish-to-topic route (`vh/topics/<topicId>/articles/<articleId>`)
- [ ] Add accessibility tests

### 10.7 XP Integration
- [ ] Add `applyDocsXP` to XP ledger
- [ ] Wire XP calls in store actions
- [ ] Add XP emission tests

---

## 11. Security Considerations

### 11.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Unauthorized access | E2EE + explicit key sharing |
| Content tampering | Signatures on operations (v1) |
| Replay attacks | Timestamp + vector clock ordering |
| Metadata leakage | Minimal metadata; content always encrypted |
| Key compromise | Per-document keys (compromise one ≠ compromise all) |

### 11.2 Privacy Invariants

- Document content is NEVER stored in plaintext in Gun
- Collaborator list is visible in metadata (necessary for key distribution)
- Operations are encrypted with document key
- No public directory of documents

---

## 12. Future Enhancements (v1+)

- **Images/Attachments:** Encrypted blob storage in MinIO
- **Comments/Suggestions:** Track mode like Google Docs
- **Version History:** Snapshot and rollback
- **Public Documents:** Optional public sharing with read-only link
- **Templates:** Pre-built document templates for proposals, letters
- **Export:** PDF, Markdown, DOCX export
