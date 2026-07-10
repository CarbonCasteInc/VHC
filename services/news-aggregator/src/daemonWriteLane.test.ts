import { describe, expect, it, vi } from 'vitest';
import { createDaemonWriteLaneRegistry } from './daemonWriteLane';
import { PRODUCT_FEED_REPAIR_WRITE_LANE_CONCURRENCY } from './productFeedReconciler';

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

  it('uses predicate stop policy so optional classes keep accepting writes after failures', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const lane = createDaemonWriteLaneRegistry({
      logger,
      defaultConcurrency: 1,
      stopClassOnFailure: (writeClass) => writeClass === 'news_bundle',
    });

    await expect(
      lane.run('storyline', { storyline_id: 'storyline-1' }, async () => {
        throw new Error('storyline write timed out');
      }),
    ).rejects.toThrow('storyline write timed out');
    await expect(
      lane.run('storyline', { storyline_id: 'storyline-2' }, async () => 'optional-later'),
    ).resolves.toBe('optional-later');

    await expect(
      lane.run('news_bundle', { story_id: 'story-1' }, async () => {
        throw new Error('relay quorum failed');
      }),
    ).rejects.toThrow('relay quorum failed');
    await expect(
      lane.run('news_bundle', { story_id: 'story-2' }, async () => 'blocked'),
    ).rejects.toThrow('daemon write lane stopped after failure: news_bundle');

    expect(lane.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          write_class: 'storyline',
          stopped: false,
          failed_count: 1,
          completed_count: 1,
        }),
        expect.objectContaining({
          write_class: 'news_bundle',
          stopped: true,
          failed_count: 1,
        }),
      ]),
    );
  });

  it('documents Scope B accepted lifecycle writes sharing the fatal raw pending class until lane split', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const lane = createDaemonWriteLaneRegistry({
      logger,
      defaultConcurrency: 1,
      stopClassOnFailure: (writeClass) => writeClass === 'news_synthesis_lifecycle',
    });

    await expect(
      lane.run('news_synthesis_lifecycle', { story_id: 'accepted-story', caller: 'accepted_synthesis' }, async () => {
        throw new Error('accepted lifecycle quorum failed');
      }),
    ).rejects.toThrow('accepted lifecycle quorum failed');

    await expect(
      lane.run('news_synthesis_lifecycle', { story_id: 'raw-story', caller: 'raw_pending_lifecycle' }, async () => 'raw'),
    ).rejects.toThrow('daemon write lane stopped after failure: news_synthesis_lifecycle');

    expect(lane.snapshot()).toContainEqual(
      expect.objectContaining({
        write_class: 'news_synthesis_lifecycle',
        stopped: true,
        failed_count: 1,
      }),
    );
  });

  it('propagates the transport-total brand onto lane-stopped rejections so the fail-close exit code survives', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const lane = createDaemonWriteLaneRegistry({
      logger,
      defaultConcurrency: 1,
      stopClassOnFailure: (writeClass) => writeClass === 'news_bundle',
    });
    const brandedTransportTotal = Object.assign(
      new Error('Relay REST news write failed for /vh/news/hot-index: 0/3 succeeded; required=2'),
      { relayRestTransportTotalFailure: true },
    );

    let releaseFailingWrite: (() => void) | null = null;
    const failingWrite = lane.run('news_bundle', { story_id: 'story-a' }, () =>
      new Promise<never>((_resolve, reject) => {
        releaseFailingWrite = () => reject(brandedTransportTotal);
      }));
    // Queue a pending write behind the failing one (concurrency 1) so the
    // stop path rejects it while it is still pending.
    const pendingWrite = lane.run('news_bundle', { story_id: 'story-b' }, async () => 'unreachable');
    while (!releaseFailingWrite) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    releaseFailingWrite();

    const failingError = await failingWrite.then(() => null, (error: unknown) => error);
    const pendingError = await pendingWrite.then(() => null, (error: unknown) => error);
    expect((failingError as { relayRestTransportTotalFailure?: unknown }).relayRestTransportTotalFailure).toBe(true);
    expect(pendingError).toBeInstanceOf(Error);
    expect((pendingError as Error).message).toContain('daemon write lane stopped after failure: news_bundle');
    expect((pendingError as { relayRestTransportTotalFailure?: unknown }).relayRestTransportTotalFailure).toBe(true);
    expect(
      (pendingError as { relayRestAvailabilityTotalFailure?: unknown }).relayRestAvailabilityTotalFailure,
    ).toBe(true);

    // Later writes on the stopped lane carry the brand too: a restart is the
    // correct recovery for a lane stopped by a transport-total event.
    const laterError = await lane
      .run('news_bundle', { story_id: 'story-c' }, async () => 'unreachable')
      .then(() => null, (error: unknown) => error);
    expect((laterError as { relayRestTransportTotalFailure?: unknown }).relayRestTransportTotalFailure).toBe(true);
    expect(
      (laterError as { relayRestAvailabilityTotalFailure?: unknown }).relayRestAvailabilityTotalFailure,
    ).toBe(true);

    // A lane stopped by a NON-transport failure keeps plain rejections.
    const plainLane = createDaemonWriteLaneRegistry({
      logger,
      defaultConcurrency: 1,
      stopClassOnFailure: () => true,
    });
    await expect(
      plainLane.run('news_bundle', { story_id: 'story-d' }, async () => {
        throw new Error('relay returned 500');
      }),
    ).rejects.toThrow('relay returned 500');
    const plainStopError = await plainLane
      .run('news_bundle', { story_id: 'story-e' }, async () => 'unreachable')
      .then(() => null, (error: unknown) => error);
    expect((plainStopError as { relayRestTransportTotalFailure?: unknown }).relayRestTransportTotalFailure).toBeUndefined();
    expect(
      (plainStopError as { relayRestAvailabilityTotalFailure?: unknown }).relayRestAvailabilityTotalFailure,
    ).toBeUndefined();
  });

  it('propagates the availability-total brand without relabeling deadline failures as legacy transport-total', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const lane = createDaemonWriteLaneRegistry({
      logger,
      defaultConcurrency: 1,
      stopClassOnFailure: (writeClass) => writeClass === 'news_bundle',
    });
    const availabilityTotal = Object.assign(
      new Error('Relay REST deadline availability-total after signed readback'),
      { relayRestAvailabilityTotalFailure: true },
    );
    let rejectFirst: ((error: Error) => void) | null = null;
    const first = lane.run('news_bundle', {}, () => new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    }));
    const pending = lane.run('news_bundle', {}, async () => 'unreachable');
    while (!rejectFirst) {
      await flushMicrotasks();
    }
    rejectFirst(availabilityTotal);

    await expect(first).rejects.toBe(availabilityTotal);
    const pendingError = await pending.then(() => null, (error: unknown) => error);
    expect(
      (pendingError as { relayRestAvailabilityTotalFailure?: unknown }).relayRestAvailabilityTotalFailure,
    ).toBe(true);
    expect(
      (pendingError as { relayRestTransportTotalFailure?: unknown }).relayRestTransportTotalFailure,
    ).toBeUndefined();

    const laterError = await lane.run('news_bundle', {}, async () => 'unreachable')
      .then(() => null, (error: unknown) => error);
    expect(
      (laterError as { relayRestAvailabilityTotalFailure?: unknown }).relayRestAvailabilityTotalFailure,
    ).toBe(true);
    expect(
      (laterError as { relayRestTransportTotalFailure?: unknown }).relayRestTransportTotalFailure,
    ).toBeUndefined();
  });

  it('paces product-feed repair writes with dedicated concurrency-one lanes', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let releaseFirstRepair: (() => void) | null = null;
    const lane = createDaemonWriteLaneRegistry({
      logger,
      defaultConcurrency: 10,
      classConcurrency: PRODUCT_FEED_REPAIR_WRITE_LANE_CONCURRENCY,
      stopClassOnFailure: (writeClass) => writeClass === 'news_synthesis_lifecycle',
    });

    const firstRepair = lane.run('product_feed_repair_lifecycle', { story_id: 'story-1' }, () =>
      new Promise<string>((resolve) => {
        releaseFirstRepair = () => resolve('first-repair');
      }),
    );
    const secondRepairTask = vi.fn(async () => 'second-repair');
    const secondRepair = lane.run('product_feed_repair_lifecycle', { story_id: 'story-2' }, secondRepairTask);
    const rawPendingLifecycle = lane.run('news_synthesis_lifecycle', { story_id: 'raw-story' }, async () => 'raw');

    await flushMicrotasks();

    expect(secondRepairTask).not.toHaveBeenCalled();
    await expect(rawPendingLifecycle).resolves.toBe('raw');
    expect(lane.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          write_class: 'product_feed_repair_lifecycle',
          pending_depth: 1,
          in_flight: 1,
          stopped: false,
        }),
        expect.objectContaining({
          write_class: 'news_synthesis_lifecycle',
          stopped: false,
        }),
      ]),
    );

    releaseFirstRepair?.();
    await expect(firstRepair).resolves.toBe('first-repair');
    await flushMicrotasks();
    await expect(secondRepair).resolves.toBe('second-repair');

    expect(secondRepairTask).toHaveBeenCalledTimes(1);
    expect(lane.snapshot()).toContainEqual(
      expect.objectContaining({
        write_class: 'product_feed_repair_lifecycle',
        pending_depth: 0,
        in_flight: 0,
        completed_count: 2,
      }),
    );
  });
});
