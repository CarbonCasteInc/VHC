# Sprint 5: Docs + Civic Action Kit (Implementation Plan)

Status: Planning  
Predecessor: Sprint 4 foundations (delegation, budgets, V2 synthesis path)  
Context: Deliver longform publishing and civic facilitation loops for Season 0.

This sprint implements the "action layer" across HERMES and AGORA:

1. HERMES Docs (private-first collaborative drafting)
2. Reply-to-Article conversion from forum replies
3. Nomination and elevation artifact generation
4. Civic Action Kit forwarding (user-initiated only)

`CanonicalAnalysisV1` is legacy compatibility only. Sprint 5 is V2-first (`TopicId`, `TopicSynthesisV2`, `synthesis_id`, `StoryBundle`).

## 1. Guiding Constraints and Quality Gates

### 1.1 Non-negotiables

- [ ] LOC hard cap: 350 lines per file (tests/types exempt)
- [ ] Coverage: 100% line/branch for modified modules
- [ ] Browser-safe client code (no node-only APIs in `apps/*`)
- [ ] Privacy contract: no plaintext secrets in public mesh paths
- [ ] No default automated legislative form submission

### 1.2 Offline and E2E mode

- [ ] All Docs and Bridge flows must run in `VITE_E2E_MODE=true`
- [ ] E2E path uses mock mesh + mock identity with deterministic fixtures
- [ ] Hydration must tolerate delayed Gun client readiness and retry lazily
- [ ] Offline draft/edit/export flows must function before network reconnect

### 1.3 Gun isolation and topology

- [ ] App code accesses Gun only via `@vh/gun-client`
- [ ] Extend TopologyGuard allow-list with Sprint 5 paths:
  - `~*/docs/<docId>`
  - `~*/docs/<docId>/ops/<opId>`
  - `~*/hermes/docs/*`
  - `vh/topics/<topicId>/articles/<articleId>`
  - `vh/forum/nominations/<nominationId>`
  - `vh/forum/elevation/<topicId>`
  - `vh/bridge/stats/<repId>`
- [ ] Sensitive paths stay user-scoped or vault-only:
  - `~<devicePub>/docs/*` (encrypted)
  - `~<devicePub>/hermes/docs/*` (encrypted)
  - `~<devicePub>/hermes/bridge/*` (non-PII metadata only)

### 1.4 Trust and constituency gates

Season 0 defaults from SoT:

- Human/verified interactions: `trustScore >= 0.5`
- QF and higher-impact actions: `trustScore >= 0.7`
- Budgets/day per principal: `posts=20`, `comments=50`, `sentiment_votes=200`, `governance_votes=20`, `analyses=25 (max 5/topic)`, `shares=10`, `moderation=10`, `civic_actions=3`

Sprint 5 enforcement:

- [ ] Docs create/edit/publish requires verified session (`>= 0.5`)
- [ ] Elevation finalize requires explicit human approval
- [ ] Civic forwarding/send requires `>= 0.7` + valid `ConstituencyProof`
- [ ] Familiars inherit principal budgets; no independent influence lane

### 1.5 XP and privacy invariants

- [ ] XP updates stay local-first (`civicXP`, `projectXP`)
- [ ] Never emit `{district_hash, nullifier, XP}` together off-device
- [ ] Public counters must remain aggregate-only and anonymous

## 2. Phase 1: HERMES Docs Core

Objective: secure, collaborative, private-first docs with publish-to-topic and publish-to-article flows.

Canonical references:

- `docs/specs/spec-hermes-docs-v0.md`
- `docs/specs/spec-data-topology-privacy-v0.md`
- `docs/specs/spec-hermes-forum-v0.md`

### 2.1 Data model and schemas (`packages/data-model`)

#### 2.1.1 Document schema

