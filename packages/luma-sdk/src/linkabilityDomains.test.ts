import { describe, expect, it } from 'vitest';

import {
  createLinkabilityDomainRegistry,
  getLinkabilityDomain,
  INITIAL_LINKABILITY_DOMAINS,
  isRegisteredLinkabilityDomainName,
  LINKABILITY_DOMAIN_NAMES,
  LinkabilityDomainRegistryError,
  linkabilityDomainRegistry
} from './linkabilityDomains';

describe('LUMA linkability-domain registry', () => {
  it('exposes exactly the initial LUMA §9.3 domains', () => {
    expect(LINKABILITY_DOMAIN_NAMES).toEqual([
      'forum-author-v1',
      'identity-directory-v1',
      'voter-v1'
    ]);
    expect(linkabilityDomainRegistry.names).toEqual(LINKABILITY_DOMAIN_NAMES);
    expect(linkabilityDomainRegistry.domains).toEqual(INITIAL_LINKABILITY_DOMAINS);
  });

  it('preserves the §9.3 metadata for every initial domain', () => {
    expect(getLinkabilityDomain('forum-author-v1')).toEqual({
      name: 'forum-author-v1',
      scope: 'global',
      saltSource: 'none',
      info: 'vh:forum-author:v1',
      linkabilityProfile: 'global',
      publicVisibility: 'public-mesh',
      rotationPolicy: 'on-reset-identity',
      ownerSpec: 'spec-hermes-forum-v0.md'
    });
    expect(getLinkabilityDomain('identity-directory-v1')).toEqual({
      name: 'identity-directory-v1',
      scope: 'global',
      saltSource: 'none',
      info: 'vh:identity-directory:v1',
      linkabilityProfile: 'global',
      publicVisibility: 'public-mesh',
      rotationPolicy: 'on-reset-identity',
      ownerSpec: 'spec-luma-service-v0.md'
    });
    expect(getLinkabilityDomain('voter-v1')).toEqual({
      name: 'voter-v1',
      scope: 'topic-epoch-scoped',
      saltSource: 'topic-id+epoch',
      info: 'vh:voter:v1',
      linkabilityProfile: 'unlinkable-across-scope',
      publicVisibility: 'public-mesh',
      rotationPolicy: 'on-reset-identity',
      ownerSpec: 'spec-civic-sentiment.md'
    });
  });

  it('fails closed for unregistered domain lookup', () => {
    expect(() => getLinkabilityDomain('legacy-nullifier')).toThrow(LinkabilityDomainRegistryError);
    expect(isRegisteredLinkabilityDomainName('legacy-nullifier')).toBe(false);
  });

  it('fails closed on duplicate domain registration', () => {
    expect(() => createLinkabilityDomainRegistry([
      ...INITIAL_LINKABILITY_DOMAINS,
      {
        ...INITIAL_LINKABILITY_DOMAINS[0],
        info: 'vh:forum-author:v1-duplicate'
      }
    ])).toThrow(LinkabilityDomainRegistryError);
  });
});
