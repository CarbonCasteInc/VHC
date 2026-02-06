# Civic Action Kit Spec (v0)

**Version:** 0.1
**Status:** Draft — Sprint 5 Planning
**Context:** Facilitation of verified constituent outreach (reports + contact channels) for TRINITY OS.

> **"We enable constituents to speak through user-initiated channels. No default automation."**
> — System Architecture Prime Directive #5 (updated)

---

## 1. Core Principles

1.  **Civic Facilitation:** We provide reports + contact channels; the user initiates delivery.
2.  **Verified Voice:** Actions require constituency proof (RegionProof) — you can only contact YOUR representatives.
3.  **Privacy-Preserving:** Nullifiers and ZK proofs prevent de-anonymization while proving residency.
4.  **Local-Only PII:** Personal details remain on-device; no nullifier + PII linkage in shared records.
5.  **Clear Consent:** Delivery is explicit (email/phone/share/export) and user-visible.

---

## 2. Data Model

### 2.1 Representative Schema

```typescript
interface Representative {
  id: string;                     // Canonical ID (e.g., "us-sen-ca-feinstein")
  
  // Identity
  name: string;                   // "Dianne Feinstein"
  title: string;                  // "Senator" | "Representative" | "Councilmember"
  party: string;                  // "D" | "R" | "I" | etc.
  
  // Jurisdiction
  country: string;                // "US"
  state: string;                  // "CA" (2-letter code)
  district?: string;              // "12" (for House reps, null for Senators)
  districtHash: string;           // SHA256 hash for matching RegionProof
  
  // Contact
  contactUrl?: string;            // Official contact page (manual use)
  contactMethod: 'email' | 'phone' | 'both' | 'manual';
  email?: string;                 // Direct email if available
  phone?: string;                 // Direct office phone if available
  website?: string;
  
  // Metadata
  photoUrl?: string;
  website?: string;
  socialHandles?: Record<string, string>;
  lastVerified: number;           // When contact data was last verified
}
```

### 2.2 Legislative Action Schema

```typescript
interface LegislativeAction {
  id: string;                     // UUID
  schemaVersion: 'hermes-action-v0';
  
  // Author
  author: string;                 // Nullifier (identity key)
  
  // Target
  representativeId: string;       // Representative.id
  
  // Content
  topic: string;                  // Topic category (≤ 100 chars)
  stance: 'support' | 'oppose' | 'inform';
  subject: string;                // Email subject (≤ 200 chars)
  body: string;                   // Letter body (50-5000 chars)
  reportId: string;               // Local report reference (PDF)
  deliveryMethod: 'email' | 'phone' | 'share' | 'export' | 'manual';
  
  // Verification
  constituencyProof: ConstituencyProof;
  
  // State
  status: 'draft' | 'ready' | 'shared' | 'sent' | 'failed';
  
  // Source (optional)
  sourceDocId?: string;           // If drafted in HERMES Docs
  sourceThreadId?: string;        // If linked from Forum thread
  
  // Timestamps
  createdAt: number;
  sentAt?: number;
  
  // Errors (local-only)
  lastError?: string;
}

interface ConstituencyProof {
  district_hash: string;          // From RegionProof public signals
  nullifier: string;              // Same as author nullifier
  merkle_root: string;            // From RegionProof public signals
}
```

### 2.3 Delivery Receipt Schema

```typescript
interface DeliveryReceipt {
  id: string;                     // UUID
  schemaVersion: 'hermes-receipt-v0';
  
  // Reference
  actionId: string;               // Parent action ID
  
  // Result
  status: 'pending' | 'success' | 'failed';
  timestamp: number;
  deliveryMethod: 'email' | 'phone' | 'share' | 'export' | 'manual';
  
  // Debug (for failures)
  errorMessage?: string;
  errorCode?: string;             // e.g., 'SEND_FAILED'
  
  // Retry metadata (local-only)
  retryCount: number;
  previousReceiptId?: string;
}
```

### 2.4 Content Size Limits

- `topic`: ≤ 100 characters
- `subject`: ≤ 200 characters
- `body`: 50-5000 characters (min enforced for substantive content)
- Max actions per user per day: 5
- Max actions per representative per user per week: 1

---

## 3. Representative Database

### 3.1 Database Structure

```typescript
interface RepresentativeDatabase {
  version: string;                // Semantic version
  lastUpdated: number;            // Unix timestamp
  updateSource: string;           // URL of source data
  
  representatives: Representative[];
  
  // Indexes for quick lookup
  byState: Record<string, string[]>;      // state → rep IDs
  byDistrict: Record<string, string[]>;   // districtHash → rep IDs
}
```

### 3.2 Matching Representatives to Users

