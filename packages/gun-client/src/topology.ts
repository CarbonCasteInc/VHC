type Classification = 'public' | 'sensitive' | 'local';

export interface TopologyRule {
  pathPrefix: string;
  classification: Classification;
}

const DEFAULT_RULES: TopologyRule[] = [
  { pathPrefix: 'vh/public/', classification: 'public' },
  { pathPrefix: 'vh/sensitive/', classification: 'sensitive' },
  { pathPrefix: 'vh/local/', classification: 'local' },
  { pathPrefix: 'vh/user/', classification: 'local' },
  { pathPrefix: 'vh/directory/', classification: 'public' },
  // legacy namespaces
  { pathPrefix: 'vh/chat/', classification: 'sensitive' },
  { pathPrefix: 'vh/outbox/', classification: 'sensitive' },
  { pathPrefix: 'vh/analyses/', classification: 'public' },
  { pathPrefix: 'vh/aggregates/', classification: 'public' },
  { pathPrefix: 'vh/aggregates/topics/*/engagement/actors/*', classification: 'public' },
  { pathPrefix: 'vh/aggregates/topics/*/engagement/summary', classification: 'public' },
  { pathPrefix: 'vh/aggregates/topics/*/syntheses/*/epochs/*/voters/*', classification: 'public' },
  { pathPrefix: 'vh/aggregates/topics/*/syntheses/*/epochs/*/points/*', classification: 'public' },
  { pathPrefix: 'vh/aggregates/topics/*/districts/*/summary', classification: 'public' },
  // Wave 0 contract registrations
  { pathPrefix: 'vh/news/stories/', classification: 'public' },
  { pathPrefix: 'vh/news/stories/*', classification: 'public' },
  { pathPrefix: 'vh/news/stories/*/analysis/*', classification: 'public' },
  { pathPrefix: 'vh/news/stories/*/analysis_latest', classification: 'public' },
  { pathPrefix: 'vh/news/storylines/', classification: 'public' },
  { pathPrefix: 'vh/news/storylines/*', classification: 'public' },
  { pathPrefix: 'vh/news/index/latest/', classification: 'public' },
  { pathPrefix: 'vh/news/index/latest/*', classification: 'public' },
  { pathPrefix: 'vh/news/index/hot/', classification: 'public' },
  { pathPrefix: 'vh/news/index/hot/*', classification: 'public' },
  { pathPrefix: 'vh/news/runtime/lease/*', classification: 'public' },
  { pathPrefix: 'vh/news/removed/*', classification: 'public' },
  { pathPrefix: 'vh/news/reports/*', classification: 'public' },
  { pathPrefix: 'vh/news/reports/index/status/*', classification: 'public' },
  { pathPrefix: 'vh/topics/*/epochs/*/candidates/*', classification: 'public' },
  { pathPrefix: 'vh/topics/*/epochs/*/synthesis', classification: 'public' },
  { pathPrefix: 'vh/topics/*/latest', classification: 'public' },
  { pathPrefix: 'vh/topics/*/synthesis_corrections/*', classification: 'public' },
  { pathPrefix: 'vh/topics/*/digests/*', classification: 'public' },
  { pathPrefix: 'vh/topics/*/articles/*', classification: 'public' },
  { pathPrefix: 'vh/discovery/items/*', classification: 'public' },
  { pathPrefix: 'vh/discovery/index/*', classification: 'public' },
  { pathPrefix: 'vh/social/cards/*', classification: 'public' },
  { pathPrefix: 'vh/forum/nominations/*', classification: 'public' },
  { pathPrefix: 'vh/forum/elevation/*', classification: 'public' },
  { pathPrefix: 'vh/civic/reps/*', classification: 'public' },
  { pathPrefix: 'vh/bridge/stats/*', classification: 'public' },
  // HERMES messaging
  { pathPrefix: 'vh/hermes/inbox/', classification: 'sensitive' },
  { pathPrefix: '~*/hermes/outbox', classification: 'sensitive' },
  { pathPrefix: '~*/outbox/sentiment/*', classification: 'sensitive' },
  { pathPrefix: '~*/hermes/chats', classification: 'sensitive' },
  { pathPrefix: '~*/docs/*', classification: 'sensitive' },
  { pathPrefix: '~*/hermes/docs/*', classification: 'sensitive' },
  { pathPrefix: '~*/hermes/bridge/*', classification: 'sensitive' },
  { pathPrefix: '~*/hermes/docKeys/*', classification: 'sensitive' },
  // Forum
  { pathPrefix: 'vh/forum/threads/', classification: 'public' },
  { pathPrefix: 'vh/forum/threads/*/comment_moderations/*', classification: 'public' },
  { pathPrefix: 'vh/forum/indexes/', classification: 'public' }
];

