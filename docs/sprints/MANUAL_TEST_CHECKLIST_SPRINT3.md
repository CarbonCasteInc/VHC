# Sprint 3 Manual Test Checklist

**Date:** December 6, 2025  
**Sprint:** 3 - The Agora (HERMES Messaging + Forum)  
**Dev Server:** http://localhost:2048
**Status:** ✅ **SPRINT 3 COMPLETE** — All core functionality verified (Dec 6, 2025)

---

## ✅ RESOLVED GAPS (Phase 1 - Dec 4, 2025)

| Section | Gap | Resolution |
|---------|-----|------------|
| **2. Messaging** | No hydration on init — messages lost on reload | ✅ `hydrateFromGun()` implemented |
| **2. Messaging** | Invalid encryption keys — decryption fails | ✅ Real SEA `devicePair` in identity |
| **2. Messaging** | `subscribeToChannel` never called — no live updates | ✅ Wired in `ChatLayout` useEffect |
| **5. XP** | Two conflicting stores — UI never shows earned XP | ✅ Unified into `store/xpLedger.ts` |
| **7. Multi-Device** | No outbox subscription — cross-device sync broken | ✅ Subscribed in hydration |

## ✅ RESOLVED GAPS (Phase 2 - Dec 5, 2025)

| Section | Gap | Resolution |
|---------|-----|------------|
| **2. Messaging** | Gun path uses nullifier | ✅ Now uses `vh/hermes/inbox/${devicePub}` + authenticated user paths |
| **2. Messaging** | No directory service | ✅ `directoryAdapters.ts` — `lookupByNullifier`, `publishToDirectory` |
| **2. Messaging** | No Gun authentication | ✅ `authenticateGunUser()` on init, publishes to directory |
| **2. Messaging** | Chain wrapper missing `.on()` | ✅ Added `on`, `off`, `map` passthrough in `createGuardedChain` |
| **2. Messaging** | E2E test truncated contact | ✅ Added `contact-data` testid with full JSON |
| **2. Messaging** | Own messages won't decrypt | ✅ Fixed ECDH to use recipient's epub for own messages |

> **Manual Test Result (Dec 5, 2025):** ✅ Messages send and appear in recipient's browser across two incognito windows.

---

## ✅ RESOLVED GAPS (Phase 3 - Dec 5, 2025)

> **All messaging UX issues resolved. Manual tests passed.**

| Section | Gap | Resolution |
|---------|-----|------------|
| **2. Messaging** | Gun callback deduplication | ✅ TTL-based `seenMessages` Map with 60s expiry |
| **2. Messaging** | Channel persistence | ✅ `vh_channels:${nullifier}` localStorage + Gun hydration |
| **2. Messaging** | Contact persistence | ✅ `vh_contacts:${nullifier}` localStorage |
| **2. Messaging** | Debug logging | ✅ `vh_debug_chat` localStorage toggle |

**Manual Test Results (Dec 5, 2025):**
- ✅ Messages appear in both browsers (no "[Unable to decrypt]")
- ✅ No "1K+ records/sec" warning (deduplication working)
- ✅ Channel list shows conversation after refresh
- ✅ Can click into channel and see message history
- ✅ Don't need to re-add contact's identity key
- ✅ Messages deliver after page refresh

**Remaining (LOW Priority):**
| Section | Gap | Impact |
|---------|-----|--------|
| **2. Messaging** | Timeout stays `pending` | Misleading status after write timeout |
| **2. Messaging** | ChannelList shows ciphertext | Poor UX — should show decrypted preview |

---

## ✅ RESOLVED GAPS (Phase 4 — Forum, Dec 6, 2025)

> **All forum core functionality verified.**

| Section | Gap | Resolution |
|---------|-----|------------|
| **3. Forum** | No hydration on init | ✅ `hydrateFromGun()` with lazy retry |
| **3. Forum** | Gun `undefined` values | ✅ `stripUndefined()` helper |
| **3. Forum** | Gun `Array` values | ✅ `serializeThreadForGun()` / `parseThreadFromGun()` |
| **3. Forum** | Metadata filtering | ✅ Check required fields, strip `_` before parse |
| **3. Forum** | Thread persistence | ✅ Verified — threads survive refresh |
| **3. Forum** | Comment persistence | ✅ Verified — comments survive refresh |
| **3. Forum** | Cross-browser sync | ✅ Verified — threads/comments appear across browsers |
| **3. Forum** | Vote persistence | ✅ `vh_forum_votes:${nullifier}` localStorage |

