import { describe, expect, it, vi } from 'vitest';
import { feedBridgeRefreshInternal, runRefreshLatestWithRetry } from './feedBridgeRefresh';

describe('feedBridgeRefreshInternal.readBridgeNumber', () => {
  it('returns a floored env number when it meets the minimum', () => {
    vi.stubEnv('VH_TEST_BRIDGE_NUMBER', '42.8');

    expect(feedBridgeRefreshInternal.readBridgeNumber(['VH_TEST_BRIDGE_NUMBER'], 10, 5)).toBe(42);
  });

  it('falls back when the env value is invalid or below the minimum', () => {
    vi.stubEnv('VH_TEST_BRIDGE_INVALID', 'not-a-number');
    vi.stubEnv('VH_TEST_BRIDGE_SMALL', '2');

    expect(feedBridgeRefreshInternal.readBridgeNumber(['VH_TEST_BRIDGE_INVALID'], 10, 5)).toBe(10);
    expect(feedBridgeRefreshInternal.readBridgeNumber(['VH_TEST_BRIDGE_SMALL'], 10, 5)).toBe(10);
  });

  it('coerces non-Error refresh failures into Error instances', async () => {
    await expect(
      runRefreshLatestWithRetry({
        refreshLatest: vi.fn().mockRejectedValue('bridge-failed'),
      }),
    ).rejects.toThrow('bridge-failed');
  });
});
