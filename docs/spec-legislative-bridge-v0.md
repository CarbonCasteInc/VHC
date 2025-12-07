# Sovereign Legislative Bridge Spec (v0)

**Version:** 0.1
**Status:** Draft — Sprint 4 Planning
**Context:** Automated delivery of verified constituent sentiment to legislators for TRINITY OS.

> **"We do not ask permission to speak. If APIs are blocked, we automate the delivery via headless browsers."**
> — System Architecture Prime Directive #5

---

## 1. Core Principles

1.  **Sovereign Delivery:** If APIs are blocked, we automate via headless browsers.
2.  **Verified Voice:** All actions require constituency proof (RegionProof) — you can only contact YOUR representatives.
3.  **Privacy-Preserving:** Nullifiers and ZK proofs prevent de-anonymization while proving residency.
4.  **Proof of Delivery:** Every submission generates a screenshot receipt as proof.
5.  **Human-in-the-Loop:** CAPTCHAs require user intervention; automation assists, not replaces.

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
  contactUrl: string;             // Official contact form URL
  contactMethod: 'form' | 'email' | 'both';
  email?: string;                 // Direct email if available
  
  // Form Automation
  formMapping: FormFieldMapping;  // Field ID → CSS selector mapping
  
  // Metadata
  photoUrl?: string;
  website?: string;
  socialHandles?: Record<string, string>;
  lastVerified: number;           // When form mapping was last verified
}

interface FormFieldMapping {
  // Standard fields
  firstName?: string;             // CSS selector
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  
  // Message fields
  subject?: string;
  topic?: string;                 // Dropdown selector
  message?: string;
  
  // Form submission
  submitButton: string;           // Submit button selector
  
  // Optional fields
  prefix?: string;                // Mr/Ms/Dr
  suffix?: string;
  addressLine2?: string;
  
  // CAPTCHA detection
  captchaSelector?: string;       // If present, requires human intervention
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
  subject: string;                // Email/form subject (≤ 200 chars)
  body: string;                   // Letter body (50-5000 chars)
  
  // User Info (for form filling)
  userData: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
  
  // Verification
  constituencyProof: ConstituencyProof;
  
  // State
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'captcha_required';
  
  // Source (optional)
  sourceDocId?: string;           // If drafted in HERMES Docs
  sourceThreadId?: string;        // If linked from Forum thread
  
  // Timestamps
  createdAt: number;
  queuedAt?: number;
  sentAt?: number;
  
  // Retry
  retryCount: number;
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
  status: 'pending' | 'success' | 'failed' | 'captcha_required';
  timestamp: number;
  
  // Proof
  screenshotHash?: string;        // SHA256 of screenshot PNG
  screenshotUrl?: string;         // MinIO URL (encrypted blob)
  
  // Debug (for failures)
  errorMessage?: string;
  errorCode?: string;             // e.g., 'TIMEOUT', 'CAPTCHA', 'FORM_CHANGED'
  pageUrl?: string;               // Final URL after submission
  
