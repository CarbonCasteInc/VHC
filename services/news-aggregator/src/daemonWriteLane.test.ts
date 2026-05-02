import { describe, expect, it, vi } from 'vitest';
import { createDaemonWriteLaneRegistry } from './daemonWriteLane';

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

describe('daemonWriteLane', () => {
  it('bounds concurrent writes per class and records p95 latency', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let now = 1_000;
    let releaseFirst: (() => void) | null = null;
    const lane = createDaemonWriteLaneRegistry({
      logger,
      now: () => now,
      defaultConcurrency: 1,
    });

    const first = lane.run('news_bundle', { story_id: 'story-1' }, () =>
      new Promise<string>((resolve) => {
        releaseFirst = () => resolve('first');
      }),
    );
    const secondTask = vi.fn(async () => 'second');
    const second = lane.run('news_bundle', { story_id: 'story-2' }, secondTask);

    await flushMicrotasks();
    expect(secondTask).not.toHaveBeenCalled();
    expect(lane.snapshot()).toContainEqual(
      expect.objectContaining({
        write_class: 'news_bundle',
        pending_depth: 1,
        in_flight: 1,
      }),
    );

    now += 40;
    releaseFirst?.();
    await expect(first).resolves.toBe('first');
    await flushMicrotasks();
    await expect(second).resolves.toBe('second');

    expect(secondTask).toHaveBeenCalledTimes(1);
    expect(lane.snapshot()).toContainEqual(
      expect.objectContaining({
        write_class: 'news_bundle',
        pending_depth: 0,
        in_flight: 0,
        completed_count: 2,
        failed_count: 0,
        p95_ms: expect.any(Number),
      }),
    );
  });

  it('rejects queued writes when stopped', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const lane = createDaemonWriteLaneRegistry({ logger, defaultConcurrency: 1 });
    const first = lane.run('storyline', {}, () => new Promise(() => undefined));
    const second = lane.run('storyline', {}, async () => 'unreached');

    await flushMicrotasks();
    lane.stop();

    await expect(second).rejects.toThrow('daemon write lane stopped: storyline');
    await expect(lane.run('storyline', {}, async () => 'late')).rejects.toThrow(
      'daemon write lane stopped: storyline',
    );
    void first.catch(() => undefined);
  });
});
