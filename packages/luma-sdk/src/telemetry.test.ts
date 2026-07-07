import { describe, expect, it, vi } from 'vitest';
import {
  assertLumaTelemetrySafe,
  clearLumaTelemetry,
  createLumaTelemetryStore,
  emitLumaEvent,
  lumaLog,
  LUMA_TELEMETRY_EVENT_TYPES,
  lumaTelemetryStore,
  redactLumaTelemetryContext,
  redactedPathHash,
} from './telemetry';

describe('LUMA telemetry', () => {
  it('locks the spec §16 event registry', () => {
    expect(LUMA_TELEMETRY_EVENT_TYPES).toEqual([
      'luma_session_created',
      'luma_session_expired',
      'luma_session_re_attested',
      'luma_session_revoked',
      'luma_session_revoked_by_bulletin',
      'luma_policy_blocked',
      'luma_envelope_rejected',
      'luma_tombstone_attempted',
      'luma_evidence_capture_started',
      'luma_evidence_capture_succeeded',
      'luma_evidence_capture_failed',
      'luma_forbidden_claim_rendered',
      'luma_safety_bulletin_fetched',
      'luma_vault_migrated_v1_to_v2',
    ]);
  });

  it('emits bounded in-memory events and notifies subscribers', () => {
    const store = createLumaTelemetryStore({ maxEvents: 2, saltBytes: new Uint8Array(16).fill(1) });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.emit({ type: 'luma_session_created', tsMs: 1, context: { profile: 'dev' } });
    store.emit({ type: 'luma_session_expired', tsMs: 2 });
    store.emit({ type: 'luma_policy_blocked', level: 'warn', tsMs: 3, message: 'blocked' });

    expect(store.getSnapshot()).toMatchObject([
      { sequence: 2, type: 'luma_session_expired', ts_ms: 2 },
      { sequence: 3, type: 'luma_policy_blocked', level: 'warn', ts_ms: 3, message: 'blocked' },
    ]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.clear({ rotateSalt: false });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('red test: rejects unknown event types at emit time', () => {
    const store = createLumaTelemetryStore({ saltBytes: new Uint8Array(16).fill(1) });
    expect(() => store.emit({ type: 'luma_unknown' as never })).toThrow(/Unknown LUMA telemetry event type/);
  });

  it('red test: rejects unsafe event message strings before storing telemetry', () => {
    const store = createLumaTelemetryStore({ saltBytes: new Uint8Array(16).fill(1) });

    expect(() => store.emit({
      type: 'luma_policy_blocked',
      message: 'blocked raw /vh/news/story/demo path',
    })).toThrow(/raw mesh path/);
    expect(() => store.emit({
      type: 'luma_policy_blocked',
      message: 'https://example.test/callback?token=secret',
    })).toThrow(/token-bearing URL/);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('red test: rejects typed secrets, raw envelopes, token URLs, and raw mesh paths', () => {
    expect(() => assertLumaTelemetrySafe({ principalNullifier: 'n-123' })).toThrow(/forbidden field/);
    expect(() => assertLumaTelemetrySafe({ sessionToken: 's-123' })).toThrow(/forbidden field/);
    expect(() => assertLumaTelemetrySafe({ deviceCredential: 'd-123' })).toThrow(/forbidden field/);
    expect(() => assertLumaTelemetrySafe({ rawEnvelopeJson: '{"envelopeVersion":1,"signature":"abc"}' })).toThrow(/forbidden field/);
    expect(() => assertLumaTelemetrySafe({ payload: '{"envelopeVersion":1,"signature":"abc"}' })).toThrow(/raw envelope JSON/);
    expect(() => assertLumaTelemetrySafe({ href: 'https://example.test/verify?token=secret' })).toThrow(/token-bearing URL/);
    expect(() => assertLumaTelemetrySafe({ mesh: '/vh/news/story/demo' })).toThrow(/raw mesh path/);
  });

  it('red test: rejects district hash fields in both naming forms', () => {
    expect(() => assertLumaTelemetrySafe({ district_hash: 'd-123' })).toThrow(/forbidden field/);
    expect(() => assertLumaTelemetrySafe({ districtHash: 'd-123' })).toThrow(/forbidden field/);
  });

  it('red test: rejects account-provider identity and token fields before they exist', () => {
    const forbiddenProviderFields = [
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'idToken',
      'id_token',
      'providerSubject',
      'provider_subject',
      'providerLabel',
      'provider_label',
      'displayLabel',
      'display_label',
      'clientSecret',
      'client_secret',
      'oauthCode',
      'oauth_code',
    ];
    for (const field of forbiddenProviderFields) {
      expect(() => assertLumaTelemetrySafe({ [field]: 'leaked' }), field).toThrow(/forbidden field/);
      expect(redactLumaTelemetryContext({ [field]: 'leaked' })).toEqual({ [field]: '[REDACTED:field]' });
    }
  });

  it('accepts primitives, arrays, repeated references, and malformed non-token URLs', () => {
    const repeated: Record<string, unknown> = { safe: true };
    repeated.self = repeated;

    expect(() => assertLumaTelemetrySafe(null)).not.toThrow();
    expect(() => assertLumaTelemetrySafe(42)).not.toThrow();
    expect(() => assertLumaTelemetrySafe(['ok', { nested: repeated }])).not.toThrow();
    expect(() => assertLumaTelemetrySafe({ malformed: 'https://%' })).not.toThrow();
    expect(() => assertLumaTelemetrySafe({ safeUrl: 'https://example.test/path?view=feed' })).not.toThrow();
  });

  it('redacts logs while preserving safe context shape', () => {
    const circular: Record<string, unknown> = { ok: true };
    circular.self = circular;
    expect(redactLumaTelemetryContext({
      verifierId: 'beta-local',
      values: ['plain', '{"envelopeVersion":1,"signature":"abc"}'],
      nested: { url: 'https://example.test/callback?access_token=secret' },
      error: new Error('bad /vh/news/story/demo path'),
      circular,
      symbol: Symbol('luma'),
      missing: undefined,
    })).toEqual({
      verifierId: '[REDACTED:field]',
      values: ['plain', '[REDACTED:envelope-json]'],
      nested: { url: '[REDACTED:token-url]' },
      error: { name: 'Error', message: '[REDACTED:mesh-path]' },
      circular: { ok: true, self: '[REDACTED:circular]' },
      symbol: 'Symbol(luma)',
      missing: undefined,
    });
  });

  it('lumaLog is the only console sink and emits redacted payloads', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      lumaLog('info', '[vh:test:info] /vh/news/story/demo');
      lumaLog('warn', '[vh:test]', {
        signature: 'secret-signature',
        path: '/vh/news/story/demo',
      });
      lumaLog('error', 'https://example.test/callback?token=secret', { ok: true });
      expect(info).toHaveBeenCalledWith('[REDACTED:mesh-path]');
      expect(warn).toHaveBeenCalledWith('[vh:test]', {
        signature: '[REDACTED:field]',
        path: '[REDACTED:mesh-path]',
      });
      expect(error).toHaveBeenCalledWith('[REDACTED:token-url]', { ok: true });
    } finally {
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('hashes raw paths without exposing them and rotates salt on clear', async () => {
    const store = createLumaTelemetryStore({ saltBytes: new Uint8Array(16).fill(2) });
    const first = await store.redactedPathHash('/vh/news/story/demo');
    const sameSalt = await store.redactedPathHash('/vh/news/story/demo');
    store.clear();
    const rotated = await store.redactedPathHash('/vh/news/story/demo');

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sameSalt).toBe(first);
    expect(rotated).not.toBe(first);
    expect(first).not.toContain('/vh/news/story/demo');
  });

  it('supports explicit salt rotation and rejects empty or unhasheable path inputs', async () => {
    const store = createLumaTelemetryStore({ saltBytes: new Uint8Array(16).fill(4) });
    const first = await store.redactedPathHash('/vh/news/story/demo');
    store.rotateSalt();
    const rotated = await store.redactedPathHash('/vh/news/story/demo');

    expect(rotated).not.toBe(first);
    await expect(store.redactedPathHash('')).rejects.toThrow(/non-empty raw path/);
  });

  it('uses fallback salt bytes when getRandomValues is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    try {
      const store = createLumaTelemetryStore();
      store.emit({ type: 'luma_session_created' });
      expect(store.getSnapshot()).toHaveLength(1);
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('fails closed when WebCrypto SHA-256 is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(7);
        return bytes;
      },
    });
    try {
      const store = createLumaTelemetryStore({ saltBytes: new Uint8Array(16).fill(5) });
      await expect(store.redactedPathHash('/vh/news/story/demo')).rejects.toThrow(/WebCrypto SHA-256/);
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('returns without throwing when no console sink is available', () => {
    const originalConsole = globalThis.console;
    vi.stubGlobal('console', undefined);
    try {
      expect(() => lumaLog('warn', '[vh:test]')).not.toThrow();
    } finally {
      vi.stubGlobal('console', originalConsole);
    }
  });

  it('singleton helpers use the same in-memory ring buffer', async () => {
    clearLumaTelemetry({ rotateSalt: false });
    const event = emitLumaEvent({ type: 'luma_safety_bulletin_fetched', tsMs: 10 });
    const hash = await redactedPathHash('/vh/news/index/latest');

    expect(lumaTelemetryStore.getSnapshot()).toEqual([event]);
    expect(hash).toMatch(/^sha256:/);
    clearLumaTelemetry({ rotateSalt: false });
  });
});
