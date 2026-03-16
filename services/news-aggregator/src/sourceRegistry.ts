import { STARTER_FEED_SOURCES, type FeedSource } from '@vh/ai-engine';

/**
 * Starter-source domains for extraction allowlisting.
 *
 * Derives directly from the runtime starter slate so source admission does not
 * drift away from the feed surface actually being used by the app/runtime.
 */

export const STARTER_FEED_URLS = Object.freeze(
  STARTER_FEED_SOURCES.map((source) => source.rssUrl),
) as readonly string[];

const DOMAIN_ALIASES: Record<string, readonly string[]> = {
  'moxie.foxnews.com': ['foxnews.com', 'www.foxnews.com'],
  'nypost.com': ['www.nypost.com'],
  'thefederalist.com': ['www.thefederalist.com'],
  'www.theguardian.com': ['theguardian.com'],
  'www.huffpost.com': ['huffpost.com', 'chaski.huffpost.com'],
  'www.cbsnews.com': ['cbsnews.com'],
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

type FeedSourceLike = Pick<FeedSource, 'rssUrl'> | string;

function toFeedUrl(source: FeedSourceLike): string {
  return typeof source === 'string' ? source : source.rssUrl;
}

export function buildSourceDomainAllowlist(
  feedSources: readonly FeedSourceLike[] = STARTER_FEED_URLS,
): ReadonlySet<string> {
  const set = new Set<string>();

  for (const source of feedSources) {
    const url = toFeedUrl(source);
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

const STARTER_SOURCE_DOMAIN_SET = buildSourceDomainAllowlist();

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
  toFeedUrl,
  parseDomain,
  toBaseDomain,
};