```typescript
function findRepresentatives(
  regionProof: ConstituencyProof,
  database: RepresentativeDatabase
): Representative[] {
  const districtHash = regionProof.district_hash;
  
  // Find reps matching this district
  const repIds = database.byDistrict[districtHash] ?? [];
  
  return repIds
    .map(id => database.representatives.find(r => r.id === id))
    .filter(Boolean) as Representative[];
}
```

### 3.3 Database Updates

The representative database is:
- Bundled with the app (`apps/web-pwa/src/data/representatives.json`)
- Updated via CI pipeline from public data sources
- Versioned for cache invalidation

```typescript
// Check for updates
async function checkForDatabaseUpdate(): Promise<boolean> {
  const current = getLocalDatabase();
  const remote = await fetchRemoteVersion();
  return remote.version > current.version;
}

// Apply update
async function updateDatabase(): Promise<void> {
  const newDb = await fetchRemoteDatabase();
  validateDatabase(newDb); // Schema validation
  saveLocalDatabase(newDb);
}
```

---

## 4. Delivery Flow (Facilitation)

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         PWA (Web)                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                Civic Action Kit UI                       │    │
│  │   • Draft letter                                         │    │
│  │   • Generate report (PDF)                                │    │
│  │   • Open email/phone/share/export                        │    │
│  │   • Mark as sent                                         │    │
│  └───────────────────────┬─────────────────────────────────┘    │
└──────────────────────────┼──────────────────────────────────────┘
                           │ Native intents / OS share sheet
┌──────────────────────────▼──────────────────────────────────────┐
│                     User Devices & Apps                          │
│  • Email client (mailto)                                         │
│  • Phone app (tel)                                               │
│  • Share target (copy/export/PDF)                                │
│  • Official contact page (manual use)                            │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Report Generation

```typescript
interface ReportResult {
  reportId: string;
  filePath: string;
  format: 'pdf';
}

async function generateReport(
  action: LegislativeAction,
  representative: Representative
): Promise<ReportResult> {
  // 1. Compose report content (letter + metadata)
  const payload = buildReportPayload(action, representative);

  // 2. Render to PDF (local-only)
  const filePath = await renderPdf(payload);

  // 3. Persist report metadata (local)
  const reportId = await saveLocalReport(filePath, action.id);

  return { reportId, filePath, format: 'pdf' };
}
```

### 4.3 User-Initiated Delivery

```typescript
type DeliveryIntent = 'email' | 'phone' | 'share' | 'export' | 'manual';

async function openDeliveryChannel(
  action: LegislativeAction,
  rep: Representative,
  intent: DeliveryIntent
): Promise<void> {
  switch (intent) {
    case 'email':
      return openMailto(rep.email, action.subject, action.body);
    case 'phone':
      return openTel(rep.phone);
    case 'share':
      return openShareSheet(action.reportId);
    case 'export':
      return exportReportFile(action.reportId);
    case 'manual':
      return openContactPage(rep.contactUrl);
  }
}
```

### 4.4 Delivery Receipts (User-Attested)

- Receipts record user-initiated delivery, not automated submission.
- We store a local receipt when the OS share flow returns success or the user marks the action as sent.
- No screenshots, no form automation evidence.

---

## 5. Storage (GunDB)

### 5.1 Namespace Topology

| Path | Type | Description |
|------|------|-------------|
| `~<devicePub>/hermes/bridge/actions/<actionId>` | Auth | User's actions (non-PII metadata only) |
| `~<devicePub>/hermes/bridge/receipts/<receiptId>` | Auth | User's delivery receipts (non-PII) |
| `vh/bridge/stats/<repId>` | Public | Aggregate action counts (anonymous) |

### 5.2 Action Storage

```typescript
// Save action to Gun
async function saveAction(
  client: VennClient,
  action: LegislativeAction
): Promise<void> {
  const cleanAction = stripUndefined(stripPII(action));
  
  await new Promise<void>((resolve, reject) => {
    getUserActionsChain(client)
      .get(action.id)
      .put(cleanAction, (ack) => {
        if (ack?.err) reject(new Error(ack.err));
        else resolve();
      });
  });
}

// Save receipt
async function saveReceipt(
  client: VennClient,
  receipt: DeliveryReceipt
): Promise<void> {
  const cleanReceipt = stripUndefined(stripPII(receipt));
  
  await new Promise<void>((resolve, reject) => {
    getUserReceiptsChain(client)
      .get(receipt.id)
      .put(cleanReceipt, (ack) => {
        if (ack?.err) reject(new Error(ack.err));
        else resolve();
      });
  });
}
```

### 5.3 Aggregate Statistics

