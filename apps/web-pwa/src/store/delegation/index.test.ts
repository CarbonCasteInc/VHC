/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DelegationGrant } from '@vh/types';
import {
  createMockDelegationStore,
  delegationStorageKey,
  useDelegationStore,
  type DelegationGrantStatus
} from './index';
import {
  assertTimestamp,
  buildInitialState,
  createEmptyData,
  fromRevocationMap,
  isScopeAllowedForTier,
  isValidTimestamp,
  loadForPrincipal,
  parseRevocations,
  persistForPrincipal,
  randomId,
  toRevocationMap,
  validatePrincipalContext
} from './persistence';
import { clearPublishedIdentity, publishIdentity } from '../identityProvider';

const BASE_TIME = 1_700_000_000_000;

function setPrincipal(nullifier = 'principal-1') {
  publishIdentity({
    session: {
      nullifier,
      trustScore: 0.9,
      scaledTrustScore: 9000
    }
  });
  useDelegationStore.getState().hydrateFromIdentity();
}

function makeGrant(overrides: Partial<DelegationGrant> = {}): DelegationGrant {
  return {
    grantId: 'grant-1',
    principalNullifier: 'principal-1',
    familiarId: 'fam-1',
    scopes: ['draft'],
    issuedAt: BASE_TIME,
    expiresAt: BASE_TIME + 60_000,
    signature: 'sig-1',
    ...overrides
  };
}