```ts
interface HermesDocument {
  schemaVersion: 'hermes-document-v0';
  id: string;
  title: string; // <= 200
  owner: string; // principal nullifier
  collaborators: string[]; // edit access
  viewers?: string[]; // read-only access
  encryptedContent: string; // encrypted Yjs state
  createdAt: number;
  lastModifiedAt: number;
  lastModifiedBy: string;
  type: 'draft' | 'proposal' | 'report' | 'letter' | 'article';

  // publish metadata
  sourceTopicId?: string;
  publishedArticleId?: string;
  publishedAt?: number;
}

interface DocumentOperation {
  schemaVersion: 'hermes-doc-op-v0';
  id: string;
  docId: string;
  encryptedDelta: string;
  author: string;
  timestamp: number;
  vectorClock: Record<string, number>;
}
```

Tasks:

- [ ] Add document and op schemas/types
- [ ] Export types from shared packages
- [ ] Add validation tests (happy + reject malformed)

#### 2.1.2 Access control model

```ts
type DocAccessLevel = 'owner' | 'editor' | 'viewer';

function canEdit(doc: HermesDocument, nullifier: string): boolean {
  return doc.owner === nullifier || doc.collaborators.includes(nullifier);
}

function canView(doc: HermesDocument, nullifier: string): boolean {
  return canEdit(doc, nullifier) || Boolean(doc.viewers?.includes(nullifier));
}
```

Tasks:

- [ ] Implement access helpers and tests
- [ ] Enforce checks in store methods and publish flow

### 2.2 CRDT implementation (`packages/crdt`)

#### 2.2.1 Yjs integration

Decision: use Yjs as the text CRDT, synced through encrypted Gun ops.

```ts
class GunYjsProvider {
  constructor(
    private ydoc: Y.Doc,
    private docId: string,
    private encryptionKey: string,
  ) {}

  async broadcastUpdate(update: Uint8Array): Promise<void> {
    // encrypt and write to ~<devicePub>/docs/<docId>/ops/<opId>
  }

  applyRemoteUpdate(encryptedUpdate: string): void {
    // decrypt and apply via Y.applyUpdate(..., 'gun')
  }
}
```

Tasks:

- [ ] Add Yjs provider adapter
- [ ] Encrypt/decrypt update path
- [ ] Add merge-conflict tests and reconnect tests

#### 2.2.2 Collaboration key derivation

```ts
async function deriveDocumentKey(docId: string, ownerPair: SEA.Pair): Promise<string> {
  return SEA.work(docId, ownerPair);
}

async function shareDocumentKey(
  documentKey: string,
  collaboratorEpub: string,
  ownerPair: SEA.Pair,
): Promise<string> {
  const secret = await SEA.secret(collaboratorEpub, ownerPair);
  return SEA.encrypt(documentKey, secret);
}
```

Tasks:

- [ ] Implement key derive/share/receive helpers
- [ ] Test collaborator onboarding and revoked access handling

### 2.3 Gun adapters (`packages/gun-client`)

```ts
function getDocsChain(client: VennClient, docId: string) {
  return createGuardedChain(client.gun.user().get('docs').get(docId), `~*/docs/${docId}`);
}

function getDocsOpsChain(client: VennClient, docId: string) {
  return createGuardedChain(
    client.gun.user().get('docs').get(docId).get('ops'),
    `~*/docs/${docId}/ops`,
  );
}

function getUserDocsChain(client: VennClient) {
  return client.gun.user().get('hermes').get('docs');
}
```

Tasks:

- [ ] Add docs adapters and exports
- [ ] Add adapter tests
- [ ] Verify TopologyGuard blocks non-allowlisted writes

### 2.4 Docs store (`apps/web-pwa/src/store/hermesDocs.ts`)

```ts
interface DocsState {
  documents: Map<string, HermesDocument>;
  activeDocId: string | null;

  createDocument(title: string, type: HermesDocument['type']): Promise<HermesDocument>;
  openDocument(docId: string): Promise<void>;
  shareDocument(docId: string, collaboratorNullifier: string): Promise<void>;
  updateDocument(docId: string, update: Uint8Array): Promise<void>;
  publishDocumentAsArticle(docId: string, topicId: string): Promise<string>;
  loadUserDocuments(): Promise<HermesDocument[]>;
}
```