// Account-provider identity/token material (Apple/Google/X sign-in) plus raw
// region codes. Vault/local-only per spec-data-topology-privacy-v0 §3 — never
// allowed in public mesh records. Matched on the separator-stripped lowercase
// key so camelCase and snake_case forms are both rejected.
const FORBIDDEN_ACCOUNT_PROVIDER_KEYS = new Set([
  'providersubject',
  'provideraccountid',
  'providerlabel',
  'displaylabel',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'clientsecret',
  'applesub',
  'googlesub',
  'xsub',
  'accountbinding',
  'regioncode',
]);

// k-anonymity floor for public records carrying district_hash
// (spec-luma-service-v0 §9.4, MIN_DISTRICT_COHORT_SIZE).
const MIN_DISTRICT_COHORT_SIZE = 100;

function normalizedKey(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase();
}

// Person-level identifiers that must never be co-published with district_hash.
// Mirrors check-public-namespace-leaks.mjs isPersonIdentifierKey EXACTLY —
// forumAuthorId and identityDirectoryKey are district-linkable re-identification
// vectors and must be rejected at any nesting depth.
function isPersonIdentifierKey(key: string): boolean {
  return [
    'author',
    'publicauthor',
    'reporterid',
    'nominatorauthorid',
    'nominatornullifier',
    'principalnullifier',
    'nullifier',
    'voterid',
    'forumauthorid',
    'identitydirectorykey',
  ].includes(normalizedKey(key));
}

// Sensitive keys forbidden on any public record. Mirrors
// check-public-namespace-leaks.mjs isForbiddenSensitiveKey EXACTLY.
function isForbiddenSensitiveKey(key: string): boolean {
  return [
    'nullifier',
    'principalnullifier',
    'nominatornullifier',
    'reporternullifier',
    'constituencyproof',
    'merkleroot',
    'proofref',
    'intentid',
    'privatekey',
    'privatekeyhex',
    'epriv',
    'priv',
    'regioncode',
  ].includes(normalizedKey(key));
}

// Account-provider identity/token material as a normalized-key predicate,
// reusing the same set as the top-level containsPII check so the deep
// district-aggregate scan matches it (mirrors the lint's isAccountProviderKey).
function isAccountProviderKey(key: string): boolean {
  return FORBIDDEN_ACCOUNT_PROVIDER_KEYS.has(normalizedKey(key));
}

// Free-text PII substrings (email/wallet/address) matched the same way the
// top-level containsPII check matches them, but applied at any nesting depth
// inside the district-aggregate carve-out.
function isFreeTextPiiKey(key: string): boolean {
  const lower = key.toLowerCase();
  return ['email', 'wallet', 'address'].some((pii) => lower.includes(pii));
}

function collectKeysDeep(value: unknown, out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const entry of value) collectKeysDeep(entry, out);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.push(key);
    collectKeysDeep(child, out);
  }
  return out;
}

function containsDistrictHashKey(keys: readonly string[]): boolean {
  return keys.some((k) => normalizedKey(k) === 'districthash');
}

// The single allow-listed public class that may carry district_hash: aggregate
// cohort records under vh/aggregates/**/districts/<hash>/<record>, mirroring
// check-public-namespace-leaks.mjs isAggregateCohortPath.
function isAggregateCohortPath(path: string): boolean {
  return (
    /^vh\/aggregates\/.+\/districts\/[^/]+\/[^/]+\/?$/.test(path)
    || path.startsWith('vh/bridge/stats/')
  );
}

// The union of every forbidden-key class the lint rejects on a public record,
// evaluated at ANY nesting depth. This is the independent second privacy layer:
// the district-aggregate carve-out must match check-public-namespace-leaks.mjs
// exactly, since a future writer could reach a districts/*/summary-shaped chain
// without the strict Zod schema that backstops the sanctioned writer path.
function isForbiddenDistrictAggregateKey(key: string): boolean {
  return (
    isPersonIdentifierKey(key)
    || isForbiddenSensitiveKey(key)
    || isAccountProviderKey(key)
    || isFreeTextPiiKey(key)
  );
}

/**
 * Validate a public payload that carries district_hash.
 *
 * Fail-closed rule (spec-luma-service-v0 §9.4): a record containing
 * district_hash is permitted ONLY when it targets an allow-listed aggregate
 * cohort path AND declares an integer cohortSize >= MIN_DISTRICT_COHORT_SIZE AND
 * carries no person-identifier / sensitive / account-provider / free-text-PII
 * key at ANY nesting depth. This is the runtime mirror of the
 * check-public-namespace-leaks.mjs lint (defense-in-depth second layer);
 * district_hash stays unconditionally rejected everywhere else.
 */
