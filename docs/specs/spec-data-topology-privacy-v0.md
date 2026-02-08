# Data Topology and Privacy - Season 0 Spec

Version: 0.2
Status: Canonical (V2-first)

Defines data placement, mesh path conventions, and privacy constraints for Season 0.

## 1. Placement matrix

| Object class | On-device (authoritative) | Mesh public | Mesh encrypted | Chain | Cloud | Class |
|---|---|---|---|---|---|---|
| StoryBundle | local cache/index | `vh/news/stories/<storyId>` | optional | optional hash anchor | optional blob | Public |
| TopicDigest | local cache/index | `vh/topics/<topicId>/digests/<digestId>` | optional | - | - | Public-derived |
| TopicSynthesisV2 | local cache/index | `vh/topics/<topicId>/epochs/<epoch>/synthesis` | - | optional hash anchor | - | Public |
| Topic latest pointer | local cache/index | `vh/topics/<topicId>/latest` | - | - | - | Public |
| SentimentSignal event | local state | forbidden | `~<devicePub>/outbox/sentiment/<eventId>` | - | - | Sensitive |
| AggregateSentiment | local cache | `vh/aggregates/topics/<topicId>/epochs/<epoch>` | - | optional aggregate anchor | - | Public |
| Linked-social OAuth tokens | vault (encrypted) | forbidden | optional encrypted backup | - | - | Secret |
| Linked-social notification objects | vault + local cache | sanitized card projection only | optional encrypted backup | - | - | Sensitive |
| Docs drafts | vault/E2EE stores | forbidden | `~<devicePub>/docs/<docId>` encrypted | - | encrypted attachments | Sensitive |
| Published articles | local cache | `vh/topics/<topicId>/articles/<articleId>` | - | optional hash anchor | media blobs | Public |
| Elevation artifacts (BriefDoc/ProposalScaffold/TalkingPoints) | local authoritative | metadata only | encrypted artifact payload | - | optional export blob | Sensitive/Public-mixed |
| Civic forwarding receipts | local authoritative | aggregate counters only | optional encrypted backup | - | - | Sensitive |
| Representative directory data | local cache | `vh/civic/reps/<jurisdictionVersion>` | - | - | signed source snapshot | Public |

## 2. Canonical path conventions (V2)

Allowed public V2 namespaces:

- `vh/news/stories/*`
- `vh/topics/*/digests/*`
- `vh/topics/*/epochs/*`
- `vh/topics/*/articles/*`
- `vh/aggregates/topics/*`
- `vh/discovery/*`
- `vh/civic/reps/*`

Disallowed in public namespaces:

- OAuth tokens
- API keys and provider secrets
- raw identity artifacts (`nullifier`, private keys)
- raw constituency proofs
- per-user sentiment events
- local receipt payloads containing personal contact details

## 3. Sensitive data rules

1. Vault-only:
   - OAuth tokens
   - provider credentials
   - personal profile/contact data
   - identity key material
2. Event-level sentiment is never plaintext on public mesh.
3. No public object may contain both `district_hash` and a person-level identifier.
4. Docs draft content is encrypted at rest and in transit outside device boundaries.

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
4. Cohort threshold tests: block publication for undersized district cohorts.
