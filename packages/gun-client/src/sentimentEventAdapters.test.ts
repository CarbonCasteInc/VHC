import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveSentimentEventId, type SentimentEvent } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  getSentimentOutboxChain,
  readUserEvents,
  sentimentEventAdapterInternal,
  writeSentimentEvent,
} from './sentimentEventAdapters';

const encryptMock = vi.fn();
const decryptMock = vi.fn();

vi.mock('gun/sea', () => ({
  default: {
    encrypt: (...args: unknown[]) => encryptMock(...args),
    decrypt: (...args: unknown[]) => decryptMock(...args),
  },
}));

interface FakeNode {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setPutError: (path: string, err: string) => void;
  setPutHang: (path: string) => void;
  setPutLateAck: (path: string, delayMs: number) => void;
}

function createFakeNode(): FakeNode {
  const reads = new Map<string, unknown>();
  const putErrors = new Map<string, string>();
  const putHangs = new Set<string>();
  const putLateAcks = new Map<string, number>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: any = {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(reads.get(path))),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        if (putHangs.has(path)) {
          return;
        }
        const err = putErrors.get(path);
        cb?.(err ? { err } : {});

        const lateAckDelay = putLateAcks.get(path);
        if (!err && lateAckDelay !== undefined) {
          setTimeout(() => cb?.({}), lateAckDelay);
        }
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
    return node;
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    },
    setPutHang(path: string) {
      putHangs.add(path);
    },
    setPutLateAck(path: string, delayMs: number) {
      putLateAcks.set(path, delayMs);
    },
  };
}

function createClient(
  userNode: FakeNode,
  guard: TopologyGuard,
  options: { withPair?: boolean; withPub?: boolean } = {},
): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  const userChain = userNode.root;
  userChain.is = options.withPub === false ? {} : { pub: 'device-pub-1' };
  userChain._ = options.withPair === false ? {} : { sea: { epub: 'epub-1', epriv: 'epriv-1' } };

  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: guard,
    gun: { user: vi.fn(() => userChain) } as unknown as VennClient['gun'],
    mesh: {} as VennClient['mesh'],
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  };
}

const EVENT: SentimentEvent = {
  topic_id: 'topic-1',
  synthesis_id: 'synth-1',
  epoch: 2,
  point_id: 'point-1',
  agreement: 1,
  weight: 1.2,
  constituency_proof: {
    district_hash: 'district-1',
    nullifier: 'nullifier-1',
    merkle_root: 'root-1',
  },
  emitted_at: 1_700_000_000_000,
};

