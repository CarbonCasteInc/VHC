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
  { pathPrefix: 'vh/aggregates/topics/*/syntheses/*/epochs/*/voters/*', classification: 'public' },
  // Wave 0 contract registrations
  { pathPrefix: 'vh/news/stories/*', classification: 'public' },
  { pathPrefix: 'vh/news/stories/*/analysis/*', classification: 'public' },
  { pathPrefix: 'vh/news/stories/*/analysis_latest', classification: 'public' },
  { pathPrefix: 'vh/news/index/latest/*', classification: 'public' },
  { pathPrefix: 'vh/news/removed/*', classification: 'public' },
  { pathPrefix: 'vh/topics/*/epochs/*/candidates/*', classification: 'public' },
  { pathPrefix: 'vh/topics/*/epochs/*/synthesis', classification: 'public' },
  { pathPrefix: 'vh/topics/*/latest', classification: 'public' },
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
  { pathPrefix: 'vh/forum/indexes/', classification: 'public' }
];

function containsPII(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.some((k) =>
    ['nullifier', 'district_hash', 'email', 'wallet', 'address'].some((pii) => k.toLowerCase().includes(pii))
  );
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
      const allowPII = rule.pathPrefix === 'vh/directory/';
      if (!allowPII && containsPII(data)) {
        throw new Error(`Topology violation: PII in public path ${path}`);
      }
    }
    if (rule.classification === 'sensitive') {
      // Expect payload to be encrypted/encapsulated
      if (!data || typeof data !== 'object' || !(data as Record<string, unknown>).__encrypted) {
        throw new Error(`Topology violation: sensitive write without encryption flag at ${path}`);
      }
    }
    // local requires no sync; guard not enforced here because writes are in-app only
  }
}
