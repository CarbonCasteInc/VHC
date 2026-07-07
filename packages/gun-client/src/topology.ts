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

function containsPII(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.some((k) => {
    const lower = k.toLowerCase();
    if (['nullifier', 'district_hash', 'email', 'wallet', 'address'].some((pii) => lower.includes(pii))) {
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