function validateDistrictAggregatePayload(path: string, data: unknown): void {
  if (!isAggregateCohortPath(path)) {
    throw new Error(`Topology violation: non-aggregate public record carries district_hash at ${path}`);
  }
  // Match the schema/lint intent: reject a non-integer cohortSize on the raw
  // value before any Number() coercion (e.g. the string "100" is not accepted).
  const rawCohortSize = isRecord(data) ? (data as Record<string, unknown>).cohortSize : undefined;
  if (typeof rawCohortSize !== 'number' || !Number.isInteger(rawCohortSize) || rawCohortSize < MIN_DISTRICT_COHORT_SIZE) {
    throw new Error(
      `Topology violation: district_hash aggregate at ${path} requires integer cohortSize >= ${MIN_DISTRICT_COHORT_SIZE}`,
    );
  }
  // One deep scan over the union of forbidden key classes at any depth.
  const forbiddenKey = collectKeysDeep(data).find((k) => isForbiddenDistrictAggregateKey(k));
  if (forbiddenKey) {
    throw new Error(
      `Topology violation: district_hash aggregate at ${path} carries a forbidden key (${forbiddenKey})`,
    );
  }
}

// Unconditional public-path PII (never allowed regardless of path). district_hash
// is intentionally excluded here — it is handled by the k-anonymity carve-out in
// validateWrite so allow-listed aggregate records can publish it.
function containsPII(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.some((k) => {
    const lower = k.toLowerCase();
    if (['nullifier', 'email', 'wallet', 'address'].some((pii) => lower.includes(pii))) {
      return true;
    }
    return FORBIDDEN_ACCOUNT_PROVIDER_KEYS.has(lower.replace(/[-_]/g, ''));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function matchesRule(path: string, rule: TopologyRule): boolean {
  if (!rule.pathPrefix.includes('*')) {
    return path.startsWith(rule.pathPrefix);
  }
  const escaped = rule.pathPrefix
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]+');
  const regex = new RegExp(`^${escaped}`);
  return regex.test(path);
}

function isSentimentOutboxPath(path: string): boolean {
  return matchesRule(path, { pathPrefix: '~*/outbox/sentiment/*', classification: 'sensitive' });
}

function validateSentimentOutboxEnvelope(path: string, data: unknown): void {
  if (!isRecord(data) || typeof data.ciphertext !== 'string' || data.ciphertext.length === 0) {
    throw new Error(`Topology violation: sentiment outbox requires ciphertext at ${path}`);
  }

  if (
    data.schemaVersion !== 'sentiment-outbox-envelope-v1'
    || data._protocolVersion !== 'luma-sensitive-v1'
    || data.topologyClass !== 'sensitive-encrypted-outbox'
  ) {
    throw new Error(`Topology violation: sentiment outbox requires v1 sensitive envelope metadata at ${path}`);
  }

  if ('_writerKind' in data || '_authorScheme' in data || 'signedWriteEnvelope' in data) {
    throw new Error(`Topology violation: sentiment outbox must not carry public LUMA write fields at ${path}`);
  }
}

export class TopologyGuard {
  private rules: TopologyRule[];

  constructor(rules: TopologyRule[] = DEFAULT_RULES) {
    this.rules = rules;
  }

  validateWrite(path: string, data: unknown): void {
    const rule = this.rules.find((r) => matchesRule(path, r));
    if (!rule) {
      throw new Error(`Topology violation: disallowed path ${path}`);
    }
    if (rule.classification === 'public') {
      if (containsPII(data)) {
        throw new Error(`Topology violation: PII in public path ${path}`);
      }
      // Single deep traversal reused by the district-hash carve-out trigger
      // and the account-provider deep scan below (hot write path — collect
      // keys once).
      const deepKeys = collectKeysDeep(data);
      // district_hash is fail-closed everywhere except allow-listed aggregate
      // cohort records that meet the §9.4 k-anonymity floor and carry no
      // person-level identifier.
      if (containsDistrictHashKey(deepKeys)) {
        validateDistrictAggregatePayload(path, data);
      }
      // Account-provider identity/token material is rejected at ANY nesting
      // depth on every public path — containsPII above inspects top-level
      // keys only. Ordered AFTER containsPII and AFTER the district
      // carve-out so every existing error-message expectation is preserved
      // (nested provider tokens alongside district_hash still report
      // "carries a forbidden key"; top-level provider keys still report
      // "PII in public path").
      const deepProviderKey = deepKeys.find(isAccountProviderKey);
      if (deepProviderKey !== undefined) {
        throw new Error(
          `Topology violation: account-provider key (${deepProviderKey}) at any depth in public path ${path}`,
        );
      }
    }
    if (rule.classification === 'sensitive') {
      // Expect payload to be encrypted/encapsulated
      if (!data || typeof data !== 'object' || !(data as Record<string, unknown>).__encrypted) {
        throw new Error(`Topology violation: sensitive write without encryption flag at ${path}`);
      }
      if (isSentimentOutboxPath(path)) {
        validateSentimentOutboxEnvelope(path, data);
      }
    }
    // local requires no sync; guard not enforced here because writes are in-app only
  }
}
