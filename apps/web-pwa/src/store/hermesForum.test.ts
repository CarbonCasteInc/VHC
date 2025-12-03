import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createForumStore } from './hermesForum';

const threadWrites: any[] = [];
const commentWrites: any[] = [];

const threadChain = {
  put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
    threadWrites.push(value);
    cb?.({});
  })
} as any;

const commentsChain = {
  get: vi.fn(() => commentsChain),
  put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
    commentWrites.push(value);
    cb?.({});
  })
} as any;

vi.mock('@vh/gun-client', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    getForumThreadChain: vi.fn(() => threadChain),
    getForumCommentsChain: vi.fn(() => commentsChain),
    getForumDateIndexChain: vi.fn(() => ({ put: vi.fn() })),
    getForumTagIndexChain: vi.fn(() => ({ put: vi.fn() }))
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
  threadWrites.length = 0;
  commentWrites.length = 0;
  threadChain.put.mockClear();
  commentsChain.put.mockClear();
  commentsChain.get.mockClear();
});

describe('hermesForum store', () => {
  it('rejects thread creation when trustScore is low', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier: 'low', trustScore: 0.2 } })
    );
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-1', now: () => 1 });
    await expect(store.getState().createThread('title', 'content', [])).rejects.toThrow(
      'Insufficient trustScore for forum actions'
    );
  });

  it('vote is idempotent per target', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier: 'alice', trustScore: 1 } })
    );
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-1', now: () => 1 });
    const thread = await store.getState().createThread('title', 'content', ['tag']);
    expect(threadWrites).toHaveLength(1);
    await store.getState().vote(thread.id, 'up');
    await store.getState().vote(thread.id, 'up');
    const updated = store.getState().threads.get(thread.id)!;
    expect(updated.upvotes).toBe(1);
    expect(updated.downvotes).toBe(0);
  });
});