describe('delegation persistence helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPublishedIdentity();
    useDelegationStore.getState().setActivePrincipal(null);
    vi.restoreAllMocks();
  });

  it('handles timestamp guards and principal validation helpers', () => {
    expect(isValidTimestamp(0)).toBe(true);
    expect(isValidTimestamp(-1)).toBe(false);
    expect(isValidTimestamp(1.2)).toBe(false);

    expect(() => assertTimestamp(-1, 'ts')).toThrow('ts must be a non-negative integer timestamp, got: -1');
    expect(() => validatePrincipalContext(null)).toThrow('No active principal set');
    expect(validatePrincipalContext('p-1')).toBe('p-1');
  });

  it('round-trips revocation maps and filters invalid values', () => {
    const parsed = parseRevocations({
      ok: BASE_TIME,
      '': BASE_TIME,
      nan: Number.NaN,
      text: 'nope'
    });
    expect(parsed).toEqual({ ok: BASE_TIME });
    expect(parseRevocations(null)).toEqual({});
    expect(parseRevocations([])).toEqual({});

    const map = toRevocationMap(parsed);
    expect(map.get('ok')).toBe(BASE_TIME);
    expect(fromRevocationMap(map)).toEqual({ ok: BASE_TIME });
  });

  it('generates ids with and without crypto.randomUUID', () => {
    const original = globalThis.crypto;

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => 'uuid-1' }
    });
    expect(randomId('x')).toBe('x-uuid-1');

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined
    });
    expect(randomId('x')).toMatch(/^x-\d+-/);

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: original
    });
  });

  it('loads empty state for null principal, missing key, and malformed payloads', () => {
    expect(loadForPrincipal(null)).toEqual(createEmptyData(null));

    expect(loadForPrincipal('p-1')).toEqual(createEmptyData('p-1'));

    localStorage.setItem(delegationStorageKey('p-1'), '{not-json');
    expect(loadForPrincipal('p-1')).toEqual(createEmptyData('p-1'));
  });

  it('loads only schema-valid familiars/grants and matching principal', () => {
    localStorage.setItem(
      delegationStorageKey('principal-1'),
      JSON.stringify({
        familiars: [
          { id: 'fam-1', label: 'Fam 1', createdAt: 1, capabilityPreset: 'suggest' },
          { id: '', label: 'invalid', createdAt: 1, capabilityPreset: 'suggest' }
        ],
        grants: [
          makeGrant({ grantId: 'g-valid', principalNullifier: 'principal-1' }),
          makeGrant({ grantId: 'g-other', principalNullifier: 'other-principal' }),
          { grantId: '', principalNullifier: 'principal-1' }
        ],
        revokedAtByGrantId: {
          'g-valid': BASE_TIME,
          bad: Number.NaN
        }
      })
    );

    const loaded = loadForPrincipal('principal-1');

    expect(Object.keys(loaded.familiarsById)).toEqual(['fam-1']);
    expect(Object.keys(loaded.grantsById)).toEqual(['g-valid']);
    expect(loaded.revokedAtByGrantId).toEqual({ 'g-valid': BASE_TIME });
  });

  it('treats non-array familiar/grant payloads as empty collections', () => {
    localStorage.setItem(
      delegationStorageKey('principal-non-arrays'),
      JSON.stringify({
        familiars: { bad: true },
        grants: { bad: true },
        revokedAtByGrantId: {}
      })
    );

    const loaded = loadForPrincipal('principal-non-arrays');
    expect(loaded.familiarsById).toEqual({});
    expect(loaded.grantsById).toEqual({});
  });

  it('persists serializable payloads and ignores serialization failures', () => {
    const state = {
      activePrincipal: 'principal-1',
      familiarsById: {
        'fam-1': {
          id: 'fam-1',
          label: 'Fam',
          createdAt: 1,
          capabilityPreset: 'suggest' as const
        }
      },
      grantsById: {
        'grant-1': makeGrant({ grantId: 'grant-1' })
      },
      revokedAtByGrantId: { 'grant-1': BASE_TIME }
    };

    persistForPrincipal(state);
    const raw = localStorage.getItem(delegationStorageKey('principal-1'));
    expect(raw).toBeTruthy();

    expect(() => persistForPrincipal({ ...state, activePrincipal: null })).not.toThrow();

    const circular: any = {
      activePrincipal: 'principal-1',
      familiarsById: {},
      grantsById: {},
      revokedAtByGrantId: {}
    };
    circular.familiarsById.self = circular;
    expect(() => persistForPrincipal(circular)).not.toThrow();
  });

  it('buildInitialState hydrates from published identity and storage', () => {
    localStorage.setItem(
      delegationStorageKey('principal-2'),
      JSON.stringify({
        familiars: [{ id: 'fam-2', label: 'Fam 2', createdAt: 2, capabilityPreset: 'act' }],
        grants: [makeGrant({ grantId: 'grant-2', principalNullifier: 'principal-2', familiarId: 'fam-2' })],
        revokedAtByGrantId: { 'grant-2': BASE_TIME }
      })
    );

    publishIdentity({
      session: {
        nullifier: 'principal-2',
        trustScore: 1,
        scaledTrustScore: 10_000
      }
    });

    const initial = buildInitialState();
    expect(initial.activePrincipal).toBe('principal-2');
    expect(initial.familiarsById['fam-2']?.label).toBe('Fam 2');
    expect(initial.grantsById['grant-2']?.grantId).toBe('grant-2');
  });

  it('validates tier scope helper', () => {
    expect(isScopeAllowedForTier('draft', 'suggest')).toBe(true);
    expect(isScopeAllowedForTier('moderate', 'act')).toBe(false);
  });
});