```typescript
// Increment action count for representative (anonymous)
async function incrementRepStats(
  client: VennClient,
  repId: string
): Promise<void> {
  const statsChain = getRepActionCountChain(client, repId);
  
  // Use Gun's built-in counter pattern
  statsChain.get('count').put(/* increment */);
  statsChain.get('lastActivity').put(Date.now());
}
```

---

## 6. Local Persistence

### 6.1 Storage Keys

| Key | Content |
|-----|---------|
| `vh_bridge_actions:<nullifier>` | Array of action IDs |
| `vh_bridge_receipts:<nullifier>` | Map of actionId → receiptId |
| `vh_bridge_reports:<nullifier>` | Map of reportId → local file path |
| `vh_bridge_profile:<nullifier>` | Encrypted user profile data |

### 6.2 User Profile Persistence (Local-Only)

```typescript
// Save user profile for future actions (local-only, encrypted)
async function saveUserProfile(nullifier: string, profile: UserProfile): Promise<void> {
  const encrypted = await encryptLocal(profile);
  await indexedDbSet(`vh_bridge_profile:${nullifier}`, encrypted);
}

// Load saved profile
async function loadUserProfile(nullifier: string): Promise<UserProfile | null> {
  const encrypted = await indexedDbGet(`vh_bridge_profile:${nullifier}`);
  return encrypted ? decryptLocal(encrypted) : null;
}
```

---

## 7. Trust & Verification

### 7.1 Trust Requirements

| Action | Required Trust Score | Additional Requirements |
|--------|---------------------|------------------------|
| View representatives | 0.5 | Valid RegionProof |
| Draft action | 0.5 | Valid RegionProof |
| Generate report | 0.7 | Valid RegionProof |
| Mark as sent | 0.7 | Valid RegionProof |

### 7.2 Constituency Verification

```typescript
function verifyConstituencyProof(
  action: LegislativeAction,
  representative: Representative
): VerificationResult {
  const { constituencyProof } = action;
  
  // 1. Verify nullifier matches author
  if (constituencyProof.nullifier !== action.author) {
    return { valid: false, error: 'nullifier_mismatch' };
  }
  
  // 2. Verify district hash matches representative
  if (constituencyProof.district_hash !== representative.districtHash) {
    return { valid: false, error: 'district_mismatch' };
  }
  
  // 3. Verify merkle root is recent (within 30 days)
  // This requires checking against a trusted merkle root list
  if (!isRecentMerkleRoot(constituencyProof.merkle_root)) {
    return { valid: false, error: 'stale_proof' };
  }
  
  return { valid: true };
}
```

---

## 8. UI & UX

### 8.1 Action Center Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  AGORA > Civic Action Kit                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Your Representatives (based on verified residency)             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 👤 Sen. Dianne Feinstein (D-CA)     [Write Letter]       │   │
│  │ 👤 Sen. Alex Padilla (D-CA)         [Write Letter]       │   │
│  │ 👤 Rep. Nancy Pelosi (D-CA-11)      [Write Letter]       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Recent Actions                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ✅ Climate Action Report to Sen. Feinstein (Dec 5)       │   │
│  │ 📝 Infrastructure Report to Rep. Pelosi (Draft)          │   │
│  │ 📨 Tax Policy Report to Sen. Padilla (Sent)              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Letter Composer

```
┌─────────────────────────────────────────────────────────────────┐
│  Write to Sen. Dianne Feinstein                          [Back] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Topic: [ Climate Change          ▼]                            │
│                                                                  │
│  Your Stance: ◉ Support  ○ Oppose  ○ Inform                    │
│                                                                  │
│  Subject:                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Support the Climate Action Now Act                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Your Message:                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Dear Senator Feinstein,                                   │   │
│  │                                                           │   │
│  │ As your constituent in San Francisco, I urge you to...    │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│  Characters: 247 / 5000                                         │
│                                                                  │
│  📋 Use Template   📄 Import from Doc   🔗 Link Forum Thread    │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Your Information (saved locally)                               │
│  Name: [John Doe        ]  Email: [john@example.com   ]         │
│  Address: [123 Main St  ]  City: [San Francisco]                │
│  State: [CA]  Zip: [94102]  Phone: [(415) 555-0123]            │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  [Save Draft]                          [Generate Report (PDF)]  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 Receipt Viewer

```
┌─────────────────────────────────────────────────────────────────┐
│  Delivery Receipt                                        [Close] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ Marked as Sent (User-Initiated)                              │
│                                                                  │
│  To: Sen. Dianne Feinstein                                      │
│  Subject: Support the Climate Action Now Act                    │
│  Sent: December 5, 2025 at 2:34 PM                              │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Delivery Method: Email                                          │
│  Report: climate-action-report.pdf                               │
│                                                                  │
│  [Open Report]                          [Change Delivery Method] │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.4 Templates

Pre-built templates for common topics:

```typescript
interface LetterTemplate {
  id: string;
  topic: string;
  stance: 'support' | 'oppose' | 'inform';
  subject: string;
  body: string;
  tags: string[];
}

const TEMPLATES: LetterTemplate[] = [
  {
    id: 'climate-support',
    topic: 'Climate Change',
    stance: 'support',
    subject: 'Support Climate Action Legislation',
    body: `Dear [REPRESENTATIVE],

As your constituent in [CITY], I am writing to urge your support for climate action legislation. [PERSONALIZE]

Climate change affects our community through [IMPACTS]. I believe we must act now to protect our future.

Thank you for your service and consideration.

Sincerely,
[NAME]`,
    tags: ['climate', 'environment']
  },
  // ... more templates
];
```

---

## 9. XP Integration

### 9.1 Civic Action XP (`civicXP`)

| Action | XP Reward | Cap |
|--------|-----------|-----|
| First letter to a representative | +3 `civicXP` | 1 per rep per week |
| Subsequent letters | +1 `civicXP` | 1 per rep per week |
| Elevate Forum thread to letter | +1 `civicXP` | 5 per week |

### 9.2 XP Emission

```typescript
function applyBridgeXP(event: BridgeXPEvent): void {
  const ledger = useXpLedger.getState();
  
  switch (event.type) {
    case 'letter_sent':
      const isFirst = !ledger.hasContactedRep(event.repId);
      const amount = isFirst ? 3 : 1;
      
      if (ledger.canAddBridgeXP(amount)) {
        ledger.addCivicXP(amount);
        ledger.markRepContacted(event.repId);
      }
      break;
      
    case 'thread_elevated':
      if (ledger.canAddElevationXP()) {
        ledger.addCivicXP(1);
        ledger.markElevation(event.threadId);
      }
      break;
  }
}
```

---

## 10. Implementation Checklist

### 10.1 Data Model
- [ ] Create `RepresentativeSchema` in `packages/data-model`
- [ ] Create `LegislativeActionSchema` in `packages/data-model`
- [ ] Create `DeliveryReceiptSchema` in `packages/data-model`
- [ ] Export types to `packages/types`
- [ ] Add schema validation tests

### 10.2 Representative Database
- [ ] Create `apps/web-pwa/src/data/representatives.json`
- [ ] Implement `findRepresentatives` lookup
- [ ] Add database update mechanism
- [ ] Add sample representatives for testing

### 10.3 Gun Adapters
- [ ] Create `packages/gun-client/src/bridgeAdapters.ts`
- [ ] Implement action/receipt storage (non-PII)
- [ ] Implement aggregate stats
- [ ] Add adapter tests

### 10.4 Store
- [ ] Implement `useBridgeStore` in `apps/web-pwa`
- [ ] Add hydration from Gun
- [ ] Add encrypted IndexedDB persistence
- [ ] Implement E2E mock store
- [ ] Add store tests

### 10.5 Report & Delivery
- [ ] Implement PDF report generator
- [ ] Add native intent integrations (mailto/tel/share/export)
- [ ] Implement delivery receipt creation (user-attested)
- [ ] Add contact directory UI + manual contact page open
- [ ] Add report storage + retrieval

### 10.6 UI
- [ ] Implement `BridgeLayout` component
- [ ] Implement `RepresentativeSelector` component
- [ ] Implement `ActionComposer` component
- [ ] Implement `ReceiptViewer` component
- [ ] Add letter templates
- [ ] Add accessibility tests

### 10.7 XP Integration
- [ ] Add `applyBridgeXP` to XP ledger
- [ ] Wire XP calls in store actions
- [ ] Add XP emission tests

---

## 11. Security Considerations

### 11.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Spam/abuse | Rate limits, high trust threshold (0.7), constituency verification |
| Impersonation | Signature verification, constituency proof |
| Data export leakage | Explicit user action for share/export, local-only storage |
| Contact data drift | Scheduled data updates, versioned DB |
| PII exposure | Encrypted local profile storage, never sync PII |

### 11.2 Privacy Invariants

- User's personal info (address, phone) NEVER leaves the device except when the user initiates a send
- Constituency proof reveals district hash, NOT exact address
- Aggregate stats are anonymous (no nullifiers)
- Reports are local-only unless explicitly shared

---

## 12. Future Enhancements (v1+)

- **Mail clients:** Deep-link support for multiple mail apps
- **Batch sending:** Send to multiple representatives at once
- **Campaign support:** Pre-drafted campaigns users can join
- **Response tracking:** Detect and log representative responses
- **Impact dashboard:** Show aggregate community impact
- **International support:** Support for non-US legislators
- **Local assist (optional):** User-visible helper for contact-page navigation (no default automation)