Implementation tasks:

- [ ] Implement store actions and hydration
- [ ] Deduplicate repeated Gun callbacks (TTL seen map)
- [ ] Local persistence of list/index for fast restore
- [ ] E2E mock store parity (`createMockDocsStore`)

### 2.5 UI implementation (`apps/web-pwa`)

Components:

- [ ] `DocsLayout`
- [ ] `DocumentList`
- [ ] `DocumentEditor`
- [ ] `CollaboratorPanel`
- [ ] `ShareModal`
- [ ] `DocumentHeader`

Features:

- [ ] Rich text basics (bold, italic, headings, lists, links)
- [ ] Presence indicators (ephemeral, non-persistent)
- [ ] Type-aware templates (`proposal`, `report`, `letter`, `article`)
- [ ] Publish action emits article entry under topic

### 2.6 Quality gates for Phase 1

- [ ] E2EE verified for doc content and deltas
- [ ] No doc secrets in `vh/*` public paths
- [ ] Multi-user merge behavior deterministic in tests
- [ ] Offline edit + reconnect replay passes

## 3. Phase 2: Reply-to-Article Conversion

Objective: enforce short-reply contract while giving a longform path through Docs.

### 3.1 UX contract

- [ ] Reply composer hard cap: 240 chars
- [ ] Overflow path: show `Convert to Article` CTA
- [ ] Conversion opens docs editor seeded with reply text
- [ ] Draft keeps `sourceTopicId`, `sourceThreadId`, and author provenance
- [ ] Publish inserts article card into topic + forum surfaces

### 3.2 Data contract

```ts
type ForumPostType = 'reply' | 'article';

interface ForumPost {
  id: string;
  schemaVersion: 'hermes-post-v0';
  threadId: string;
  parentId: string | null;
  topicId: string;
  author: string;
  via?: 'human' | 'familiar';
  type: ForumPostType;
  content: string; // reply <= 240
  articleRefId?: string; // required for article
  timestamp: number;
  upvotes: number;
  downvotes: number;
}
```

Tasks:

- [ ] Enforce cap at UI + schema boundary
- [ ] Add conversion route and docs handoff payload
- [ ] Preserve thread/topic context on publish
- [ ] Add tests for overflow and conversion path

### 3.3 Storage paths

- Reply posts: `vh/forum/threads/<threadId>/posts/<postId>`
- Published articles: `vh/topics/<topicId>/articles/<articleId>`
- Doc source links: user-scoped metadata + article public reference

## 4. Phase 3: Nomination and Elevation Artifacts

Objective: move high-salience stories/topics/articles into actionable civic packets.

### 4.1 Nomination policy and events

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

Tasks:

- [ ] Implement nomination writes + dedupe by policy window
- [ ] Enforce verified participation and rate caps
- [ ] Persist elevation state under `vh/forum/elevation/<topicId>`

### 4.2 Artifact generation contract

```ts
interface ElevationArtifacts {
  briefDocId: string;
  proposalScaffoldId: string;
  talkingPointsId: string;
  generatedAt: number;
  sourceTopicId: string;
  sourceSynthesisId: string;
}
```

Tasks:

- [ ] Generate artifacts from current `{topicId, epoch, synthesisId}`
- [ ] Store local authoritative payloads; publish metadata-only projections
- [ ] Expose edit + review flow before forwarding

### 4.3 Human approval boundary

- [ ] Familiar can draft and suggest nominations
- [ ] Familiar cannot finalize elevation without explicit user approval
- [ ] Approvals logged with on-behalf assertions and timestamps

## 5. Phase 4: Civic Action Kit Facilitation

Objective: user-initiated representative outreach with local receipts and privacy-safe public aggregates.

Canonical reference: `docs/specs/spec-civic-action-kit-v0.md`

