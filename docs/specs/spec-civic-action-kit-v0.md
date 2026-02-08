# Civic Action Kit Spec (v0)

Version: 0.3  
Status: Canonical for Season 0 facilitation model  
Context: Verified, user-initiated civic outreach from elevated topic artifacts.

Core boundary: the Civic Action Kit facilitates civic contact. It does not submit legislative forms automatically by default.

## 1. Core Principles

1. Facilitation over automation.
2. Verified voice with constituency-aware routing.
3. Local-first handling of sensitive profile and receipt data.
4. Public sharing restricted to aggregate counters and safe metadata.
5. Familiars can draft suggestions but high-impact forwarding requires human approval.

## 2. Data Model

### 2.1 Elevation artifact contract

Elevation can auto-draft a civic packet from a qualified topic/article.

```ts
interface ElevationArtifacts {
  briefDocId: string; // communication brief
  proposalScaffoldId: string; // project framing and request
  talkingPointsId: string; // call/email bullets
  generatedAt: number;
  sourceTopicId: string;
  sourceSynthesisId: string;
  sourceEpoch: number;
}
```

Generation triggers are policy-driven and must be deterministic for the same threshold inputs.

### 2.2 Representative schema

```ts
interface Representative {
  id: string; // canonical ID (e.g. us-house-ca-11)

  // identity
  name: string;
  title: string; // Senator, Representative, Councilmember, etc.
  party?: string;

  // jurisdiction
  office: 'senate' | 'house' | 'state' | 'local';
  country: string; // ISO country code
  state?: string; // two-letter in US contexts
  district?: string; // omitted for offices without district granularity
  districtHash: string; // hashed for proof matching

  // contact
  contactMethod: 'email' | 'phone' | 'both' | 'manual';
  contactUrl?: string;
  email?: string;
  phone?: string;
  website?: string;

  // metadata
  photoUrl?: string;
  socialHandles?: Record<string, string>;
  lastVerified: number;
}
```

### 2.3 Civic action schema

```ts
type DeliveryIntent = 'email' | 'phone' | 'share' | 'export' | 'manual';

interface CivicAction {
  id: string;
  schemaVersion: 'hermes-action-v1';

  // author
  author: string; // principal nullifier

  // source
  sourceTopicId: string;
  sourceSynthesisId: string;
  sourceEpoch: number;
  sourceArtifactId: string;
  sourceDocId?: string;
  sourceThreadId?: string;

  // target
  representativeId: string;

  // letter/content
  topic: string; // <= 100
  stance: 'support' | 'oppose' | 'inform';
  subject: string; // <= 200
  body: string; // 50..5000
  intent: DeliveryIntent;

  // verification
  constituencyProof: ConstituencyProof;

  // state
  status: 'draft' | 'ready' | 'completed' | 'failed';
  createdAt: number;
  sentAt?: number;

  // retries / diagnostics
  attempts: number;
  lastError?: string;
  lastErrorCode?: string;
}

interface ConstituencyProof {
  district_hash: string;
  nullifier: string;
  merkle_root: string;
}
```

### 2.4 Delivery receipt schema

```ts
interface DeliveryReceipt {
  id: string;
  schemaVersion: 'hermes-receipt-v1';

  actionId: string;
  representativeId: string;

  status: 'success' | 'failed' | 'user-cancelled';
  timestamp: number;
  intent: DeliveryIntent;

  userAttested: boolean;

  errorMessage?: string;
  errorCode?: string;

  retryCount: number;
  previousReceiptId?: string;
}
```

### 2.5 Content limits and quotas

- `topic <= 100`
- `subject <= 200`
- `body = 50..5000`
- `civic_actions/day = 3` per principal nullifier
- one representative-forward action per rep per rolling week (recommended default)

## 3. Representative Directory

### 3.1 Database structure

```ts
interface RepresentativeDirectory {
  version: string;
  lastUpdated: number;
  updateSource: string;

  representatives: Representative[];

  // indexes
  byState: Record<string, string[]>;
  byDistrictHash: Record<string, string[]>;
}
```

### 3.2 Matching representatives to users

```ts
function findRepresentatives(
  proof: ConstituencyProof,
  directory: RepresentativeDirectory,
): Representative[] {
  const ids = directory.byDistrictHash[proof.district_hash] ?? [];

  return ids
    .map((id) => directory.representatives.find((rep) => rep.id === id))
    .filter(Boolean) as Representative[];
}
```

### 3.3 Directory update process

Directory requirements:

- Bundled snapshot for offline startup
- Versioned update source
- Schema validation before replacing local cache

```ts
async function checkForDirectoryUpdate(localVersion: string): Promise<boolean> {
  const remote = await fetchDirectoryManifest();
  return remote.version > localVersion;
}

async function updateDirectory(): Promise<void> {
  const next = await fetchDirectoryPayload();
  validateRepresentativeDirectory(next);
  saveDirectory(next);
}
```

## 4. Delivery Flow (Facilitation)

### 4.1 Architecture overview