describe('useDelegationStore', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPublishedIdentity();
    useDelegationStore.getState().setActivePrincipal(null);
  });

  it('requires active principal for writes and hydrates from identity', () => {
    expect(() =>
      useDelegationStore.getState().registerFamiliar({
        id: 'fam-1',
        label: 'Fam',
        capabilityPreset: 'suggest'
      })
    ).toThrow('No active principal set');

    setPrincipal('principal-1');
    expect(useDelegationStore.getState().activePrincipal).toBe('principal-1');
  });

  it('registers familiars with explicit and generated fields, dedupes by id, and trims labels', () => {
    setPrincipal();
    const familiar = useDelegationStore.getState().registerFamiliar({
      id: 'fam-1',
      label: '  Familiar  ',
      createdAt: BASE_TIME,
      capabilityPreset: 'act'
    });

    expect(familiar.label).toBe('Familiar');
    expect(useDelegationStore.getState().familiarsById['fam-1']?.capabilityPreset).toBe('act');

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME + 42);
    const generated = useDelegationStore.getState().registerFamiliar({
      label: 'Generated',
      capabilityPreset: 'suggest'
    });
    nowSpy.mockRestore();

    expect(generated.id).toMatch(/^familiar-/);
    expect(generated.createdAt).toBe(BASE_TIME + 42);

    expect(() =>
      useDelegationStore.getState().registerFamiliar({
        id: 'fam-1',
        label: 'Duplicate',
        capabilityPreset: 'suggest'
      })
    ).toThrow('Familiar "fam-1" already exists');
  });

  it('issues grants with tier checks and principal consistency', () => {
    setPrincipal('principal-1');
    useDelegationStore.getState().registerFamiliar({
      id: 'fam-1',
      label: 'Fam',
      capabilityPreset: 'act',
      createdAt: BASE_TIME - 10
    });

    const issued = useDelegationStore.getState().issueGrant(
      makeGrant({
        grantId: 'grant-issued',
        scopes: ['post', 'post', 'comment'],
        issuedAt: BASE_TIME,
        expiresAt: BASE_TIME + 100
      }),
      { now: BASE_TIME }
    );

    expect(issued.scopes).toEqual(['post', 'comment']);

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME + 1);
    const issuedWithoutNow = useDelegationStore.getState().issueGrant(
      makeGrant({
        grantId: 'grant-default-now',
        scopes: ['post'],
        issuedAt: BASE_TIME + 1,
        expiresAt: BASE_TIME + 120
      })
    );
    nowSpy.mockRestore();
    expect(issuedWithoutNow.grantId).toBe('grant-default-now');

    expect(() =>
      useDelegationStore.getState().issueGrant(
        makeGrant({ grantId: 'grant-issued', issuedAt: BASE_TIME, expiresAt: BASE_TIME + 100 }),
        { now: BASE_TIME }
      )
    ).toThrow('Grant "grant-issued" already exists');

    expect(() =>
      useDelegationStore.getState().issueGrant(
        makeGrant({ grantId: 'mismatch', principalNullifier: 'other', issuedAt: BASE_TIME, expiresAt: BASE_TIME + 100 }),
        { now: BASE_TIME }
      )
    ).toThrow('Grant principal does not match active principal');

    expect(() =>
      useDelegationStore.getState().issueGrant(
        makeGrant({ grantId: 'missing-fam', familiarId: 'fam-missing', issuedAt: BASE_TIME, expiresAt: BASE_TIME + 100 }),
        { now: BASE_TIME }
      )
    ).toThrow('Familiar "fam-missing" not found');

    expect(() =>
      useDelegationStore.getState().issueGrant(
        makeGrant({ grantId: 'too-strong', scopes: ['moderate'], issuedAt: BASE_TIME, expiresAt: BASE_TIME + 100 }),
        { now: BASE_TIME }
      )
    ).toThrow('Scope "moderate" exceeds familiar tier "act"');
  });

  it('blocks issuing grant to revoked familiar', () => {
    setPrincipal();
    useDelegationStore.getState().registerFamiliar({
      id: 'fam-revoked',
      label: 'Revoked',
      createdAt: BASE_TIME,
      capabilityPreset: 'suggest'
    });
    useDelegationStore.getState().revokeFamiliar('fam-revoked', BASE_TIME + 5);

    expect(() =>
      useDelegationStore.getState().issueGrant(
        makeGrant({
          grantId: 'late-grant',
          familiarId: 'fam-revoked',
          issuedAt: BASE_TIME + 5,
          expiresAt: BASE_TIME + 100
        }),
        { now: BASE_TIME + 5 }
      )
    ).toThrow('Familiar "fam-revoked" is revoked');
  });

  it('revokeFamiliar validates inputs, handles no-op, and revokes its grants', () => {
    setPrincipal();
    useDelegationStore.getState().registerFamiliar({
      id: 'fam-1',
      label: 'Fam',
      createdAt: BASE_TIME,
      capabilityPreset: 'suggest'
    });

    const before = useDelegationStore.getState();
    expect(() => useDelegationStore.getState().revokeFamiliar('', BASE_TIME)).toThrow('familiarId must be a non-empty string');
    expect(() => useDelegationStore.getState().revokeFamiliar('fam-1', Number.NaN)).toThrow(
      'revokedAt must be a non-negative integer timestamp, got: NaN'
    );

    useDelegationStore.getState().revokeFamiliar('missing', BASE_TIME);
    expect(useDelegationStore.getState().familiarsById).toBe(before.familiarsById);

    useDelegationStore.getState().issueGrant(
      makeGrant({ grantId: 'grant-r1', familiarId: 'fam-1', issuedAt: BASE_TIME, expiresAt: BASE_TIME + 50 }),
      { now: BASE_TIME }
    );

    useDelegationStore.getState().revokeFamiliar('fam-1', BASE_TIME + 10);
    useDelegationStore.getState().revokeFamiliar('fam-1', BASE_TIME + 20);

    expect(useDelegationStore.getState().familiarsById['fam-1']?.revokedAt).toBe(BASE_TIME + 10);
    expect(useDelegationStore.getState().revokedAtByGrantId['grant-r1']).toBe(BASE_TIME + 10);
  });

  it('revokeGrantById enforces principal and keeps earliest timestamp', () => {
    useDelegationStore.getState().setActivePrincipal(null);
    expect(() => useDelegationStore.getState().revokeGrantById('grant', BASE_TIME)).toThrow('No active principal set');

    setPrincipal();
    useDelegationStore.getState().revokeGrantById('grant-1', BASE_TIME + 10);
    useDelegationStore.getState().revokeGrantById('grant-1', BASE_TIME + 20);
    useDelegationStore.getState().revokeGrantById('grant-1', BASE_TIME + 1);

    expect(useDelegationStore.getState().revokedAtByGrantId['grant-1']).toBe(BASE_TIME + 1);
  });

  it('evaluates permissions with lifecycle guards', () => {
    setPrincipal();
    useDelegationStore.getState().registerFamiliar({
      id: 'fam-1',
      label: 'Fam',
      createdAt: BASE_TIME,
      capabilityPreset: 'high-impact'
    });

    useDelegationStore.getState().issueGrant(
      makeGrant({ grantId: 'grant-live', scopes: ['moderate'], issuedAt: BASE_TIME, expiresAt: BASE_TIME + 100 }),
      { now: BASE_TIME }
    );

    expect(useDelegationStore.getState().canFamiliarPerform({ grantId: '', requiredScope: 'draft' })).toEqual({
      allowed: false,
      reason: 'grantId must be a non-empty string'
    });

    expect(
      useDelegationStore.getState().canFamiliarPerform({
        grantId: 'missing',
        requiredScope: 'draft'
      })
    ).toEqual({
      allowed: false,
      reason: 'grant "missing" not found'
    });

    useDelegationStore.setState((state) => ({
      ...state,
      activePrincipal: 'other-principal'
    }));
    expect(
      useDelegationStore.getState().canFamiliarPerform({
        grantId: 'grant-live',
        requiredScope: 'moderate',
        now: BASE_TIME
      })
    ).toEqual({
      allowed: false,
      reason: 'grant principal does not match active principal'
    });

    useDelegationStore.setState((state) => ({
      ...state,
      activePrincipal: 'principal-1'
    }));
    useDelegationStore.setState((state) => {
      const nextFamiliars = { ...state.familiarsById };
      delete nextFamiliars['fam-1'];
      return { ...state, familiarsById: nextFamiliars };
    });

    expect(
      useDelegationStore.getState().canFamiliarPerform({
        grantId: 'grant-live',
        requiredScope: 'moderate',
        now: BASE_TIME
      })
    ).toEqual({
      allowed: false,
      reason: 'familiar "fam-1" not found'
    });

    useDelegationStore.getState().registerFamiliar({
      id: 'fam-1',
      label: 'Fam',
      createdAt: BASE_TIME,
      capabilityPreset: 'high-impact'
    });

    expect(
      useDelegationStore.getState().canFamiliarPerform({
        grantId: 'grant-live',
        requiredScope: 'moderate',
        now: BASE_TIME + 1
      })
    ).toEqual({
      allowed: false,
      reason: 'high-impact scope requires explicit human approval'
    });

    const result = useDelegationStore.getState().canFamiliarPerform({
      grantId: 'grant-live',
      requiredScope: 'moderate',
      now: BASE_TIME + 2,
      actionTime: BASE_TIME + 2,
      assertion: {
        principalNullifier: 'principal-1',
        familiarId: 'fam-1',
        grantId: 'grant-live',
        issuedAt: BASE_TIME + 2,
        signature: 'assert'
      },
      highImpactApprovedAt: BASE_TIME + 2
    });
    expect(result).toEqual({ allowed: true });

    useDelegationStore.getState().revokeFamiliar('fam-1', BASE_TIME + 3);
    expect(
      useDelegationStore.getState().canFamiliarPerform({
        grantId: 'grant-live',
        requiredScope: 'moderate',
        now: BASE_TIME + 3
      })
    ).toEqual({ allowed: false, reason: 'familiar is revoked' });
  });

  it('returns grant statuses for unknown/pending/active/expired/revoked states', () => {
    setPrincipal();
    useDelegationStore.getState().registerFamiliar({
      id: 'fam-1',
      label: 'Fam',
      createdAt: BASE_TIME,
      capabilityPreset: 'suggest'
    });

    useDelegationStore.getState().issueGrant(
      makeGrant({ grantId: 'grant-pending', issuedAt: BASE_TIME + 10, expiresAt: BASE_TIME + 100 }),
      { now: BASE_TIME + 10 }
    );
    useDelegationStore.getState().issueGrant(
      makeGrant({ grantId: 'grant-expired', issuedAt: BASE_TIME, expiresAt: BASE_TIME + 5 }),
      { now: BASE_TIME }
    );
    useDelegationStore.getState().issueGrant(
      makeGrant({ grantId: 'grant-revoked', issuedAt: BASE_TIME, expiresAt: BASE_TIME + 100 }),
      { now: BASE_TIME }
    );

    expect(useDelegationStore.getState().getGrantStatus('missing')).toBe('unknown');
    expect(useDelegationStore.getState().getGrantStatus('grant-pending', BASE_TIME + 1)).toBe('pending');
    expect(useDelegationStore.getState().getGrantStatus('grant-pending', BASE_TIME + 50)).toBe('active');
    expect(useDelegationStore.getState().getGrantStatus('grant-expired', BASE_TIME + 6)).toBe('expired');

    useDelegationStore.getState().revokeGrantById('grant-revoked', BASE_TIME + 2);
    expect(useDelegationStore.getState().getGrantStatus('grant-revoked', BASE_TIME + 2)).toBe('revoked');

    useDelegationStore.getState().revokeFamiliar('fam-1', BASE_TIME + 1);
    expect(useDelegationStore.getState().getGrantStatus('grant-pending', BASE_TIME + 2)).toBe('revoked');

    const statuses: DelegationGrantStatus[] = ['unknown', 'pending', 'active', 'expired', 'revoked'];
    expect(statuses).toContain('active');
  });

  it('reset reloads persisted state and mock factory provides stable shape', () => {
    setPrincipal('principal-1');
    useDelegationStore.getState().registerFamiliar({
      id: 'fam-reset',
      label: 'Persisted',
      createdAt: BASE_TIME,
      capabilityPreset: 'suggest'
    });

    useDelegationStore.setState((state) => ({
      ...state,
      familiarsById: {}
    }));
    expect(useDelegationStore.getState().familiarsById).toEqual({});

    useDelegationStore.getState().reset();
    expect(useDelegationStore.getState().familiarsById['fam-reset']?.label).toBe('Persisted');

    const mock = createMockDelegationStore();
    expect(mock.canFamiliarPerform({ grantId: 'x', requiredScope: 'draft' })).toEqual({ allowed: true });
    expect(mock.getGrantStatus('x')).toBe('active');
    expect(mock.issueGrant(makeGrant()).grantId).toBe('grant-1');

    const generated = mock.registerFamiliar({ label: 'Generated', capabilityPreset: 'suggest' });
    expect(generated.id).toBe('mock-generated-familiar');
    expect(generated.createdAt).toBe(0);

    expect(() => mock.setActivePrincipal('principal')).not.toThrow();
    expect(() => mock.revokeFamiliar('fam')).not.toThrow();
    expect(() => mock.revokeGrantById('grant')).not.toThrow();
    expect(() => mock.reset()).not.toThrow();
  });
});
