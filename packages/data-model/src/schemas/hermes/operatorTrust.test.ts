import { describe, expect, it } from 'vitest';
import {
  TRUSTED_BETA_OPERATOR_CAPABILITIES,
  TrustedOperatorAuthorizationSchema,
  assertTrustedOperatorAuthorization,
  type TrustedOperatorAuthorization,
} from './operatorTrust';

const AUTHORIZATION: TrustedOperatorAuthorization = {
  schemaVersion: 'vh-trusted-operator-authorization-v1',
  operator_id: 'ops-1',
  role: 'trusted_beta_operator',
  capabilities: [...TRUSTED_BETA_OPERATOR_CAPABILITIES],
  granted_at: 100,
  expires_at: 500,
};

describe('TrustedOperatorAuthorizationSchema', () => {
  it('accepts trusted beta operator authorization records', () => {
    const parsed = TrustedOperatorAuthorizationSchema.parse(AUTHORIZATION);
    expect(parsed.operator_id).toBe('ops-1');
    expect(parsed.capabilities).toContain('review_news_report');
    expect(parsed.capabilities).toContain('private_support_handoff');
  });

  it('rejects malformed or inconsistent authorization records', () => {
    const invalidPayloads = [
      { ...AUTHORIZATION, operator_id: ' ' },
      { ...AUTHORIZATION, role: 'admin' },
      { ...AUTHORIZATION, capabilities: [] },
      { ...AUTHORIZATION, capabilities: ['root'] },
      { ...AUTHORIZATION, granted_at: -1 },
      { ...AUTHORIZATION, expires_at: 100 },
      { ...AUTHORIZATION, token: 'secret' },
    ];

    for (const payload of invalidPayloads) {
      expect(TrustedOperatorAuthorizationSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('asserts operator id, capability, and expiry', () => {
    expect(assertTrustedOperatorAuthorization(AUTHORIZATION, 'ops-1', 'review_news_report', 200)).toEqual(AUTHORIZATION);
    expect(() => assertTrustedOperatorAuthorization(null, 'ops-1', 'review_news_report', 200)).toThrow(
      'Trusted operator authorization is required',
    );
    expect(() => assertTrustedOperatorAuthorization(AUTHORIZATION, ' ', 'review_news_report', 200)).toThrow(
      'operatorId is required',
    );
    expect(() => assertTrustedOperatorAuthorization(AUTHORIZATION, 'ops-2', 'review_news_report', 200)).toThrow(
      'does not match operator audit id',
    );
    expect(() =>
      assertTrustedOperatorAuthorization(
        { ...AUTHORIZATION, capabilities: ['review_news_report'] },
        'ops-1',
        'moderate_story_thread',
        200,
      ),
    ).toThrow('lacks moderate_story_thread');
    expect(() => assertTrustedOperatorAuthorization(AUTHORIZATION, 'ops-1', 'review_news_report', 500)).toThrow(
      'has expired',
    );
  });
});