```text
PWA Action Center
  -> draft/edit packet from elevation artifacts
  -> generate local report bundle (PDF + metadata)
  -> open user-selected delivery intent
  -> write local receipt
  -> update aggregate counters (public, anonymous)
```

### 4.2 Report generation pipeline

```ts
interface ReportPayload {
  actionId: string;
  representative: Representative;
  topic: string;
  stance: 'support' | 'oppose' | 'inform';
  body: string;
  artifactRefs: ElevationArtifacts;
  generatedAt: number;
}

interface ReportResult {
  reportId: string;
  filePath: string;
  format: 'pdf';
}

async function generateReport(payload: ReportPayload): Promise<ReportResult> {
  const filePath = await renderPdf(payload);
  const reportId = await saveLocalReport(filePath, payload.actionId);
  return { reportId, filePath, format: 'pdf' };
}
```

Report content should include:

- Brief summary
- Proposal scaffold excerpt
- Talking points
- Representative metadata
- Timestamp and provenance references (`topicId`, `synthesisId`, `epoch`)

### 4.3 User-initiated delivery channels

```ts
async function openDeliveryChannel(
  action: CivicAction,
  rep: Representative,
  intent: DeliveryIntent,
): Promise<void> {
  switch (intent) {
    case 'email':
      return openMailto(rep.email, action.subject, action.body);
    case 'phone':
      return openTel(rep.phone);
    case 'share':
      return openShareSheet(action.id);
    case 'export':
      return exportReportFile(action.id);
    case 'manual':
      return openContactPage(rep.contactUrl);
  }
}
```

Rules:

- No hidden sends
- No default automation against legislative forms
- Always expose manual contact fallback

### 4.4 Delivery receipts (user-attested)

Receipt semantics:

- Success/failure/cancel are all valid terminal outcomes
- Receipt records user action intent and result, not third-party portal proof
- Retries create chained receipts via `previousReceiptId`

## 5. Storage Topology and Privacy

### 5.1 Namespace topology

| Path | Type | Description |
|------|------|-------------|
| `~<devicePub>/hermes/bridge/actions/<actionId>` | Auth | User actions (non-PII metadata only) |
| `~<devicePub>/hermes/bridge/receipts/<receiptId>` | Auth | User receipts (non-PII metadata only) |
| `~<devicePub>/hermes/bridge/reports/<reportId>` | Auth | Report pointers/checksums (not profile data) |
| `vh/bridge/stats/<repId>` | Public | Anonymous aggregate action counts |

### 5.2 Action and receipt writes

```ts
async function saveAction(client: VennClient, action: CivicAction): Promise<void> {
  const clean = stripUndefined(stripPII(action));
  await putWithAck(getUserActionsChain(client).get(action.id), clean);
}

async function saveReceipt(client: VennClient, receipt: DeliveryReceipt): Promise<void> {
  const clean = stripUndefined(stripPII(receipt));
  await putWithAck(getUserReceiptsChain(client).get(receipt.id), clean);
}
```

Required write filters:

- Remove local profile/address fields
- Remove nullifier-profile linkage fields
- Reject writes containing OAuth tokens or secrets

### 5.3 Aggregate stats updates

```ts
async function incrementRepStats(client: VennClient, repId: string): Promise<void> {
  const stats = getRepActionCountChain(client, repId);
  stats.get('count').put(/* increment */);
  stats.get('lastActivity').put(Date.now());
}
```

Public stats may include:

- Total action count
- Last activity timestamp
- Optional rolling-window counters

Public stats must not include:

- Nullifiers
- District hash
- Personal contact/profile fields

## 6. Local Persistence

### 6.1 Storage keys

| Key | Content |
|-----|---------|
| `vh_bridge_actions:<nullifier>` | Action IDs / local state index |
| `vh_bridge_receipts:<nullifier>` | Action-to-receipt mappings |
| `vh_bridge_reports:<nullifier>` | Report file pointers/checksums |
| `vh_bridge_profile:<nullifier>` | Encrypted user profile data |

### 6.2 Profile handling (local-only)

```ts
async function saveUserProfile(nullifier: string, profile: UserProfile): Promise<void> {
  const encrypted = await encryptLocal(profile);
  await indexedDbSet(`vh_bridge_profile:${nullifier}`, encrypted);
}

async function loadUserProfile(nullifier: string): Promise<UserProfile | null> {
  const encrypted = await indexedDbGet(`vh_bridge_profile:${nullifier}`);
  return encrypted ? decryptLocal(encrypted) : null;
}
```

Profile data never belongs in public `vh/*` namespaces.

## 7. Trust and Verification

### 7.1 Trust requirements

| Action | Required Trust Score | Additional Requirements |
|--------|----------------------|------------------------|
| View rep list | >= 0.5 | Valid constituency proof |
| Draft action | >= 0.5 | Valid constituency proof |
| Generate report | >= 0.7 | Valid constituency proof |
| Forward/send and receipt finalization | >= 0.7 | Valid constituency proof + budget availability |

### 7.2 Constituency proof verification

