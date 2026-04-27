import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOperatorTrustStore,
  createTrustedOperatorAuthorization,
  resolveTrustedOperatorAuthorizationFromEnv,
} from './operatorTrust';

describe('operatorTrust store', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves trusted beta operator authorization from explicit allowlist env', () => {
    const resolution = resolveTrustedOperatorAuthorizationFromEnv({
      readEnv: (key) => {
        const env: Record<string, string> = {
          VITE_VH_TRUSTED_OPERATOR_IDS: 'ops-1,ops-2',
          VITE_VH_OPERATOR_ID: 'ops-2',
          VITE_VH_TRUSTED_OPERATOR_CAPABILITIES: 'review_news_report,moderate_story_thread',
        };
        return env[key];
      },
      loadOperatorIdentity: () => ({ session: { nullifier: 'identity-operator' } }),
      now: () => 123,
    });

    expect(resolution).toEqual({
      authorization: {
        schemaVersion: 'vh-trusted-operator-authorization-v1',
        operator_id: 'ops-2',
        role: 'trusted_beta_operator',
        capabilities: ['review_news_report', 'moderate_story_thread'],
        granted_at: 123,
      },
      error: null,
    });
  });

  it('resolves trusted beta operator authorization from the default Vite env reader', () => {
    vi.stubEnv('VITE_VH_TRUSTED_OPERATOR_IDS', 'ops-env');
    vi.stubEnv('VITE_VH_OPERATOR_ID', 'ops-env');

    const resolution = resolveTrustedOperatorAuthorizationFromEnv();

    expect(resolution.authorization?.operator_id).toBe('ops-env');
    expect(resolution.authorization?.capabilities).toContain('review_news_report');
    expect(resolution.error).toBeNull();
  });

  it('preserves explicit expiry metadata in created authorization records', () => {
    expect(createTrustedOperatorAuthorization('ops-1', { grantedAt: 10, expiresAt: 20 })).toMatchObject({
      operator_id: 'ops-1',
      granted_at: 10,
      expires_at: 20,
    });
  });

  it('allows identity nullifier only when it is explicitly allowlisted', () => {
    const resolution = resolveTrustedOperatorAuthorizationFromEnv({
      readEnv: (key) => (key === 'VITE_VH_TRUSTED_OPERATOR_IDS' ? 'identity-operator' : undefined),
      loadOperatorIdentity: () => ({ session: { nullifier: 'identity-operator' } }),
      now: () => 456,
    });

    expect(resolution.authorization?.operator_id).toBe('identity-operator');
    expect(resolution.authorization?.capabilities).toContain('write_synthesis_correction');
    expect(resolution.error).toBeNull();
  });

  it('fails closed when allowlist, operator id, or capabilities are invalid', () => {
    expect(
      resolveTrustedOperatorAuthorizationFromEnv({
        readEnv: () => undefined,
        loadOperatorIdentity: () => null,
      }).error,
    ).toBe('Trusted operator allowlist is not configured');

    expect(
      resolveTrustedOperatorAuthorizationFromEnv({
        readEnv: (key) => (key === 'VITE_VH_TRUSTED_OPERATOR_IDS' ? 'ops-1' : undefined),
        loadOperatorIdentity: () => null,
      }).error,
    ).toBe('Trusted operator authorization requires an operator id');

    expect(
      resolveTrustedOperatorAuthorizationFromEnv({
        readEnv: (key) => {
          const env: Record<string, string> = {
            VITE_VH_TRUSTED_OPERATOR_IDS: 'ops-1',
            VITE_VH_OPERATOR_ID: 'ops-2',
          };
          return env[key];
        },
        loadOperatorIdentity: () => null,
      }).error,
    ).toBe('Current operator is not in the trusted beta operator allowlist');

    expect(
      resolveTrustedOperatorAuthorizationFromEnv({
        readEnv: (key) => {
          const env: Record<string, string> = {
            VITE_VH_TRUSTED_OPERATOR_IDS: 'ops-1',
            VITE_VH_OPERATOR_ID: 'ops-1',
            VITE_VH_TRUSTED_OPERATOR_CAPABILITIES: 'root',
          };
          return env[key];
        },
        loadOperatorIdentity: () => null,
      }).error,
    ).toContain('Invalid enum value');

    expect(
      resolveTrustedOperatorAuthorizationFromEnv({
        readEnv: (key) => {
          if (key === 'VITE_VH_TRUSTED_OPERATOR_IDS') return 'ops-1';
          if (key === 'VITE_VH_OPERATOR_ID') return 'ops-1';
          throw 'capability loader failed';
        },
        loadOperatorIdentity: () => null,
      }).error,
    ).toBe('Trusted operator authorization is invalid');
  });

  it('refreshes, checks capabilities, and rejects malformed authorization objects', () => {
    const store = createOperatorTrustStore({
      readEnv: (key) => {
        const env: Record<string, string> = {
          VITE_VH_TRUSTED_OPERATOR_IDS: 'ops-1',
          VITE_VH_OPERATOR_ID: 'ops-1',
        };
        return env[key];
      },
      loadOperatorIdentity: () => null,
      now: () => 789,
    });

    expect(store.getState().refreshAuthorization()?.operator_id).toBe('ops-1');
    expect(store.getState().isAuthorized('review_news_report')).toBe(true);
    expect(store.getState().isAuthorized('private_support_handoff')).toBe(true);

    store.getState().setAuthorization({ ...createTrustedOperatorAuthorization('ops-2'), operator_id: ' ' });
    expect(store.getState().authorization).toBeNull();
    expect(store.getState().error).toBe('Trusted operator authorization is invalid');

    store.getState().setAuthorization(createTrustedOperatorAuthorization('ops-3', {
      capabilities: ['review_news_report'],
    }));
    expect(store.getState().isAuthorized('review_news_report')).toBe(true);
    expect(store.getState().isAuthorized('moderate_story_thread')).toBe(false);

    store.getState().setAuthorization(null);
    expect(store.getState().authorization).toBeNull();
    expect(store.getState().error).toBeNull();

    store.getState().reset();
    expect(store.getState().authorization).toBeNull();
  });
});
