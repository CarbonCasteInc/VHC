# Data Topology and Privacy - Season 0 Spec

> Status: Normative Spec
> Owner: VHC Spec Owners
> Last Reviewed: 2026-05-04
> Depends On: docs/foundational/System_Architecture.md, docs/CANON_MAP.md, docs/specs/spec-luma-service-v0.md, docs/specs/spec-mesh-production-readiness.md, docs/specs/spec-signed-pin-custody-v0.md


Version: 0.6
Status: Canonical (V2-first)

Defines data placement, mesh path conventions, and privacy constraints for Season 0.

## 1. Placement matrix

| Object class | On-device (authoritative) | Mesh public | Mesh encrypted | Chain | Cloud | Class |
|---|---|---|---|---|---|---|
| StoryBundle | local cache/index | `vh/news/stories/<storyId>` | optional | optional hash anchor | optional blob | Public |
| TopicDigest | local cache/index | `vh/topics/<topicId>/digests/<digestId>` | optional | - | - | Public-derived |
| TopicSynthesisV2 | local cache/index | `vh/topics/<topicId>/epochs/<epoch>/synthesis` | - | optional hash anchor | - | Public |
| TopicSynthesisCorrection | local cache/index | `vh/topics/<topicId>/synthesis_corrections/*` | - | optional hash anchor | - | Public audit |
| Topic latest pointer | local cache/index | `vh/topics/<topicId>/latest` | - | - | - | Public |
| HermesNewsReport | local cache/operator queue | `vh/news/reports/*` and `vh/news/reports/index/status/*` | - | - | - | Public workflow/audit |
| SentimentSignal event | local state | forbidden | `~<devicePub>/outbox/sentiment/<eventId>` | - | - | Sensitive |
| AggregateSentiment (legacy summary) | local cache | compatibility-only; canonical public point aggregates use `PointAggregateSnapshotV1` below | - | optional aggregate anchor | - | Public |
| TopicEngagementAggregateV1 | local cache | `vh/aggregates/topics/<topicId>/engagement/summary` | - | optional aggregate anchor | - | Public |
| Linked-social OAuth tokens | vault (encrypted) | forbidden | optional encrypted backup | - | - | Secret |
| Linked-social notification objects | vault + local cache | sanitized card projection only | optional encrypted backup | - | - | Sensitive |
| Docs drafts | vault/E2EE stores | forbidden | `~<devicePub>/docs/<docId>` encrypted | - | encrypted attachments | Sensitive |
| Published articles | local cache | `vh/topics/<topicId>/articles/<articleId>` | - | optional hash anchor | media blobs | Public |
| Elevation artifacts (BriefDoc/ProposalScaffold/TalkingPoints) | local authoritative | metadata only | encrypted artifact payload | - | optional export blob | Sensitive/Public-mixed |
| Civic forwarding receipts | local authoritative | aggregate counters only | optional encrypted backup | - | - | Sensitive |
| Representative directory data | local cache | `vh/civic/reps/<jurisdictionVersion>` | - | - | signed source snapshot | Public |
| PointAggregateSnapshotV1 | local cache | `vh/aggregates/topics/<topicId>/syntheses/<synthesisId>/epochs/<epoch>/points/<pointId>` | - | optional hash anchor | - | Public |
| VoteIntentRecord | local durable queue | forbidden | optional encrypted backup | - | - | Sensitive |
| VoteAdmissionReceipt | local state | forbidden | - | - | - | Internal |
| Hermes forum thread/comment/moderation | local cache/index | `vh/forum/*` including `comment_moderations/*` | - | optional hash anchor for public audit | - | Public/Public audit |

## 2. Canonical path conventions (V2)

Allowed public V2 namespaces:

- `vh/news/stories/*`
- `vh/news/reports/*`
- `vh/news/reports/index/status/*`
- `vh/topics/*/digests/*`
- `vh/topics/*/epochs/*`
- `vh/topics/*/articles/*`
- `vh/topics/*/synthesis_corrections/*`
- `vh/aggregates/topics/*`
- `vh/aggregates/topics/*/engagement/summary` (topic Eye/Lightbulb aggregate)
- `vh/aggregates/topics/*/engagement/actors/*` (Season 0 migration input; topic-scoped actor id only, no proof/nullifier payload)
- `vh/discovery/*`
- `vh/civic/reps/*`
- `vh/forum/*`
- `vh/aggregates/topics/*/syntheses/*/epochs/*/points/*` (PointAggregateSnapshotV1 delivery)
- `vh/__mesh_drills/<run_id>/*` (test-only; profile-scoped per §7.1; rejected by product readers)

Disallowed in public namespaces:

- OAuth tokens
- API keys and provider secrets
- raw identity artifacts (`nullifier`, private keys)
- raw constituency proofs
- per-user sentiment events
- local receipt payloads containing personal contact details