**Remaining (LOW Priority / OPTIONAL):**
| Section | Gap | Impact |
|---------|-----|--------|
| **3. Forum** | VENN CTA dedup | Duplicate threads possible when linking from analysis |
| **3. Forum** | Low-trust identity testing | Cannot test TrustGate UI |
| **3. Forum** | Error UI in forms | No validation feedback for Zod errors |

---

## Prerequisites

### Environment Setup
- [ ] Docker stack running (`pnpm vh bootstrap up` or `./tools/scripts/manual-dev.sh up`)
- [ ] Dev server running at http://localhost:2048
- [ ] Two browser windows/profiles (for multi-user testing)

### Service Endpoints
| Service | URL | Status |
|---------|-----|--------|
| PWA Dev Server | http://localhost:2048 | [ ] Running |
| Gun Relay | ws://localhost:7777 | [ ] Running |
| Anvil RPC | http://localhost:8545 | [ ] Running |
| MinIO Console | http://localhost:9001 | [ ] Running |
| Traefik Dashboard | http://localhost:8081 | [ ] Running |

---

## Part 1: Identity & Session

### 1.1 Create Identity (User A - Window 1)
- [ ] Navigate to http://localhost:2048
- [ ] Click "User" link in header
- [ ] Verify dashboard shows "Create identity" option
- [ ] Enter username (e.g., "Alice")
- [ ] Click "Create Identity" / "Join"
- [ ] Verify welcome message appears with username
- [ ] Verify identity persists after page reload

### 1.2 Create Identity (User B - Window 2 / Incognito)
- [ ] Open new browser window (incognito/different profile)
- [ ] Navigate to http://localhost:2048
- [ ] Click "User" link
- [ ] Create identity with different username (e.g., "Bob")
- [ ] Verify separate identity created

### 1.3 Wallet & UBE
- [ ] On User A's dashboard, locate "Claim Daily Boost" / UBE button
- [ ] Click claim button
- [ ] Verify button becomes disabled after claim
- [ ] Verify "RVU Balance" displays

---

## Part 2: HERMES Messaging

> ❌ **BLOCKED (Phase 2 Required):**
> 
> **Completed:**
> - ✅ Hydration implemented — messages persist across reload
> - ✅ Real SEA keypair generated for sender `devicePair`
> - ✅ `subscribeToChannel` wired in `ChatLayout` with cleanup
> - ✅ Message signing with `id:timestamp:ciphertext` hash
> - ✅ Contact exchange shares `{ nullifier, epub }` JSON
> 
> **BLOCKING ISSUES:**
> 1. ❌ **Gun path architecture** — Paths use `~${nullifier}/...` but nullifiers aren't valid Gun SEA pubkeys
> 2. ❌ **No directory service** — Can't look up recipient's `devicePub` for message delivery
> 3. ❌ **No Gun authentication** — Need `gun.user().auth(devicePair)` on init
> 
> **Error:** `Unverified data` + `JWK "x" member 37 bytes but should be 32`
> 
> **Fix:** See `docs/sprints/03-sprint-3-the-agora.md` §2.4.0 for 16-task implementation plan including:
> - Directory service (§2.4.0.1-2)
> - Gun authentication (§2.4.0.5)
> - New path structure (§2.4.0.3-4)
> - Updated send/receive flow (§2.4.0.10-12)

### 2.1 Access Messaging
- [ ] Click "HERMES" in navigation
- [ ] Verify HERMES shell appears with "Messages" and "Forum" tabs
- [ ] Click "Messages" tab
- [ ] Verify messaging UI loads

### 2.2 Identity Gate
- [ ] If no identity exists, verify "Create identity to start messaging" gate appears
- [ ] After creating identity, verify chat UI is accessible

### 2.3 Contact QR Code (User A)
- [ ] In Messages view, locate "Your Contact QR" or identity key display
- [ ] Verify QR code is visible with `data-testid="contact-qr"`
- [ ] Verify identity key is displayed with `data-testid="identity-key"`
- [ ] Copy the identity key for User B to use

### 2.4 Start Chat (User B → User A)
- [ ] On User B's Messages view, locate "Add Contact" / "Scan Contact" option
- [ ] Paste User A's identity key in the input field (`data-testid="contact-key-input"`)
- [ ] Click "Start Chat" (`data-testid="start-chat-btn"`)
- [ ] Verify new channel appears in channel list

### 2.5 Send Message (User B)
- [ ] In the new channel, locate the message composer
- [ ] Type a test message: "Hello from Bob!"
- [ ] Click Send (`data-testid="send-message-btn"`)
- [ ] Verify message appears in thread
- [ ] Verify message shows "pending" → "sent" status transition

### 2.6 Receive Message (User A)
- [ ] On User A's window, navigate to Messages
- [ ] Verify new channel appears from User B
- [ ] Click on the channel
- [ ] Verify message "Hello from Bob!" appears (decrypted)

