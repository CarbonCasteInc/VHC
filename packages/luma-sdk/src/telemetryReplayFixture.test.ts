import { describe, expect, it } from 'vitest';
import {
  createLumaTelemetryStore,
  type EmitLumaEventInput,
  type LumaEvent,
} from './telemetry';

const PUBLIC_BETA_TELEMETRY_REPLAY_FIXTURE: readonly EmitLumaEventInput[] = Object.freeze([
  {
    type: 'luma_session_created',
    tsMs: 1,
    context: {
      profileTag: 'public-beta',
      assuranceLevel: 'beta_local',
      verifierIdHash: 'sha256:8b13f4c0a0db7a9d8ff3f018d8c7f2d3e0b4b2b179cfb7fd1be1ce6c2b70605a',
    },
  },
  {
    type: 'luma_policy_blocked',
    level: 'warn',
    tsMs: 2,
    message: 'write blocked by policy',
    context: {
      audience: 'vh-forum-thread',
      reason: 'session_near_expiry',
    },
  },
  {
    type: 'luma_envelope_rejected',
    level: 'warn',
    tsMs: 3,
    context: {
      audience: 'vh-news-report',
      reason: 'audience_mismatch',
      trace_id: 'trace-public-beta-001',
    },
  },
  {
    type: 'luma_tombstone_attempted',
    tsMs: 4,
    context: {
      domain: 'forum',
      pathClass: 'forum-author-record',
      redactedPathHash: 'sha256:5a5f6a41c5d1b4ecb0af6e89a6d682711a5083e41a33162d795fd7af36eafcab',
      outcome: 'ok',
    },
  },
  {
    type: 'luma_evidence_capture_started',
    tsMs: 5,
    context: { profileTag: 'public-beta' },
  },
  {
    type: 'luma_evidence_capture_succeeded',
    tsMs: 6,
    context: {
      profileTag: 'public-beta',
      run_id: 'luma-replay-fixture-001',
    },
  },
  {
    type: 'luma_safety_bulletin_fetched',
    tsMs: 7,
    context: {
      bulletinId: 'bulletin-public-beta-001',
      outcome: 'fresh',
    },
  },
  {
    type: 'luma_session_revoked',
    tsMs: 8,
    context: {
      mode: 'sign-out',
    },
  },
]);

const FORBIDDEN_REPLAY_STRINGS = [
  'principalNullifier',
  'sessionToken',
  'deviceCredential',
  'rawSignatureBytes',
  'rawEnvelopeJson',
  'assuranceEnvelope',
  'verifierId":"',
  '/vh/',
  'access_token=',
  '"signature"',
];

function replay(events: readonly EmitLumaEventInput[]): readonly LumaEvent[] {
  const store = createLumaTelemetryStore({ saltBytes: new Uint8Array(16).fill(9) });
  for (const event of events) {
    store.emit(event);
  }
  return store.getSnapshot();
}

describe('LUMA telemetry replay-fixture redaction', () => {
  it('replays a representative public-beta fixture without forbidden telemetry material', () => {
    const snapshot = replay(PUBLIC_BETA_TELEMETRY_REPLAY_FIXTURE);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toHaveLength(PUBLIC_BETA_TELEMETRY_REPLAY_FIXTURE.length);
    for (const forbidden of FORBIDDEN_REPLAY_STRINGS) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('red test: fails closed when a replay-fixture event contains typed secrets or raw paths', () => {
    expect(() => replay([
      ...PUBLIC_BETA_TELEMETRY_REPLAY_FIXTURE,
      {
        type: 'luma_policy_blocked',
        level: 'warn',
        tsMs: 9,
        message: 'bad raw /vh/news/story/secret path',
        context: {
          audience: 'vh-news-report',
          principalNullifier: 'raw-principal',
        },
      } as unknown as EmitLumaEventInput,
    ])).toThrow(/forbidden/);
  });

  it('red test: fails closed when a replay-fixture event contains a token-bearing URL', () => {
    expect(() => replay([
      {
        type: 'luma_evidence_capture_failed',
        level: 'error',
        tsMs: 10,
        context: {
          profileTag: 'public-beta',
          reason: 'https://verifier.example.test/callback?access_token=secret',
        },
      },
    ])).toThrow(/token-bearing URL/);
  });
});
