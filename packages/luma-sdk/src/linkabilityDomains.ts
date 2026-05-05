export type LinkabilityScope =
  | 'global'
  | 'topic-scoped'
  | 'topic-epoch-scoped'
  | 'thread-scoped'
  | 'session-scoped';

export type LinkabilitySaltSource =
  | 'none'
  | 'topic-id'
  | 'topic-id+epoch'
  | 'thread-id'
  | 'session-id';

export type LinkabilityProfile = 'global' | 'scoped' | 'unlinkable-across-scope';
export type LinkabilityPublicVisibility = 'public-mesh' | 'sensitive' | 'local';
export type LinkabilityRotationPolicy = 'never' | 'on-reset-identity' | 'per-session';

export interface LinkabilityDomain {
  name: string;
  scope: LinkabilityScope;
  saltSource: LinkabilitySaltSource;
  info: string;
  linkabilityProfile: LinkabilityProfile;
  publicVisibility: LinkabilityPublicVisibility;
  rotationPolicy: LinkabilityRotationPolicy;
  ownerSpec: string;
}

export const INITIAL_LINKABILITY_DOMAINS = Object.freeze([
  Object.freeze({
    name: 'forum-author-v1',
    scope: 'global',
    saltSource: 'none',
    info: 'vh:forum-author:v1',
    linkabilityProfile: 'global',
    publicVisibility: 'public-mesh',
    rotationPolicy: 'on-reset-identity',
    ownerSpec: 'spec-hermes-forum-v0.md'
  }),
  Object.freeze({
    name: 'identity-directory-v1',
    scope: 'global',
    saltSource: 'none',
    info: 'vh:identity-directory:v1',
    linkabilityProfile: 'global',
    publicVisibility: 'public-mesh',
    rotationPolicy: 'on-reset-identity',
    ownerSpec: 'spec-luma-service-v0.md'
  }),
  Object.freeze({
    name: 'voter-v1',
    scope: 'topic-epoch-scoped',
    saltSource: 'topic-id+epoch',
    info: 'vh:voter:v1',
    linkabilityProfile: 'unlinkable-across-scope',
    publicVisibility: 'public-mesh',
    rotationPolicy: 'on-reset-identity',
    ownerSpec: 'spec-civic-sentiment.md'
  })
] as const satisfies readonly LinkabilityDomain[]);

export type LinkabilityDomainName = (typeof INITIAL_LINKABILITY_DOMAINS)[number]['name'];

export const LINKABILITY_DOMAIN_NAMES = Object.freeze(
  INITIAL_LINKABILITY_DOMAINS.map((domain) => domain.name)
) as readonly LinkabilityDomainName[];

type LinkabilityDomainMap = ReadonlyMap<LinkabilityDomainName, Readonly<LinkabilityDomain>>;

export interface LinkabilityDomainRegistry {
  domains: readonly Readonly<LinkabilityDomain>[];
  names: readonly LinkabilityDomainName[];
  get(name: string): Readonly<LinkabilityDomain>;
  has(name: string): name is LinkabilityDomainName;
}

export class LinkabilityDomainRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkabilityDomainRegistryError';
  }
}

export function createLinkabilityDomainRegistry(
  domains: readonly LinkabilityDomain[]
): LinkabilityDomainRegistry {
  const domainMap = new Map<LinkabilityDomainName, Readonly<LinkabilityDomain>>();

  for (const domain of domains) {
    if (domainMap.has(domain.name as LinkabilityDomainName)) {
      throw new LinkabilityDomainRegistryError(`Duplicate LUMA linkability domain: ${domain.name}`);
    }
    domainMap.set(domain.name as LinkabilityDomainName, Object.freeze({ ...domain }));
  }

  const names = Object.freeze(Array.from(domainMap.keys()));
  const domainList = Object.freeze(Array.from(domainMap.values()));
  const readonlyMap: LinkabilityDomainMap = domainMap;

  return Object.freeze({
    domains: domainList,
    names,
    get(name: string): Readonly<LinkabilityDomain> {
      const domain = readonlyMap.get(name as LinkabilityDomainName);
      if (!domain) {
        throw new LinkabilityDomainRegistryError(`Unregistered LUMA linkability domain: ${name}`);
      }
      return domain;
    },
    has(name: string): name is LinkabilityDomainName {
      return readonlyMap.has(name as LinkabilityDomainName);
    }
  });
}

export const linkabilityDomainRegistry = createLinkabilityDomainRegistry(INITIAL_LINKABILITY_DOMAINS);

export function getLinkabilityDomain(name: string): Readonly<LinkabilityDomain> {
  return linkabilityDomainRegistry.get(name);
}

export function isRegisteredLinkabilityDomainName(name: string): name is LinkabilityDomainName {
  return linkabilityDomainRegistry.has(name);
}