### 2.7 Reply (User A → User B)
- [ ] User A types reply: "Hi Bob, this is Alice!"
- [ ] Click Send
- [ ] On User B's window, verify reply appears

### 2.8 Message Persistence
- [ ] Reload User A's page
- [ ] Navigate back to Messages
- [ ] Verify chat history persists
- [ ] Verify messages are in correct order

### 2.9 Encryption Verification (Dev Tools)
- [ ] Open browser DevTools → Network tab
- [ ] Send a new message
- [ ] Inspect Gun websocket traffic
- [ ] Verify message content is encrypted (not plaintext)

---

## Part 3: HERMES Forum

> ⚠️ **BLOCKED:** Forum tests 3.2, 3.11 will fail due to:
> - No hydration on init (threads/comments lost on reload)
> - Cannot create low-trust identity to test TrustGate (3.2) — `createIdentity` throws error
> - Multi-user visibility (3.11) requires reload after other user posts, and even then data won't hydrate

### 3.1 Access Forum
- [ ] Click "Forum" tab in HERMES
- [ ] Verify forum feed loads

### 3.2 Trust Gate (Low Trust User)
- [ ] If `trustScore < 0.5`, verify trust gate message appears
- [ ] Verify "New Thread" button is disabled or shows gate
- [ ] Verify "Verify identity to participate" message (`data-testid="trust-gate-msg"`)

### 3.3 Create Thread (Trusted User)
- [ ] Ensure user has `trustScore >= 0.5` (via attestation)
- [ ] Click "New Thread" (`data-testid="new-thread-btn"`)
- [ ] Fill in title: "Sprint 3 Test Thread" (`data-testid="thread-title"`)
- [ ] Fill in content: "Testing the forum functionality for Sprint 3." (`data-testid="thread-content"`)
- [ ] Add tags: "test", "sprint3"
- [ ] Click Submit (`data-testid="submit-thread-btn"`)
- [ ] Verify thread appears in feed

### 3.4 View Thread
- [ ] Click on the created thread (`data-testid="thread-{id}"`)
- [ ] Verify thread view loads with title and content
- [ ] Verify author and timestamp are displayed

### 3.5 Add Comment
- [ ] In thread view, locate comment composer
- [ ] Type comment: "This is a test comment."
- [ ] Click Submit (`data-testid="submit-comment-btn"`)
- [ ] Verify comment appears below thread

### 3.6 Add Counterpoint
- [ ] On an existing comment, click "Counterpoint" option
- [ ] Type counterpoint: "I disagree because..."
- [ ] Submit counterpoint
- [ ] Verify counterpoint appears with distinct styling (side panel or highlighted)

### 3.7 Voting
- [ ] On a thread or comment, click upvote (`data-testid="vote-up-{id}"`)
- [ ] Verify vote count increases
- [ ] Click upvote again
- [ ] Verify vote is toggled/removed (one-vote-per-user)
- [ ] Click downvote (`data-testid="vote-down-{id}"`)
- [ ] Verify vote switches to downvote

### 3.8 Sorting
- [ ] In forum feed, select "Hot" sort
- [ ] Verify threads sorted by score (with decay)
- [ ] Select "New" sort
- [ ] Verify threads sorted by timestamp (newest first)
- [ ] Select "Top" sort
- [ ] Verify threads sorted by net votes (no decay)

### 3.9 Auto-Collapse
- [ ] Find or create a comment with negative score
- [ ] Verify comment is auto-collapsed
- [ ] Click to expand and verify content is readable

### 3.10 Markdown Rendering
- [ ] Create a thread/comment with markdown: `**bold** *italic* [link](http://example.com)`
- [ ] Verify markdown renders correctly
- [ ] Verify no XSS (try `<script>alert('xss')</script>`)

### 3.11 Multi-User Forum Visibility
- [ ] User A creates a thread
- [ ] User B navigates to Forum
- [ ] Verify User A's thread appears for User B
- [ ] User B adds a comment
- [ ] User A refreshes and sees User B's comment

---

## Part 4: VENN Integration

> ⚠️ **BLOCKED:** VENN → Forum CTA will not find existing threads:
> - `AnalysisView.tsx` has lookup logic, but `forumStore.threads` is always empty on reload
> - Will always create duplicate threads instead of navigating to existing

### 4.1 Analysis to Forum
- [ ] Navigate to VENN (home page)
- [ ] Run an analysis (click headline or "Analyze" button)
- [ ] Wait for analysis to complete
- [ ] Locate "Discuss in Forum" CTA
- [ ] Click "Discuss in Forum"
- [ ] Verify navigation to Forum with pre-filled thread linked to analysis

