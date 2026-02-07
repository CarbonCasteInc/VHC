import { describe, expect, it } from 'vitest';
import {
  DelegationTierSchema,
  DelegationScopeSchema,
  TIER_SCOPES,
  FamiliarRecordSchema,
  DelegationGrantSchema,
  OnBehalfOfAssertionSchema,
  type DelegationScope
} from './delegation';
import {
  FamiliarRecordSchema as FamiliarRecordSchemaFromIndex,
  DelegationGrantSchema as DelegationGrantSchemaFromIndex,
  OnBehalfOfAssertionSchema as OnBehalfOfAssertionSchemaFromIndex,
  DelegationTierSchema as DelegationTierSchemaFromIndex,
  DelegationScopeSchema as DelegationScopeSchemaFromIndex,
  TIER_SCOPES as TIER_SCOPES_FROM_INDEX,
  type FamiliarRecord,
  type DelegationGrant,
  type OnBehalfOfAssertion,
  type DelegationTier,
  type DelegationScope as DelegationScopeFromIndex
} from './index';

describe('delegation schemas', () => {
  describe('DelegationTierSchema', () => {
    it("accepts 'suggest', 'act', 'high-impact' (AC-17)", () => {
      for (const tier of ['suggest', 'act', 'high-impact'] as const) {
        expect(() => DelegationTierSchema.parse(tier)).not.toThrow();
      }
    });

    it("rejects 'admin' (AC-18)", () => {
      expect(() => DelegationTierSchema.parse('admin')).toThrow();
    });

    it('rejects empty string (AC-18)', () => {
      expect(() => DelegationTierSchema.parse('')).toThrow();
    });

    it("rejects case-variant 'HIGH-IMPACT' (AC-18)", () => {
      expect(() => DelegationTierSchema.parse('HIGH-IMPACT')).toThrow();
    });
  });

  describe('DelegationScopeSchema', () => {
    it('accepts all 10 canonical scopes (AC-19)', () => {
      const scopes: DelegationScope[] = [
        'draft',
        'triage',
        'analyze',
        'post',
        'comment',
        'share',
        'moderate',
        'vote',
        'fund',
        'civic_action'
      ];

      for (const scope of scopes) {
        expect(() => DelegationScopeSchema.parse(scope)).not.toThrow();
      }
    });

    it("rejects 'destroy' (AC-20)", () => {
      expect(() => DelegationScopeSchema.parse('destroy')).toThrow();
    });

    it('rejects empty string (AC-20)', () => {
      expect(() => DelegationScopeSchema.parse('')).toThrow();
    });
  });

  describe('TIER_SCOPES', () => {
    it('has exactly 3 keys (AC-21)', () => {
      expect(Object.keys(TIER_SCOPES)).toHaveLength(3);
    });

    it("suggest tier = ['draft', 'triage'] (AC-23)", () => {
      expect(TIER_SCOPES.suggest).toEqual(['draft', 'triage']);
    });

    it("act tier = ['analyze', 'post', 'comment', 'share'] (AC-24)", () => {
      expect(TIER_SCOPES.act).toEqual(['analyze', 'post', 'comment', 'share']);
    });

    it("high-impact tier = ['moderate', 'vote', 'fund', 'civic_action'] (AC-25)", () => {
      expect(TIER_SCOPES['high-impact']).toEqual(['moderate', 'vote', 'fund', 'civic_action']);
    });

    it('every DelegationScope in exactly one tier (AC-22)', () => {
      const flattened = Object.values(TIER_SCOPES).flat();
      const canonicalScopes: DelegationScope[] = [
        'draft',
        'triage',
        'analyze',
        'post',
        'comment',
        'share',
        'moderate',
        'vote',
        'fund',
        'civic_action'
      ];

      expect(flattened).toHaveLength(canonicalScopes.length);
      expect(new Set(flattened).size).toBe(flattened.length);
      expect(new Set(flattened)).toEqual(new Set(canonicalScopes));
    });
  });

  describe('FamiliarRecordSchema', () => {
    it('parses valid record (AC-1)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-1',
          label: 'Helper Familiar',
          createdAt: 1700000000000,
          capabilityPreset: 'act'
        })
      ).not.toThrow();
    });

    it('parses with revokedAt present (AC-2)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-2',
          label: 'Revoked Familiar',
          createdAt: 1700000000000,
          revokedAt: 1700000000100,
          capabilityPreset: 'suggest'
        })
      ).not.toThrow();
    });

    it('parses with createdAt: 0 (AC-28)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-3',
          label: 'Epoch Familiar',
          createdAt: 0,
          capabilityPreset: 'high-impact'
        })
      ).not.toThrow();
    });

    it('rejects empty id (AC-3)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: '',
          label: 'Label',
          createdAt: 1,
          capabilityPreset: 'act'
        })
      ).toThrow();
    });

    it('rejects empty label (AC-4)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-4',
          label: '',
          createdAt: 1,
          capabilityPreset: 'act'
        })
      ).toThrow();
    });

    it('rejects label > 256 chars (AC-7)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-5',
          label: 'x'.repeat(257),
          createdAt: 1,
          capabilityPreset: 'act'
        })
      ).toThrow();
    });

    it("rejects invalid capabilityPreset 'admin' (AC-5)", () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-6',
          label: 'Label',
          createdAt: 1,
          capabilityPreset: 'admin'
        })
      ).toThrow();
    });

    it('rejects negative createdAt (AC-6)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-7',
          label: 'Label',
          createdAt: -1,
          capabilityPreset: 'suggest'
        })
      ).toThrow();
    });

    it('rejects non-integer createdAt (structural)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-8',
          label: 'Label',
          createdAt: 1.5,
          capabilityPreset: 'suggest'
        })
      ).toThrow();
    });

    it('rejects missing required fields (structural)', () => {
      expect(() =>
        FamiliarRecordSchema.parse({
          id: 'fam-9',
          label: 'Label',
          createdAt: 1
        })
      ).toThrow();
    });
  });

  describe('DelegationGrantSchema', () => {
    it('parses valid grant (AC-8)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          grantId: 'grant-1',
          principalNullifier: 'principal-1',
          familiarId: 'fam-1',
          scopes: ['draft', 'post'],
          issuedAt: 100,
          expiresAt: 200,
          signature: 'sig-1'
        })
      ).not.toThrow();
    });

    it('allows expiresAt < issuedAt (AC-13)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          grantId: 'grant-2',
          principalNullifier: 'principal-2',
          familiarId: 'fam-2',
          scopes: ['share'],
          issuedAt: 200,
          expiresAt: 100,
          signature: 'sig-2'
        })
      ).not.toThrow();
    });

    it('rejects empty scopes array (AC-9)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          grantId: 'grant-3',
          principalNullifier: 'principal-3',
          familiarId: 'fam-3',
          scopes: [],
          issuedAt: 100,
          expiresAt: 200,
          signature: 'sig-3'
        })
      ).toThrow();
    });

    it('rejects invalid scope in array (AC-10)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          grantId: 'grant-4',
          principalNullifier: 'principal-4',
          familiarId: 'fam-4',
          scopes: ['draft', 'destroy'],
          issuedAt: 100,
          expiresAt: 200,
          signature: 'sig-4'
        })
      ).toThrow();
    });

    it('rejects empty principalNullifier (AC-11)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          grantId: 'grant-5',
          principalNullifier: '',
          familiarId: 'fam-5',
          scopes: ['draft'],
          issuedAt: 100,
          expiresAt: 200,
          signature: 'sig-5'
        })
      ).toThrow();
    });

    it('rejects empty signature (AC-12)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          grantId: 'grant-6',
          principalNullifier: 'principal-6',
          familiarId: 'fam-6',
          scopes: ['draft'],
          issuedAt: 100,
          expiresAt: 200,
          signature: ''
        })
      ).toThrow();
    });

    it('rejects negative issuedAt (AC-14)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          grantId: 'grant-7',
          principalNullifier: 'principal-7',
          familiarId: 'fam-7',
          scopes: ['draft'],
          issuedAt: -100,
          expiresAt: 200,
          signature: 'sig-7'
        })
      ).toThrow();
    });

    it('rejects non-integer issuedAt (AC-29)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          grantId: 'grant-8',
          principalNullifier: 'principal-8',
          familiarId: 'fam-8',
          scopes: ['draft'],
          issuedAt: 10.5,
          expiresAt: 200,
          signature: 'sig-8'
        })
      ).toThrow();
    });

    it('rejects missing required fields (structural)', () => {
      expect(() =>
        DelegationGrantSchema.parse({
          principalNullifier: 'principal-9',
          familiarId: 'fam-9',
          scopes: ['draft'],
          issuedAt: 100,
          expiresAt: 200,
          signature: 'sig-9'
        })
      ).toThrow();
    });
  });

  describe('OnBehalfOfAssertionSchema', () => {
    it('parses valid assertion (AC-15)', () => {
      expect(() =>
        OnBehalfOfAssertionSchema.parse({
          principalNullifier: 'principal-1',
          familiarId: 'fam-1',
          grantId: 'grant-1',
          issuedAt: 100,
          signature: 'sig-1'
        })
      ).not.toThrow();
    });

    it('rejects missing grantId (AC-16)', () => {
      expect(() =>
        OnBehalfOfAssertionSchema.parse({
          principalNullifier: 'principal-2',
          familiarId: 'fam-2',
          issuedAt: 100,
          signature: 'sig-2'
        })
      ).toThrow();
    });

    it('rejects empty principalNullifier (structural)', () => {
      expect(() =>
        OnBehalfOfAssertionSchema.parse({
          principalNullifier: '',
          familiarId: 'fam-3',
          grantId: 'grant-3',
          issuedAt: 100,
          signature: 'sig-3'
        })
      ).toThrow();
    });

    it('rejects empty familiarId (structural)', () => {
      expect(() =>
        OnBehalfOfAssertionSchema.parse({
          principalNullifier: 'principal-4',
          familiarId: '',
          grantId: 'grant-4',
          issuedAt: 100,
          signature: 'sig-4'
        })
      ).toThrow();
    });

    it('rejects empty signature (structural)', () => {
      expect(() =>
        OnBehalfOfAssertionSchema.parse({
          principalNullifier: 'principal-5',
          familiarId: 'fam-5',
          grantId: 'grant-5',
          issuedAt: 100,
          signature: ''
        })
      ).toThrow();
    });

    it('rejects negative issuedAt (structural)', () => {
      expect(() =>
        OnBehalfOfAssertionSchema.parse({
          principalNullifier: 'principal-6',
          familiarId: 'fam-6',
          grantId: 'grant-6',
          issuedAt: -1,
          signature: 'sig-6'
        })
      ).toThrow();
    });
  });

  describe('re-exports from index', () => {
    it('all types and schemas importable from the package index (AC-26)', () => {
      const tier: DelegationTier = 'suggest';
      const scope: DelegationScopeFromIndex = 'draft';
      expect([tier, scope]).toEqual(['suggest', 'draft']);

      const familiar: FamiliarRecord = {
        id: 'fam-index',
        label: 'From index',
        createdAt: 1,
        capabilityPreset: 'act'
      };

      const grant: DelegationGrant = {
        grantId: 'grant-index',
        principalNullifier: 'principal-index',
        familiarId: 'fam-index',
        scopes: ['post'],
        issuedAt: 1,
        expiresAt: 2,
        signature: 'sig-index'
      };

      const assertion: OnBehalfOfAssertion = {
        principalNullifier: 'principal-index',
        familiarId: 'fam-index',
        grantId: 'grant-index',
        issuedAt: 1,
        signature: 'sig-index'
      };

      expect(() => DelegationTierSchemaFromIndex.parse('act')).not.toThrow();
      expect(() => DelegationScopeSchemaFromIndex.parse('post')).not.toThrow();
      expect(() => FamiliarRecordSchemaFromIndex.parse(familiar)).not.toThrow();
      expect(() => DelegationGrantSchemaFromIndex.parse(grant)).not.toThrow();
      expect(() => OnBehalfOfAssertionSchemaFromIndex.parse(assertion)).not.toThrow();
    });

    it('TIER_SCOPES importable from package index (AC-26)', () => {
      expect(TIER_SCOPES_FROM_INDEX).toEqual(TIER_SCOPES);
    });
  });
});
