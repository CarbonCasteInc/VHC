import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHermesChatChain } from '@vh/gun-client';
import { createRealChatStore } from './hermesMessaging';
import { useXpLedger } from './xpLedger';

const inboxWrites: any[] = [];
const outboxWrites: any[] = [];
const chatWrites: any[] = [];

function makeLeaf(label: string, key: string) {
  const leaf: any = {
    put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
      if (label === 'inbox') inboxWrites.push({ key, value });
      if (label === 'outbox') outboxWrites.push({ key, value });
      if (label === 'chat') chatWrites.push({ key, value });
      cb?.({});
    })
  };
  leaf.get = vi.fn(() => leaf);
  return leaf;
}

const mockInbox = { get: vi.fn((key: string) => makeLeaf('inbox', key)) } as any;
const mockOutbox = { get: vi.fn((key: string) => makeLeaf('outbox', key)) } as any;
const mockChatLeaf = { get: vi.fn((key: string) => makeLeaf('chat', key)), map: vi.fn() } as any;
const chatHandlers: Array<(data?: any) => void> = [];
const mockChatMap = {
  on: vi.fn((cb: (data?: any) => void) => {
    chatHandlers.push(cb);
  }),
  off: vi.fn((cb: (data?: any) => void) => {
    const idx = chatHandlers.indexOf(cb);
    if (idx >= 0) chatHandlers.splice(idx, 1);
  })
};
mockChatLeaf.map = vi.fn(() => mockChatMap);

vi.mock('@vh/data-model', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    deriveChannelId: vi.fn(async () => 'channel-123')
  };
});

vi.mock('@vh/gun-client', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    deriveSharedSecret: vi.fn(async () => 'secret'),
    encryptMessagePayload: vi.fn(async () => 'ciphertext'),
    getHermesInboxChain: vi.fn(() => mockInbox),
    getHermesOutboxChain: vi.fn(() => mockOutbox),
    getHermesChatChain: vi.fn(() => mockChatLeaf)
  };
});

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  };
};