---

## Part 5: XP Verification

> ✅ **READY FOR TESTING (Phase 1 Complete):**
> - XP ledger unified into single `store/xpLedger.ts`
> - `hooks/useXpLedger.ts` deleted
> - WalletPanel, useGovernance, and all stores now use the unified ledger
> - XP earned from messaging/forum should now appear in UI

### 5.1 Check XP Dashboard
- [ ] Navigate to User dashboard
- [ ] Verify XP display shows `socialXP`, `civicXP`, `projectXP`

### 5.2 Messaging XP
- [ ] Send first message to a new contact
- [ ] Verify `socialXP` increases (first-contact bonus: +2)
- [ ] Send additional messages
- [ ] Verify daily cap is respected (max +5/day)

### 5.3 Forum XP
- [ ] Create a new thread
- [ ] Verify `civicXP` increases (thread creation: +2)
- [ ] Add a substantive comment (≥280 chars)
- [ ] Verify additional `civicXP` awarded

### 5.4 Quality Bonus
- [ ] Have another user upvote your thread to `netScore >= 3`
- [ ] Verify quality bonus XP awarded (+1 `civicXP`)

### 5.5 XP Persistence
- [ ] Reload page
- [ ] Verify XP values persist (stored in localStorage)

---

## Part 6: Edge Cases & Error Handling

> ⚠️ **BLOCKED:** Error handling tests will fail:
> - `ScanContact` accepts any string — no identity key validation (6.2)
> - `NewThreadForm` has no error state — Zod validation errors silently swallowed (6.3, 6.4)
> - Message timeout stays `pending` forever instead of showing `failed` (6.1)

### 6.1 Network Disconnect
- [ ] Open DevTools → Network → Offline
- [ ] Try to send a message
- [ ] Verify optimistic UI shows message
- [ ] Verify error handling (message shows "failed" status or retry option)
- [ ] Go back online
- [ ] Verify sync resumes

### 6.2 Invalid Identity Key
- [ ] Try to start chat with invalid key (e.g., "not-a-real-key")
- [ ] Verify appropriate error message

### 6.3 Empty Thread Submission
- [ ] Try to submit thread with empty title
- [ ] Verify validation prevents submission

### 6.4 Content Length Limits
- [ ] Try to create thread with title > 200 chars
- [ ] Verify validation or truncation
- [ ] Try to create content > 10,000 chars
- [ ] Verify validation or truncation

---

## Part 7: Multi-Device Sync (If Applicable)

> ✅ **PARTIALLY READY:**
> - Outbox subscription implemented — messages sent from other devices should sync
> - Device linking flow exists
> 
> ⚠️ **Note:** Cross-device sync depends on Gun relay being online and identity propagation

### 7.1 Device Linking
- [ ] On primary device, locate "Link Device" option
- [ ] On secondary device, scan QR or enter code
- [ ] Verify devices are linked

### 7.2 Cross-Device Message Sync
- [ ] Send message from Device A
- [ ] Verify message appears on Device B
- [ ] Send reply from Device B
- [ ] Verify reply appears on Device A

---

## Part 8: Performance & UX

### 8.1 Page Load
- [ ] Cold load of app < 3 seconds
- [ ] HERMES Messages loads without visible delay
- [ ] Forum feed loads without visible delay

### 8.2 Optimistic UI
- [ ] Sending message shows immediately (before sync)
- [ ] Creating thread shows immediately
- [ ] Voting updates immediately

### 8.3 Theme Toggle
- [ ] Click theme toggle in header
- [ ] Verify light/dark mode switches correctly
- [ ] Verify all HERMES components respect theme

---

## Test Results Summary

| Section | Passed | Failed | Notes |
|---------|--------|--------|-------|
| 1. Identity & Session | /3 | | |
| 2. HERMES Messaging | /9 | | |
| 3. HERMES Forum | /11 | | |
| 4. VENN Integration | /1 | | |
| 5. XP Verification | /5 | | |
| 6. Edge Cases | /4 | | |
| 7. Multi-Device Sync | /2 | | |
| 8. Performance & UX | /3 | | |
| **Total** | **/38** | | |

---

## Issues Found

| # | Severity | Section | Description | Steps to Reproduce |
|---|----------|---------|-------------|-------------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Tester | | | |
| Lead | | | |

---

## Commands Reference

```bash
# Start dev environment
./tools/scripts/manual-dev.sh up

# Stop dev environment
./tools/scripts/manual-dev.sh down

# Check Docker stack status
docker ps

# View PWA logs
tail -f /tmp/vh-pwa-dev.log

# Run E2E tests (for comparison)
pnpm test --filter @vh/e2e
```

