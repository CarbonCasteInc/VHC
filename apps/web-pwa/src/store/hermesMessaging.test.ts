import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRealChatStore } from './hermesMessaging';

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
});

describe('hermesMessaging store', () => {
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
});