  // Retry metadata
  retryCount: number;
  previousReceiptId?: string;     // If this is a retry
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

## 4. Automation Engine

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         PWA (Web)                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 Action Center UI                         │    │
│  │   • Draft letter                                         │    │
│  │   • Queue for submission                                 │    │
│  │   • View receipts                                        │    │
│  └───────────────────────┬─────────────────────────────────┘    │
└──────────────────────────┼──────────────────────────────────────┘
                           │ IPC / Tauri Command
┌──────────────────────────▼──────────────────────────────────────┐
│                    Desktop App (Tauri)                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              AutomationRunner                            │    │
│  │   • Launch Playwright browser                            │    │
│  │   • Fill form fields                                     │    │
│  │   • Handle CAPTCHA (show to user)                       │    │
│  │   • Capture screenshot                                   │    │
│  │   • Return receipt                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │ OR (Mobile / Web-only fallback)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Home Guardian Node                             │
│   • Receives signed action payload                               │
│   • Verifies constituency proof                                  │
│   • Executes automation on user's behalf                        │
│   • Returns encrypted receipt                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Desktop Automation Flow

```typescript
interface AutomationResult {
  success: boolean;
  receipt: DeliveryReceipt;
  screenshot?: Buffer;
}

async function submitLegislativeAction(
  action: LegislativeAction,
  representative: Representative
): Promise<AutomationResult> {
  const browser = await chromium.launch({
    headless: false,  // User can see and intervene
    slowMo: 100       // Slow enough for user to follow
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  
  const page = await context.newPage();
  
  try {
    // 1. Navigate to contact form
    await page.goto(representative.contactUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // 2. Fill form fields
    await fillFormFields(page, action, representative.formMapping);
    
    // 3. Check for CAPTCHA
    if (representative.formMapping.captchaSelector) {
      const captcha = await page.$(representative.formMapping.captchaSelector);
      if (captcha) {
        // Notify user to solve CAPTCHA
        await notifyUserForCaptcha();
        await waitForCaptchaSolution(page, representative.formMapping.captchaSelector);
      }
    }
    
    // 4. Submit form
    await page.click(representative.formMapping.submitButton);
    
    // 5. Wait for navigation/confirmation
    await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
    
    // 6. Capture screenshot
    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'png'
    });
    
    // 7. Verify success (check for confirmation message)
    const success = await verifySubmissionSuccess(page);
    
    // 8. Generate receipt
    const receipt = createReceipt(action, success, screenshot);
    
    return { success, receipt, screenshot };
    
  } catch (error) {
    const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
    const receipt = createFailedReceipt(action, error, screenshot);
    return { success: false, receipt, screenshot };
    
  } finally {
    await browser.close();
  }
}
```

### 4.3 Form Filling

```typescript
async function fillFormFields(
  page: Page,
  action: LegislativeAction,
  mapping: FormFieldMapping
): Promise<void> {
  const { userData, subject, body, topic } = action;
  
  // Personal info
  if (mapping.firstName) await safeType(page, mapping.firstName, userData.firstName);
  if (mapping.lastName) await safeType(page, mapping.lastName, userData.lastName);
  if (mapping.email) await safeType(page, mapping.email, userData.email);
  if (mapping.phone && userData.phone) await safeType(page, mapping.phone, userData.phone);
  
  // Address
  if (mapping.address) await safeType(page, mapping.address, userData.address);
  if (mapping.city) await safeType(page, mapping.city, userData.city);
  if (mapping.state) await safeSelect(page, mapping.state, userData.state);
  if (mapping.zip) await safeType(page, mapping.zip, userData.zip);
  
  // Message
  if (mapping.topic) await safeSelect(page, mapping.topic, topic);
  if (mapping.subject) await safeType(page, mapping.subject, subject);
  if (mapping.message) await safeType(page, mapping.message, body);
}

async function safeType(page: Page, selector: string, value: string): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.fill(selector, value);
  } catch (error) {
    console.warn(`[vh:bridge] Field not found: ${selector}`);
    throw new FormFieldError(selector, 'not_found');
  }
}

async function safeSelect(page: Page, selector: string, value: string): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.selectOption(selector, value);
  } catch (error) {
    console.warn(`[vh:bridge] Select not found: ${selector}`);
    throw new FormFieldError(selector, 'not_found');
  }
}
```

### 4.4 CAPTCHA Handling

```typescript
async function waitForCaptchaSolution(
  page: Page,
  captchaSelector: string,
  timeout: number = 120000 // 2 minutes
): Promise<void> {
  // Show notification to user
  await showCaptchaNotification();
  
  // Focus the browser window
  await page.bringToFront();
  
  // Wait for CAPTCHA element to disappear (solved)
  // or for form to become submittable
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const captchaVisible = await page.$(captchaSelector);
    if (!captchaVisible) {
      // CAPTCHA solved
      hideCaptchaNotification();
      return;
    }
    
    // Check if we can submit (some CAPTCHAs don't disappear)
    const canSubmit = await checkFormSubmittable(page);
    if (canSubmit) {
      hideCaptchaNotification();
      return;
    }
    
    await page.waitForTimeout(1000);
  }
  
  throw new CaptchaTimeoutError();
}
```

### 4.5 Security Sandbox

```typescript
// Domain allowlist for automation
const ALLOWED_DOMAINS = [
  'senate.gov',
  'house.gov',
  'congress.gov',
  'governor.*.gov',
  '*.state.*.us',
  // Add more as needed
];

function isDomainAllowed(url: string): boolean {
  const hostname = new URL(url).hostname;
  return ALLOWED_DOMAINS.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(hostname);
  });
}

// Validate before automation
async function validateAction(action: LegislativeAction, rep: Representative): void {
  // Check domain is allowed
  if (!isDomainAllowed(rep.contactUrl)) {
    throw new SecurityError('Domain not in allowlist');
  }
  
  // Verify constituency proof matches representative's district
  if (action.constituencyProof.district_hash !== rep.districtHash) {
    throw new SecurityError('Constituency proof does not match representative district');
  }
  
  // Verify author matches nullifier in proof
  if (action.author !== action.constituencyProof.nullifier) {
    throw new SecurityError('Author does not match constituency proof');
  }
}
```

---

## 5. Storage (GunDB)

### 5.1 Namespace Topology

| Path | Type | Description |
|------|------|-------------|
| `~<devicePub>/hermes/bridge/actions/<actionId>` | Auth | User's actions (drafts + sent) |
| `~<devicePub>/hermes/bridge/receipts/<receiptId>` | Auth | User's delivery receipts |
| `vh/bridge/stats/<repId>` | Public | Aggregate action counts (anonymous) |

### 5.2 Action Storage

```typescript
// Save action to Gun
async function saveAction(
  client: VennClient,
  action: LegislativeAction
): Promise<void> {
  const cleanAction = stripUndefined(action);
  
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
  const cleanReceipt = stripUndefined(receipt);
  
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
| `vh_bridge_queue:<nullifier>` | Array of queued action IDs |
| `vh_bridge_userData:<nullifier>` | Saved user form data |

### 6.2 User Data Persistence

```typescript
// Save user data for future actions
function saveUserData(nullifier: string, userData: UserData): void {
  localStorage.setItem(
    `vh_bridge_userData:${nullifier}`,
    JSON.stringify(userData)
  );
}

// Load saved user data
function loadUserData(nullifier: string): UserData | null {
  const raw = localStorage.getItem(`vh_bridge_userData:${nullifier}`);
  return raw ? JSON.parse(raw) : null;
}
```

---

## 7. Trust & Verification

### 7.1 Trust Requirements

| Action | Required Trust Score | Additional Requirements |
|--------|---------------------|------------------------|
| View representatives | 0.5 | Valid RegionProof |
| Draft action | 0.5 | Valid RegionProof |
| Queue action | 0.7 | Valid RegionProof |
| Submit action | 0.7 | Valid RegionProof, Desktop app OR Guardian |

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
│  AGORA > Legislative Bridge                                      │
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
│  │ ✅ Climate Action Letter to Sen. Feinstein (Dec 5)       │   │
│  │ ⏳ Infrastructure Letter to Rep. Pelosi (Queued)         │   │
│  │ ❌ Tax Policy Letter to Sen. Padilla (Failed - Retry)    │   │
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
│  Your Information (saved for future letters)                    │
│  Name: [John Doe        ]  Email: [john@example.com   ]         │
│  Address: [123 Main St  ]  City: [San Francisco]                │
│  State: [CA]  Zip: [94102]  Phone: [(415) 555-0123]            │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  [Save Draft]                               [Queue for Sending]  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 Receipt Viewer

```
┌─────────────────────────────────────────────────────────────────┐
│  Delivery Receipt                                        [Close] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ Successfully Delivered                                       │
│                                                                  │
│  To: Sen. Dianne Feinstein                                      │
│  Subject: Support the Climate Action Now Act                    │
│  Sent: December 5, 2025 at 2:34 PM                              │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Screenshot Proof:                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                                                           │   │
│  │  [Screenshot of confirmation page]                        │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Screenshot Hash: a3f2b1c4d5e6...                               │
│                                                                  │
│  [Download Screenshot]                          [View Full Size] │
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

### 9.1 Bridge XP (`civicXP`)

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

## 10. Guardian Node Delegation

### 10.1 Delegation Flow (Mobile/Web Users)

For users without the desktop app:

```
User (Mobile/Web)                    Guardian Node
       │                                  │
       │  1. Sign action payload          │
       │─────────────────────────────────>│
       │                                  │
       │                                  │ 2. Verify signature
       │                                  │ 3. Verify constituency
       │                                  │ 4. Execute automation
       │                                  │ 5. Capture screenshot
       │                                  │
       │  6. Return encrypted receipt     │
       │<─────────────────────────────────│
       │                                  │
       │  7. Decrypt and display          │
       │                                  │
```

### 10.2 Delegation Protocol

```typescript
interface DelegatedAction {
  action: LegislativeAction;
  signature: string;              // SEA.sign(action, userDevicePair)
  userPub: string;                // For signature verification
  timestamp: number;
  
  // Optional: encrypted user data for form filling
  encryptedUserData?: string;     // SEA.encrypt(userData, sharedSecret)
}

interface DelegationResponse {
  receipt: DeliveryReceipt;
  encryptedScreenshot?: string;   // SEA.encrypt(screenshot, sharedSecret)
}

// Guardian verifies before execution
async function verifyDelegation(delegation: DelegatedAction): Promise<boolean> {
  // 1. Verify signature
  const valid = await SEA.verify(
    JSON.stringify(delegation.action),
    delegation.signature,
    delegation.userPub
  );
  if (!valid) return false;
  
  // 2. Verify constituency proof
  const rep = getRepresentative(delegation.action.representativeId);
  const proofValid = verifyConstituencyProof(delegation.action, rep);
  if (!proofValid.valid) return false;
  
  // 3. Check rate limits
  if (isRateLimited(delegation.action.author)) return false;
  
  return true;
}
```

---

## 11. Implementation Checklist

### 11.1 Data Model
- [ ] Create `RepresentativeSchema` in `packages/data-model`
- [ ] Create `LegislativeActionSchema` in `packages/data-model`
- [ ] Create `DeliveryReceiptSchema` in `packages/data-model`
- [ ] Export types to `packages/types`
- [ ] Add schema validation tests

### 11.2 Representative Database
- [ ] Create `apps/web-pwa/src/data/representatives.json`
- [ ] Implement `findRepresentatives` lookup
- [ ] Add database update mechanism
- [ ] Add sample representatives for testing

### 11.3 Gun Adapters
- [ ] Create `packages/gun-client/src/bridgeAdapters.ts`
- [ ] Implement action/receipt storage
- [ ] Implement aggregate stats
- [ ] Add adapter tests

### 11.4 Store
- [ ] Implement `useBridgeStore` in `apps/web-pwa`
- [ ] Add hydration from Gun
- [ ] Add localStorage persistence
- [ ] Implement E2E mock store
- [ ] Add store tests

### 11.5 Automation (Desktop)
- [ ] Set up Playwright in `apps/desktop`
- [ ] Implement `submitLegislativeAction` runner
- [ ] Implement CAPTCHA detection and handling
- [ ] Implement screenshot capture
- [ ] Add security sandbox
- [ ] Add automation tests (against mock server)

### 11.6 UI
- [ ] Implement `BridgeLayout` component
- [ ] Implement `RepresentativeSelector` component
- [ ] Implement `ActionComposer` component
- [ ] Implement `ReceiptViewer` component
- [ ] Add letter templates
- [ ] Add accessibility tests

### 11.7 Guardian Delegation
- [ ] Design delegation protocol
- [ ] Implement signature verification
- [ ] Implement rate limiting
- [ ] Add Guardian endpoint (services/guardian)

### 11.8 XP Integration
- [ ] Add `applyBridgeXP` to XP ledger
- [ ] Wire XP calls in store actions
- [ ] Add XP emission tests

---

## 12. Security Considerations

### 12.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Spam/abuse | Rate limits, high trust threshold (0.7), constituency verification |
| Impersonation | Signature verification, constituency proof |
| Form scraping | Domain allowlist, no external data collection |
| CAPTCHA farming | Human-in-the-loop only, no automated solving |
| Credential theft | User data encrypted, stored locally only |
| Guardian abuse | Signed payloads, audit logging |

### 12.2 Privacy Invariants

- User's personal info (address, phone) NEVER leaves the device except to fill forms
- Constituency proof reveals district hash, NOT exact address
- Aggregate stats are anonymous (no nullifiers)
- Screenshots stored encrypted, only user can decrypt

---

## 13. Future Enhancements (v1+)

- **Email fallback:** Direct email sending for reps without web forms
- **Batch sending:** Send to multiple representatives at once
- **Campaign support:** Pre-drafted campaigns users can join
- **Response tracking:** Detect and log representative responses
- **Impact dashboard:** Show aggregate community impact
- **International support:** Support for non-US legislators