```ts
interface VerificationResult {
  valid: boolean;
  error?: 'nullifier_mismatch' | 'district_mismatch' | 'stale_proof';
}

function verifyConstituencyProof(
  action: CivicAction,
  representative: Representative,
): VerificationResult {
  const proof = action.constituencyProof;

  if (proof.nullifier !== action.author) {
    return { valid: false, error: 'nullifier_mismatch' };
  }

  if (proof.district_hash !== representative.districtHash) {
    return { valid: false, error: 'district_mismatch' };
  }

  if (!isRecentMerkleRoot(proof.merkle_root)) {
    return { valid: false, error: 'stale_proof' };
  }

  return { valid: true };
}
```

### 7.3 Familiar boundary for bridge actions

- Familiar can prefill packet and suggest delivery method.
- Familiar cannot finalize forwarding without explicit human approval.
- High-impact approval events must be logged with `onBehalfOf` metadata.

## 8. UI and UX Contract

### 8.1 Action Center layout

Core sections:

- Representative list for verified district
- Artifact packet preview/editor
- Delivery method controls
- Action history and receipts

### 8.2 Representative card contract

Representative card should include:

- name/title/party/office
- district or jurisdiction
- available channels (email/phone/manual)
- `lastVerified` timestamp

### 8.3 Action composer contract

Composer fields:

- topic
- stance
- subject
- body
- packet sources (`BriefDoc`, `ProposalScaffold`, `TalkingPoints`)
- intent selection

Behavior:

- enforce size limits
- show validation errors before enabling send
- show trust/budget gating reasons inline

### 8.4 Delivery status and receipt viewer

Receipt view should display:

- target representative
- intent used
- timestamp
- status
- retry history

### 8.5 Template support

```ts
interface LetterTemplate {
  id: string;
  topic: string;
  stance: 'support' | 'oppose' | 'inform';
  subject: string;
  body: string;
  tags: string[];
}
```

Templates are local aids; users must explicitly review before forwarding.

## 9. XP Integration

### 9.1 Civic action XP policy

Suggested default emissions:

| Action | XP Reward | Cap |
|--------|-----------|-----|
| First successful rep-forward in rolling window | +3 civicXP | 1 per rep/week |
| Subsequent successful forwards | +1 civicXP | bounded by weekly cap |
| Thread/article elevated to action packet | +1 civicXP | bounded by weekly cap |

### 9.2 XP emission function

```ts
function applyBridgeXP(event: BridgeXPEvent): void {
  const ledger = useXpLedger.getState();

  switch (event.type) {
    case 'action_completed':
      if (ledger.canAddBridgeXP(event.amount)) {
        ledger.addCivicXP(event.amount);
      }
      break;

    case 'elevation_forwarded':
      if (ledger.canAddElevationXP()) {
        ledger.addCivicXP(1);
      }
      break;
  }
}
```

XP invariants:

- per principal nullifier
- local-first and privacy-safe
- no public per-user XP replication

## 10. Implementation Checklist

### 10.1 Data model

- [ ] `RepresentativeSchema`
- [ ] `CivicActionSchema`
- [ ] `DeliveryReceiptSchema`
- [ ] `ElevationArtifacts` contract export
- [ ] schema validation tests

### 10.2 Directory

- [ ] Representative directory file and validation
- [ ] lookup by `district_hash`
- [ ] versioned update script

### 10.3 Gun adapters

- [ ] user action/receipt chains
- [ ] aggregate stats chain
- [ ] strip/sanitize helpers on write path

### 10.4 Store

- [ ] `useBridgeStore` actions, hydration, persistence
- [ ] encrypted profile persistence
- [ ] E2E mock bridge store parity

### 10.5 Report and delivery

- [ ] local PDF report generation
- [ ] mailto/tel/share/export/manual adapters
- [ ] receipt creation for success/failure/cancel

### 10.6 UI

- [ ] `BridgeLayout`
- [ ] `RepresentativeSelector`
- [ ] `ActionComposer`
- [ ] `ActionHistory`
- [ ] `ReceiptViewer`

### 10.7 Trust, budgets, and XP

- [ ] enforce trust thresholds at action boundaries
- [ ] enforce `civic_actions/day` budget
- [ ] wire XP emissions with caps

## 11. Test Requirements

1. Directory lookup correctness by district hash.
2. Constituency proof verification and failure modes.
3. Native intent dispatch per channel.
4. Receipt lifecycle across success/failure/cancel/retry.
5. Privacy checks for local-only profile and public aggregate-only stats.
6. Trust and budget gate enforcement.
7. Elevation artifact references (`topicId`, `synthesisId`, `epoch`) integrity.

## 12. Security and Privacy Considerations

### 12.1 Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Spam forwarding | trust >= 0.7 + constituency proof + daily budgets |
| Representative impersonation | verified directory source + signature checks where available |
| PII leakage | local encryption + strip-PII write filters |
| Data drift | versioned directory updates and schema validation |
| Silent automation | explicit user action requirement + manual fallback visibility |

### 12.2 Privacy invariants

- Personal profile data never leaves device except direct user-initiated channel handoff.
- Public counters contain no nullifiers or district hashes.
- Actions and receipts synced to authenticated mesh paths must omit profile PII.
- Reports remain local unless explicitly shared/exported.
