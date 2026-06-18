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

  it('stops only the failed write class when configured fail-closed', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let rejectFirst: ((error: Error) => void) | null = null;
    const lane = createDaemonWriteLaneRegistry({
      logger,
      defaultConcurrency: 1,
      stopClassOnFailure: true,
    });

    const first = lane.run('news_bundle', { story_id: 'story-1' }, () =>
      new Promise((_resolve, reject) => {
        rejectFirst = reject;
      }),
    );
    const secondTask = vi.fn(async () => 'second');
    const second = lane.run('news_bundle', { story_id: 'story-2' }, secondTask);
    const lease = lane.run('lease', { operation: 'release' }, async () => 'released');

    await flushMicrotasks();
    rejectFirst?.(new Error('relay require-all failed'));

    await expect(first).rejects.toThrow('relay require-all failed');
    await expect(second).rejects.toThrow('daemon write lane stopped after failure: news_bundle');
    await expect(lease).resolves.toBe('released');
    await expect(lane.run('news_bundle', { story_id: 'story-3' }, async () => 'late')).rejects.toThrow(
      'daemon write lane stopped after failure: news_bundle',
    );

    expect(secondTask).not.toHaveBeenCalled();
    expect(lane.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          write_class: 'news_bundle',
          stopped: true,
          failed_count: 1,
          pending_depth: 0,
        }),
        expect.objectContaining({
          write_class: 'lease',
          stopped: false,
          completed_count: 1,
        }),
      ]),
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[vh:news-daemon] write lane stopped after failure',
      expect.objectContaining({
        write_class: 'news_bundle',
        rejected_pending_count: 1,
      }),
    );
  });
});