### 5.1 Data model and schema (`packages/data-model`)

```ts
interface Representative {
  id: string;
  name: string;
  title: string;
  office: 'senate' | 'house' | 'state' | 'local';
  country: string;
  state?: string;
  district?: string;
  districtHash: string;
  contactMethod: 'email' | 'phone' | 'both' | 'manual';
  contactUrl?: string;
  email?: string;
  phone?: string;
  website?: string;
  socialHandles?: Record<string, string>;
  lastVerified: number;
}

type DeliveryIntent = 'email' | 'phone' | 'share' | 'export' | 'manual';

interface CivicAction {
  id: string;
  schemaVersion: 'hermes-action-v1';
  author: string;
  sourceTopicId: string;
  sourceSynthesisId: string;
  sourceArtifactId: string;
  representativeId: string;
  intent: DeliveryIntent;
  constituencyProof: ConstituencyProof;
  status: 'draft' | 'ready' | 'completed' | 'failed';
  createdAt: number;
  sentAt?: number;
  attempts: number;
  lastError?: string;
}

interface DeliveryReceipt {
  id: string;
  schemaVersion: 'hermes-receipt-v1';
  actionId: string;
  representativeId: string;
  intent: DeliveryIntent;
  status: 'success' | 'failed' | 'user-cancelled';
  timestamp: number;
  userAttested: boolean;
  errorCode?: string;
}
```

Tasks:

- [ ] Add schemas and shared types
- [ ] Add validation tests including malformed proof and status transitions

### 5.2 Representative directory

- [ ] Create/update `representatives.json` with versioning metadata
- [ ] Maintain indexes: `byState`, `byDistrictHash`
- [ ] Lookup by `district_hash` from constituency proof
- [ ] Add update script and validation gate in CI

### 5.3 Native intent and report generation

Required handlers:

- [ ] `mailto:`
- [ ] `tel:`
- [ ] OS share sheet
- [ ] local export (PDF/markdown)
- [ ] manual contact-page fallback

Report pipeline tasks:

- [ ] Build packet from `BriefDoc`, `ProposalScaffold`, `TalkingPoints`
- [ ] Render local PDF
- [ ] Persist local metadata pointer
- [ ] Create local receipt on success/failure/cancel

### 5.4 Gun adapters (`packages/gun-client`)

```ts
function getUserActionsChain(client: VennClient) {
  return client.gun.user().get('hermes').get('bridge').get('actions');
}

function getUserReceiptsChain(client: VennClient) {
  return client.gun.user().get('hermes').get('bridge').get('receipts');
}

function getRepActionCountChain(client: VennClient, repId: string) {
  return createGuardedChain(client.gun.get('vh').get('bridge').get('stats').get(repId), `vh/bridge/stats/${repId}`);
}
```

Tasks:

- [ ] Add adapters and tests
- [ ] Enforce strip-PII + strip-undefined before writes
- [ ] Ensure only aggregate stats land in public path

### 5.5 Bridge store and UI (`apps/web-pwa`)

Store:

- [ ] `createAction`
- [ ] `markReceipt`
- [ ] `loadActions`
- [ ] `loadReceipts`
- [ ] `findRepresentatives`

UI components:

- [ ] `BridgeLayout`
- [ ] `RepresentativeSelector`
- [ ] `ActionComposer`
- [ ] `ActionHistory`
- [ ] `ReceiptViewer`

Core user flow:

1. Select representative by district
2. Review/edit generated artifacts
3. Pick delivery intent
4. Complete user-initiated send/share/export
5. Persist local receipt and update aggregate counter

## 6. Phase 5: Safety and Governance Glue

### 6.1 Budget enforcement

- [ ] Enforce `civic_actions/day = 3` at action boundary
- [ ] Enforce `shares/day = 10` for share/export path
- [ ] Enforce familiar inheritance of principal budgets

### 6.2 Privacy controls