beforeEach(() => {
  (globalThis as any).localStorage = memoryStorage();
  inboxWrites.length = 0;
  outboxWrites.length = 0;
  chatWrites.length = 0;
  chatHandlers.length = 0;
  mockInbox.get.mockClear();
  mockOutbox.get.mockClear();
  mockChatLeaf.get.mockClear();
  mockChatLeaf.map.mockClear();
  mockChatMap.on.mockClear();
  mockChatMap.off.mockClear();
  mockInbox.get.mockImplementation((key: string) => makeLeaf('inbox', key));
  mockOutbox.get.mockImplementation((key: string) => makeLeaf('outbox', key));
  mockChatLeaf.get.mockImplementation((key: string) => makeLeaf('chat', key));
  mockChatLeaf.map.mockImplementation(() => mockChatMap);
  delete (mockChatLeaf as any).on;
  delete (mockChatLeaf as any).off;
  useXpLedger.setState((state) => ({
    ...state,
    socialXP: 0,
    civicXP: 0,
    projectXP: 0,
    dailySocialXP: { ...state.dailySocialXP, amount: 0 },
    dailyCivicXP: { ...state.dailyCivicXP, amount: 0 },
    weeklyProjectXP: { ...state.weeklyProjectXP, amount: 0 },
    firstContacts: new Set(),
    qualityBonuses: new Map(),
    sustainedAwards: new Map(),
    projectWeekly: new Map()
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hermesMessaging store', () => {
  const setIdentity = (nullifier: string, trustScore = 1) =>
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier, trustScore }, attestation: { deviceKey: nullifier } })
    );

  it('sendMessage writes encrypted payload to inbox/outbox/chat', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier: 'alice', trustScore: 1 }, attestation: { deviceKey: 'dev' } })
    );
    const store = createRealChatStore({
      resolveClient: () => ({ } as any),
      randomId: () => 'msg-1',
      now: () => 1234
    });

    await store.getState().sendMessage('bob', { text: 'hello' }, 'text');

    expect(inboxWrites).toHaveLength(1);
    expect(outboxWrites).toHaveLength(1);
    expect(chatWrites).toHaveLength(1);
    [inboxWrites[0], outboxWrites[0], chatWrites[0]].forEach((call) => {
      expect(call.value.__encrypted).toBe(true);
      expect(call.value.content).toBe('ciphertext');
      expect(call.value.type).toBe('text');
    });
    expect(store.getState().statuses.get('msg-1')).toBe('sent');
    expect(useXpLedger.getState().socialXP).toBeGreaterThan(0);
  });

  it('deduplicates messages by id when subscribed', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier: 'alice', trustScore: 1 } })
    );
    const store = createRealChatStore({
      resolveClient: () => ({ } as any),
      randomId: () => 'msg-1',
      now: () => 1234
    });

    store.getState().subscribeToChannel('channel-123');
    const message = {
      id: 'msg-dup',
      schemaVersion: 'hermes-message-v0',
      channelId: 'channel-123',
      sender: 'alice',
      recipient: 'bob',
      timestamp: 1,
      content: 'ciphertext',
      type: 'text',
      signature: 's'
    };
    chatHandlers.forEach((cb) => cb(message));
    chatHandlers.forEach((cb) => cb(message));

    const channelMessages = store.getState().messages.get('channel-123') ?? [];
    expect(channelMessages).toHaveLength(1);
    expect(channelMessages[0].id).toBe('msg-dup');
  });

  it('leaves status pending when a write times out', async () => {
    setIdentity('alice');
    vi.useFakeTimers();
    const timeoutLeaf: any = {
      put: vi.fn(() => {
        /* do not call callback to trigger timeout */
      }),
      get: vi.fn(() => timeoutLeaf)
    };
    mockInbox.get.mockImplementation(() => timeoutLeaf);
    const store = createRealChatStore({ resolveClient: () => ({} as any), randomId: () => 'msg-timeout', now: () => 10 });

    const sending = store.getState().sendMessage('bob', { text: 'hi' }, 'text');
    await vi.runAllTimersAsync();
    await sending;

    expect(store.getState().statuses.get('msg-timeout')).toBe('pending');
  });

  it('marks status failed on write error', async () => {
    setIdentity('alice');
    const errorLeaf: any = {
      put: vi.fn((_value: any, cb?: (ack?: { err?: string }) => void) => cb?.({ err: 'boom' })),
      get: vi.fn(() => errorLeaf)
    };
    mockOutbox.get.mockImplementation(() => errorLeaf);
    const store = createRealChatStore({ resolveClient: () => ({} as any), randomId: () => 'msg-fail', now: () => 10 });

    await expect(store.getState().sendMessage('bob', { text: 'hi' }, 'text')).rejects.toThrow('boom');
    expect(store.getState().statuses.get('msg-fail')).toBe('failed');
  });

  it('skips first contact XP when contact already exists', async () => {
    setIdentity('alice');
    useXpLedger.setState((state) => ({ ...state, firstContacts: new Set(['bob']), socialXP: 0 }));
    const store = createRealChatStore({ resolveClient: () => ({} as any), randomId: () => 'msg-first', now: () => 10 });

    await store.getState().sendMessage('bob', { text: 'hi' }, 'text');

    expect(useXpLedger.getState().socialXP).toBe(0);
  });

  it('awards sustained conversation XP when threshold met', async () => {
    setIdentity('alice');
    const ledger = useXpLedger.getState();
    const spy = vi.spyOn(ledger, 'applyMessagingXP');
    const store = createRealChatStore({ resolveClient: () => ({} as any), randomId: () => 'msg-sustain', now: () => 10 });
    store.setState((state) => ({
      ...state,
      messageStats: new Map(state.messageStats).set('channel-123', { mine: 2, total: 5, awarded: false })
    }));

    await store.getState().sendMessage('bob', { text: 'hi' }, 'text');

    expect(spy).toHaveBeenCalledWith({ type: 'sustained_conversation', channelId: 'channel-123' });
    spy.mockRestore();
  });

  it('subscribeToChannel returns noop when client unavailable', () => {
    setIdentity('alice');
    const store = createRealChatStore({ resolveClient: () => null, randomId: () => 'msg-sub', now: () => 1 });

    const unsubscribe = store.getState().subscribeToChannel('channel-x');

    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(mockChatLeaf.get).not.toHaveBeenCalled();
  });

  it('subscribeToChannel falls back when map is missing', () => {
    setIdentity('alice');
    const chainWithoutMap: any = {
      on: vi.fn((cb: (data?: any) => void) => chatHandlers.push(cb)),
      off: vi.fn((cb: (data?: any) => void) => {
        const idx = chatHandlers.indexOf(cb);
        if (idx >= 0) chatHandlers.splice(idx, 1);
      })
    };
    (getHermesChatChain as any).mockReturnValueOnce(chainWithoutMap);
    const store = createRealChatStore({ resolveClient: () => ({} as any), randomId: () => 'msg-sub2', now: () => 1 });

    const unsub = store.getState().subscribeToChannel('channel-123');

    expect(chainWithoutMap.on).toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
    const handler = chatHandlers[0];
    handler?.({ id: 'm1', channelId: 'channel-123', schemaVersion: 'hermes-message-v0', sender: 'alice', recipient: 'bob', timestamp: 1, content: 'c', type: 'text', signature: 's' });
    expect(store.getState().messages.get('channel-123')?.[0].id).toBe('m1');
    unsub();
  });
});