News report and moderation paths are public audit/workflow surfaces. They MUST
NOT include private contact information, raw identity artifacts, private proof
material, provider secrets, or personal support correspondence. `reporter_id`
and `operator_id` are public pseudonymous identifiers; product copy must not
present these records as a complete compliance, appeal, or case-management
system.

Public beta support requests are currently handled by the repository GitHub
Issue Form linked from `/support`, not by a private mesh support desk. Those
issues are public workflow records and MUST NOT request or include private
personal data, legal notices, raw identity/proof material, provider secrets,
confidential support correspondence, private abuse evidence, or full copyrighted
material. Deletion, copyright, abuse, or account matters that require private
details use a public-safe issue stub plus operator private handoff through the
pre-existing non-public beta contact channel or counsel path outside the public
GitHub issue body. Private handoff details MUST NOT be copied back into public
mesh, public GitHub issues, report records, moderation records, or public audit
records.

## 3. Sensitive data rules

1. Vault-only:
   - OAuth tokens
   - provider credentials
   - personal profile/contact data
   - identity key material
2. Event-level sentiment is never plaintext on public mesh.
3. No public object may contain both `district_hash` and a person-level identifier.
4. Non-aggregate public objects MUST NOT carry `district_hash` at all. Cohort
   size is meaningful only for aggregate/dashboard allow-listed paths.
5. Docs draft content is encrypted at rest and in transit outside device boundaries.
6. VoteIntentRecord objects (containing voter_id and proof_ref) are sensitive and MUST NOT appear on public mesh paths.
7. VoteAdmissionReceipt is internal client state only.

## 4. Linked-social storage rules

- OAuth tokens: vault-only, per provider.
- Notification objects: stored locally with platform metadata and minimal projection fields.
- Public feed cards may include non-sensitive preview fields only.
- Token refresh and revocation state are local security objects and never public.

## 5. Civic action and receipts

- Forwarding artifacts are generated locally.
- Native-intent actions (mailto/tel/share/export) produce local receipts.
- Public side may expose anonymous aggregate counters only (for example, actions per rep).

## 6. Guardian/aggregator boundaries

If encrypted outbox is used:

- payloads must be encrypted per recipient
- decrypted aggregate outputs must strip person-level identifiers
- dashboards may expose district-level aggregates only after cohort threshold checks

## 7. Test and lint invariants

1. Static lint: forbid public writes with sensitive keys (`token`, `nullifier`, `district_hash`+identifier pairs).
2. Runtime tests: ensure public synthesis/news/discovery objects pass redaction checks.
3. Contract tests: verify vault-only classes cannot resolve to `vh/*` public paths.
4. Cohort threshold tests: block publication for undersized district cohorts
   on aggregate/dashboard allow-listed paths. Non-aggregate public writes
   carrying `district_hash` reject regardless of declared `cohortSize`.
5. Static lint: enforce the protocol/schema reject matrix in
   `spec-mesh-production-readiness.md` §5.11 at the adapter boundary.
6. Static lint: drill records (records carrying `_drillWriterKind`) outside
   `vh/__mesh_drills/*` are hard-rejected.
7. Static lint: system-writer records (records carrying
   `_writerKind: 'system'`) outside the namespaces enumerated in §8 are
   hard-rejected.

### 7.1 Mesh drill test namespace rule

`vh/__mesh_drills/<run_id>/*` is the only sanctioned test namespace for
mesh drill writers. The full drill writer contract (record shape, signing
key, profile scope, cleanup) lives in `spec-mesh-production-readiness.md`
§5.9. The data-topology rules that apply here:

- Allowed only in mesh profiles `local_production_topology` and `e2e`. A
  `deployed_wss_topology` mesh profile MAY allow drill writes only when
  the LUMA profile is `dev` or `e2e`. Production LUMA profiles
  (`public-beta`, `production-attestation`) MUST reject drill writes at
  the relay level via origin/auth rules.
- Records under this namespace carry `_drillWriterKind: 'mesh-drill'` and
  `_drillSignature` (signed by the mesh drill signer key per
  `spec-signed-pin-custody-v0.md` §3). They do NOT carry LUMA
  `_writerKind` and do NOT carry `SignedWriteEnvelope`.
- Product readers under `apps/web-pwa/src/store/{news,forum,topics,
  aggregates,directory,civic}/**` MUST NOT subscribe to this namespace.
- Drill records have a bounded `_drillExpiresAt` TTL. Relay operators MAY
  compact this namespace at any time.
- Promotion of any drill record content into tracked evidence under
  `docs/reports/evidence/` MUST pass
  `pnpm check:mesh-evidence-scrub` per `spec-mesh-production-readiness.md`
  §5.7.1.

## 8. System writer key contract

