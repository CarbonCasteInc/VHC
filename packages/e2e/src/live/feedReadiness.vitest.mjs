import { describe, expect, it, vi } from 'vitest';
import { confirmStableMinimumCount, nudgeFeed, waitForMinimumCount } from './feedReadiness';

function createLocator(options = {}) {
  const locator = {
    count: vi.fn().mockResolvedValue(options.count ?? 0),
    click: vi.fn().mockResolvedValue(undefined),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    getByRole: vi.fn(),
    first: vi.fn(() => locator),
  };
  locator.getByRole.mockImplementation(() => options.roleLocator ?? createLocator());
  return locator;
}

function createPage(options = {}) {
  const promptRoleLocator = createLocator({ count: options.loadNowCount ?? 0 });
  const promptLocator = createLocator({
    count: options.promptCount ?? 0,
    roleLocator: promptRoleLocator,
  });
  const refreshLocator = createLocator({ count: options.refreshCount ?? 0 });
  const sentinelLocator = createLocator({ count: options.sentinelCount ?? 0 });
  const locators = new Map([
    ['feed-refresh-prompt', promptLocator],
    ['feed-refresh-button', refreshLocator],
    ['feed-load-sentinel', sentinelLocator],
  ]);
  return {
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    getByTestId: vi.fn((testId) => locators.get(testId) ?? createLocator()),
    _locators: { promptLocator, promptRoleLocator, refreshLocator, sentinelLocator },
  };
}

describe('feedReadiness', () => {
  it('nudges the feed through deferred load, refresh, and sentinel scroll when available', async () => {
    const page = createPage({
      promptCount: 1,
      loadNowCount: 1,
      refreshCount: 1,
      sentinelCount: 1,
    });

    await nudgeFeed(page);

    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page._locators.promptRoleLocator.click).toHaveBeenCalledTimes(3);
    expect(page._locators.refreshLocator.click).toHaveBeenCalledOnce();
    expect(page._locators.sentinelLocator.scrollIntoViewIfNeeded).toHaveBeenCalledOnce();
  });

  it('skips optional feed nudges when prompt, refresh button, and sentinel are absent', async () => {
    const page = createPage();

    await nudgeFeed(page);

    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page._locators.promptRoleLocator.click).not.toHaveBeenCalled();
    expect(page._locators.refreshLocator.click).not.toHaveBeenCalled();
    expect(page._locators.sentinelLocator.scrollIntoViewIfNeeded).not.toHaveBeenCalled();
  });

  it('does not click load-now when the refresh prompt is present without the action button', async () => {
    const page = createPage({ promptCount: 1, loadNowCount: 0 });

    await nudgeFeed(page);

    expect(page._locators.promptRoleLocator.click).not.toHaveBeenCalled();
  });

  it('waits for an explicit final settle window when requested', async () => {
    const page = createPage({ refreshCount: 1 });

    await nudgeFeed(page, { finalSettleMs: 400 });

    expect(page.waitForTimeout).toHaveBeenCalledWith(400);
  });

  it('requires the feed count to remain above the minimum across the settle window', async () => {
    const counts = [3, 3, 0];
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const stable = await confirmStableMinimumCount(
      async () => counts.shift() ?? 0,
      3,
      waitForTimeout,
    );

    expect(stable).toBe(false);
    expect(waitForTimeout).toHaveBeenCalledTimes(2);
  });

  it('accepts the feed count when it stays above the minimum after settling', async () => {
    const counts = [3, 4, 3];
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const stable = await confirmStableMinimumCount(
      async () => counts.shift() ?? 0,
      3,
      waitForTimeout,
    );

    expect(stable).toBe(true);
    expect(waitForTimeout).toHaveBeenCalledTimes(2);
  });

  it('does not settle when the initial count is already below the minimum', async () => {
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const stable = await confirmStableMinimumCount(
      async () => 2,
      3,
      waitForTimeout,
    );

    expect(stable).toBe(false);
    expect(waitForTimeout).not.toHaveBeenCalled();
  });

  it('stops settling immediately when a middle sample dips below the minimum', async () => {
    const counts = [3, 2];
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);

    const stable = await confirmStableMinimumCount(
      async () => counts.shift() ?? 0,
      3,
      waitForTimeout,
    );

    expect(stable).toBe(false);
    expect(waitForTimeout).toHaveBeenCalledOnce();
  });

  it('returns once the minimum count remains stable after an initial shortfall', async () => {
    const page = createPage({ refreshCount: 1 });
    const counts = [0, 0, 3, 3, 3];

    const stableCount = await waitForMinimumCount({
      page,
      minCount: 3,
      timeoutMs: 5_000,
      readCount: async () => counts.shift() ?? 3,
    });

    expect(stableCount).toBe(3);
    expect(page._locators.refreshLocator.click).toHaveBeenCalled();
  });

  it('times out with the last observed count when the minimum never stabilizes', async () => {
    const page = createPage();

    await expect(waitForMinimumCount({
      page,
      minCount: 3,
      timeoutMs: 0,
      readCount: async () => 0,
    })).rejects.toThrow('feed-count-timeout:0/3');
  });
});
