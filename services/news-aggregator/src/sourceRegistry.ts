/**
 * Starter-source domains for extraction allowlisting.
 *
 * Mirrors the starter slate in `packages/ai-engine/src/feedRegistry.ts`.
 */

export const STARTER_FEED_URLS = [
  'https://moxie.foxnews.com/google-publisher/latest.xml',
  'https://www.washingtontimes.com/rss/headlines/news/politics/',
  'https://thefederalist.com/feed/',
  'https://www.theguardian.com/us-news/rss',
  'https://www.huffpost.com/section/us-news/feed',
  'https://feeds.washingtonpost.com/rss/politics',
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml',
  'https://news.yahoo.com/rss/world',
] as const;

const DOMAIN_ALIASES: Record<string, readonly string[]> = {
  'moxie.foxnews.com': ['foxnews.com', 'www.foxnews.com'],
  'www.washingtontimes.com': ['washingtontimes.com'],
  'thefederalist.com': ['www.thefederalist.com'],
  'www.theguardian.com': ['theguardian.com'],
  'www.huffpost.com': ['huffpost.com', 'chaski.huffpost.com'],
  'feeds.washingtonpost.com': ['washingtonpost.com', 'www.washingtonpost.com'],
  'feeds.bbci.co.uk': ['bbc.com', 'www.bbc.com', 'bbc.co.uk', 'www.bbc.co.uk'],
  'news.yahoo.com': ['yahoo.com', 'www.yahoo.com'],
};

function toBaseDomain(hostname: string): string {
  const normalized = hostname.toLowerCase();
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }

  if (normalized.endsWith('.co.uk') && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

function parseDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.includes('://')) {
    return /^[a-z0-9.-]+$/.test(trimmed) ? trimmed : null;
  }

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function collectDomains(): Set<string> {
  const set = new Set<string>();

  for (const url of STARTER_FEED_URLS) {
    const host = new URL(url).hostname.toLowerCase();
    set.add(host);
    set.add(toBaseDomain(host));

    const aliases = DOMAIN_ALIASES[host];
    if (aliases) {
      for (const alias of aliases) {
        set.add(alias.toLowerCase());
      }
    }
  }

  return set;
}

const STARTER_SOURCE_DOMAIN_SET = collectDomains();

export const STARTER_SOURCE_DOMAINS: readonly string[] = Object.freeze(
  Array.from(STARTER_SOURCE_DOMAIN_SET).sort(),
);

export function getStarterSourceDomainAllowlist(): ReadonlySet<string> {
  return STARTER_SOURCE_DOMAIN_SET;
}

export function isSourceDomainAllowed(
  urlOrDomain: string,
  allowlist: ReadonlySet<string> = STARTER_SOURCE_DOMAIN_SET,
): boolean {
  const hostname = parseDomain(urlOrDomain);
  if (!hostname) {
    return false;
  }

  if (allowlist.has(hostname)) {
    return true;
  }

  return allowlist.has(toBaseDomain(hostname));
}

export const sourceRegistryInternal = {
  parseDomain,
  toBaseDomain,
};