`spec-luma-service-v0.md` §15 introduces three values for `_writerKind`:
`'luma'`, `'system'`, and `'legacy'`. This section defines the system
writer key contract that `'system'` records depend on. LUMA-aware readers
MUST accept records carrying `_writerKind: 'system'` only when a valid
system-writer pin exists for the current schema epoch and the §8.4 reader
rules pass. Records carrying `_writerKind: 'system'` but missing a valid pin
for the current schema epoch, or failing any §8.4 validation step, MUST be
rejected/quarantined and MUST NOT surface through product readers. Legacy
migration applies only to records missing `_writerKind` or explicitly carrying
`_writerKind: 'legacy'`.

The system writer key custody is owned by the cross-spec key-custody
manifest in `spec-signed-pin-custody-v0.md` §3. This section names the
allowed namespaces, allowed record classes, and signature shape.

### 8.1 Custody and key location

- The system writer key is generated and held by daemon and operator
  paths only. It MUST NOT be bundled into any browser build (tree-shake
  assertion required).
- The public component is pinned at build time per
  `spec-signed-pin-custody-v0.md` §3 (initial pin location: a file under
  `apps/web-pwa/src/luma/system-writer-pin.json`).
- The private component is held by the daemon process and operator
  signing utilities under the custody architecture documented by the LUMA
  verifier runbook (M2.A); for Season 0 the private component is held by
  the news daemon process only.

### 8.2 Allowed record classes

`_writerKind: 'system'` is allowed for these classes only:

| Record class | Owner spec | Path |
|---|---|---|
| News bundle / story | `spec-news-aggregator-v0.md` | `vh/news/stories/<storyId>` |
| Storyline | `spec-news-aggregator-v0.md` | (per news spec) |
| Synthesis latest pointer | `topic-synthesis-v2.md` | `vh/topics/<topicId>/latest` |
| Topic synthesis epoch | `topic-synthesis-v2.md` | `vh/topics/<topicId>/epochs/<epoch>/synthesis` |
| Topic digest | `topic-synthesis-v2.md` | `vh/topics/<topicId>/digests/<digestId>` |
| Discovery indexes | `spec-topic-discovery-ranking-v0.md` | `vh/discovery/*` |
| Civic representative directory snapshot | `spec-civic-action-kit-v0.md` | `vh/civic/reps/<jurisdictionVersion>` |

Forbidden uses:

- User-author writes (forum thread, forum comment, vote, directory
  publish, news report intake, civic forwarding receipts) — those go
  through `_writerKind: 'luma'` and `SignedWriteEnvelope`.
- Drill records — those use `_drillWriterKind: 'mesh-drill'` under
  `vh/__mesh_drills/*`.
- Any path under `vh/__mesh_drills/*`, `vh/forum/*` thread/comment
  payloads, `vh/aggregates/*` per-voter records, or `vh/directory/*`
  identity entries.

### 8.3 Signature shape

System-writer records MUST carry:

```ts
interface SystemWriterFields {
  _writerKind: 'system';
  _protocolVersion: string;          // matches LUMA public schema epoch
  _systemWriterId: string;           // pinned id corresponding to the
                                     // build-time pin
  _systemSignature: string;          // Ed25519 signature over
                                     // JCS-canonical(record \\ _systemSignature)
                                     // using the system writer private key
  _systemIssuedAt: number;
}
```

The signature suite is `jcs-ed25519-sha256-v1` per `spec-luma-service-v0.
md` §6.2. Constant-time discipline applies (LUMA §6.4).

### 8.4 Reader rules

- A reader MUST verify `_systemSignature` against the pinned public key
  identified by `_systemWriterId`. Verification failure rejects the
  record.
- A reader MUST refuse a `_writerKind: 'system'` record whose path is not
  in §8.2.
- A reader MUST NOT pass `_writerKind: 'system'` records through LUMA
  `canPerform` (LUMA §15).
- During the migration window, readers MAY also accept records on the
  same paths under `_writerKind: 'legacy'` and route through the
  migration adapter for that record class.

### 8.5 Rotation and compromise

Rotation cadence and compromise procedure are defined in
`spec-signed-pin-custody-v0.md` §5 and §6.5. Severity is P1: a forged
system-writer signature can publish forged news/synthesis state under the
canonical path. Response includes daemon pause, key rotation, audit of
recent writes, and a re-publication pass.

### 8.6 Cross-spec reference fix

`spec-luma-service-v0.md` §15 references this section as the canonical
source for the system writer key contract. M0.B implementation creates the
concrete system-writer pin for the active schema epoch. Until that pin exists,
LUMA-aware readers MUST reject/quarantine records carrying
`_writerKind: 'system'`. When the pin exists but §8.4 validation fails,
readers MUST also reject/quarantine the record and emit
`system-writer-validation-failed`. The legacy migration path is reserved for
records missing `_writerKind` or explicitly carrying `_writerKind: 'legacy'`.