- [ ] Public paths never include OAuth tokens, private keys, PII
- [ ] Public paths never include `{district_hash, nullifier}` pair
- [ ] Action/receipt records in user-scoped mesh omit personal profile fields

### 6.3 Legacy boundary

- [ ] No new writes keyed by legacy `analysis_id`
- [ ] Use `{topic_id, synthesis_id, epoch}` for new Sprint 5 integrations
- [ ] Keep compatibility adapters read-only where necessary

## 7. XP Hooks (Docs, Elevation, Bridge)

### 7.1 Docs XP

- [ ] Proposal/report doc creation rewards with daily cap
- [ ] Collaborative contribution rewards (substantive edit threshold)
- [ ] Article publish reward (bounded by budget)

### 7.2 Bridge XP

- [ ] Receipt-marked send rewards (`civicXP`) with weekly cap
- [ ] Rep-specific cooldown to reduce spam loops
- [ ] Elevation-to-forward action bonus (bounded)

### 7.3 Invariants

- [ ] XP is local-first and per principal nullifier
- [ ] No XP export that can deanonymize a participant

## 8. Verification and Hardening

### 8.1 Automated tests

Unit tests:

- [ ] Docs schemas and permission helpers
- [ ] Bridge schemas and intent validation
- [ ] Strip/sanitize helpers for Gun writes
- [ ] Budget and trust gate checks

Integration tests:

- [ ] Docs store create/share/edit/publish
- [ ] Forum reply-to-article conversion
- [ ] Elevation thresholds and artifact generation
- [ ] Bridge send/receipt flows

E2E tests (`VITE_E2E_MODE=true`):

- [ ] Two-user collaborative docs merge
- [ ] Reply overflow to article conversion
- [ ] Nomination threshold crossing and artifact creation
- [ ] Representative forwarding with receipt and counter update
- [ ] Offline draft/edit then reconnect sync

### 8.2 Manual verification

- [ ] Inspect Gun payloads for secrecy invariants
- [ ] Confirm no public PII leakage
- [ ] Verify trust gate UX explains blocked actions
- [ ] Verify familiar high-impact approval prompts

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| CRDT merge edge cases | Use Yjs provider with deterministic replay tests |
| Doc key-share mistakes | Explicit key-share protocol + negative tests |
| Rep data drift | Versioned directory + update script + schema validation |
| Spam through civic forwarding | trust >= 0.7, constituency proof, strict budgets |
| Privacy leak in public counters | aggregate-only schema + static path checks |
| Familiar overreach | scoped grants + human approval for high-impact actions |

## 10. Dependencies and Deliverables

### 10.1 Dependencies

- `yjs`
- `@tiptap/react` (+ required extensions)
- PDF generation lib (`pdf-lib` or equivalent)

### 10.2 Deliverables

- [ ] Docs: encrypted collaborative drafts and publish flow
- [ ] Reply-to-Article path with 240-char enforcement
- [ ] Nomination/elevation pipeline with artifact generation
- [ ] Civic Action Kit with native intents + receipts
- [ ] Budget/trust/privacy enforcement
- [ ] Full test coverage for touched modules

## 11. Sprint 5 Summary and Next Steps

Phase breakdown:

| Phase | Scope | Estimate | Status |
|-------|-------|----------|--------|
| 1 | HERMES Docs core | ~2 weeks | [ ] Not started |
| 2 | Reply-to-Article | ~0.5 week | [ ] Not started |
| 3 | Nomination + elevation artifacts | ~1 week | [ ] Not started |
| 4 | Civic Action Kit | ~1.5 weeks | [ ] Not started |
| 5 | Hardening and verification | ~1 week | [ ] Not started |

Immediate next steps:

1. Finalize specs (`spec-hermes-docs-v0.md`, `spec-hermes-forum-v0.md`, `spec-civic-action-kit-v0.md`)
2. Implement schemas and adapters
3. Wire UI flows and trust/budget boundaries
4. Complete E2E + manual privacy verification