describe('sentimentEventAdapters', () => {
  beforeEach(() => {
    encryptMock.mockReset();
    decryptMock.mockReset();
  });

  it('builds outbox chain and enforces topology guard on nested writes', async () => {
    const userNode = createFakeNode();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(userNode, guard);

    const outbox = getSentimentOutboxChain(client);
    await outbox.get('event-1').put({ __encrypted: true, ciphertext: 'cipher' });

    expect(guard.validateWrite).toHaveBeenCalledWith(
      '~device-pub-1/outbox/sentiment/event-1/',
      { __encrypted: true, ciphertext: 'cipher' },
    );
  });

  it('writeSentimentEvent encrypts and writes deterministic event id', async () => {
    const userNode = createFakeNode();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(userNode, guard);
    encryptMock.mockResolvedValueOnce('encrypted-payload');

    const result = await writeSentimentEvent(client, EVENT);
    const expectedEventId = await deriveSentimentEventId({
      nullifier: EVENT.constituency_proof.nullifier,
      topic_id: EVENT.topic_id,
      synthesis_id: EVENT.synthesis_id,
      epoch: EVENT.epoch,
      point_id: EVENT.point_id,
    });

    expect(result.eventId).toBe(expectedEventId);
    expect(result.event).toEqual(EVENT);
    expect(encryptMock).toHaveBeenCalledWith(JSON.stringify(EVENT), { epub: 'epub-1', epriv: 'epriv-1' });
    expect(userNode.writes[0]).toEqual({
      path: `outbox/sentiment/${expectedEventId}`,
      value: { __encrypted: true, ciphertext: 'encrypted-payload' },
    });

    encryptMock.mockResolvedValueOnce({ ct: 'cipher-object' });
    await writeSentimentEvent(client, { ...EVENT, point_id: 'point-2' });
    expect((userNode.writes[1].value as { ciphertext: string }).ciphertext).toContain('cipher-object');
  });

  it('writeSentimentEvent rejects missing sea keypair and invalid payload', async () => {
    const userNode = createFakeNode();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const noPairClient = createClient(userNode, guard, { withPair: false });
    encryptMock.mockResolvedValue('encrypted-payload');

    await expect(writeSentimentEvent(noPairClient, EVENT)).rejects.toThrow('SEA keypair unavailable');

    const withPairClient = createClient(userNode, guard, { withPair: true });
    await expect(
      writeSentimentEvent(withPairClient, {
        ...EVENT,
        synthesis_id: '',
      }),
    ).rejects.toThrow();
  });

  it('readUserEvents decrypts, validates, and filters by topic + epoch', async () => {
    const userNode = createFakeNode();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(userNode, guard);

    const eventTwo: SentimentEvent = {
      ...EVENT,
      point_id: 'point-2',
      emitted_at: EVENT.emitted_at + 5,
      agreement: -1,
    };

    userNode.setRead('outbox/sentiment', {
      _: { '#': 'gun-meta' },
      e1: { __encrypted: true, ciphertext: 'enc-1' },
      e2: { __encrypted: true, ciphertext: 'enc-2' },
      ignoredOtherEpoch: { __encrypted: true, ciphertext: 'enc-3' },
      malformedEnvelope: { ciphertext: 'enc-4' },
      undecipherableEnvelope: { __encrypted: true, ciphertext: 'enc-5' },
      invalidDecryptedPayload: { __encrypted: true, ciphertext: 'enc-6' },
      nonObjectEnvelope: 7,
    });

    decryptMock.mockImplementation(async (ciphertext: unknown) => {
      if (ciphertext === 'enc-1') return JSON.stringify(EVENT);
      if (ciphertext === 'enc-2') return eventTwo;
      if (ciphertext === 'enc-3') {
        return JSON.stringify({ ...EVENT, epoch: EVENT.epoch + 1 });
      }
      if (ciphertext === 'enc-6') {
        return JSON.stringify({ topic_id: 'topic-1' });
      }
      return null;
    });

    await expect(readUserEvents(client, 'topic-1', 2)).resolves.toEqual([EVENT, eventTwo]);
  });

  it('handles encryption failure and put ack errors during write', async () => {
    const userNode = createFakeNode();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(userNode, guard);

    encryptMock.mockResolvedValueOnce(null);
    await expect(writeSentimentEvent(client, EVENT)).rejects.toThrow('encryption failed');

    const eventId = await deriveSentimentEventId({
      nullifier: EVENT.constituency_proof.nullifier,
      topic_id: EVENT.topic_id,
      synthesis_id: EVENT.synthesis_id,
      epoch: EVENT.epoch,
      point_id: EVENT.point_id,
    });
    userNode.setPutError(`outbox/sentiment/${eventId}`, 'write-failed');

    encryptMock.mockResolvedValueOnce('encrypted-payload');
    await expect(writeSentimentEvent(client, EVENT)).rejects.toThrow('write-failed');
  });

  it('writeSentimentEvent resolves after ack-timeout fallback when put callback never arrives', async () => {
    const userNode = createFakeNode();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(userNode, guard);

    const eventId = await deriveSentimentEventId({
      nullifier: EVENT.constituency_proof.nullifier,
      topic_id: EVENT.topic_id,
      synthesis_id: EVENT.synthesis_id,
      epoch: EVENT.epoch,
      point_id: EVENT.point_id,
    });
    userNode.setPutHang(`outbox/sentiment/${eventId}`);
    encryptMock.mockResolvedValueOnce('encrypted-payload');

    await expect(writeSentimentEvent(client, EVENT)).resolves.toEqual({
      eventId,
      event: EVENT,
      ack: {
        acknowledged: false,
        timedOut: true,
      },
    });
  }, 10000);

  it('writeSentimentEvent ignores timeout/late ack callbacks after successful settlement', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const userNode = createFakeNode();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(userNode, guard);

      const eventId = await deriveSentimentEventId({
        nullifier: EVENT.constituency_proof.nullifier,
        topic_id: EVENT.topic_id,
        synthesis_id: EVENT.synthesis_id,
        epoch: EVENT.epoch,
        point_id: EVENT.point_id,
      });
      userNode.setPutLateAck(`outbox/sentiment/${eventId}`, 1200);
      encryptMock.mockResolvedValueOnce('encrypted-payload');

      await expect(writeSentimentEvent(client, EVENT)).resolves.toEqual({
        eventId,
        event: EVENT,
        ack: {
          acknowledged: true,
          timedOut: false,
        },
      });
      await vi.advanceTimersByTimeAsync(1500);

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('throws when user pub is unavailable and validates read inputs', async () => {
    const userNode = createFakeNode();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const noPubClient = createClient(userNode, guard, { withPub: false });

    expect(() => getSentimentOutboxChain(noPubClient)).toThrow('user pub is unavailable');

    const withPubClient = createClient(userNode, guard, { withPub: true });
    await expect(readUserEvents(withPubClient, '   ', 2)).rejects.toThrow('topicId is required');

    userNode.setRead('outbox/sentiment', null);
    await expect(readUserEvents(withPubClient, 'topic-1', 2)).resolves.toEqual([]);
  });

  it('internal helper exposes deterministic outbox path builders', () => {
    const userNode = createFakeNode();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(userNode, guard);

    expect(sentimentEventAdapterInternal.sentimentOutboxPath(client)).toBe('~device-pub-1/outbox/sentiment/');
    expect(sentimentEventAdapterInternal.sentimentOutboxEventPath(client, 'evt-1')).toBe(
      '~device-pub-1/outbox/sentiment/evt-1/',
    );
  });
});
