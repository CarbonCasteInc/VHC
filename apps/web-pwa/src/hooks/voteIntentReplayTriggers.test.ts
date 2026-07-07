/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPendingIntentsMock, scheduleReplayMock } = vi.hoisted(() => ({
  getPendingIntentsMock: vi.fn(),
  scheduleReplayMock: vi.fn(),
}));

vi.mock('./voteIntentQueue', () => ({
  getPendingIntents: (...a: unknown[]) => getPendingIntentsMock(...(a as [])),
}));

vi.mock('./voteIntentMaterializer', () => ({
  scheduleVoteIntentReplay: (...a: unknown[]) => scheduleReplayMock(...(a as [])),
}));

import { installVoteIntentReplayTriggers } from './voteIntentReplayTriggers';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('installVoteIntentReplayTriggers', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    getPendingIntentsMock.mockReturnValue([]);
    setVisibility('visible');
  });

  afterEach(() => {
    uninstall();
  });

  it('is a no-op returning a safe uninstall when window is unavailable (SSR)', () => {
    getPendingIntentsMock.mockReturnValue([{ intent_id: 'a' }]);
    vi.stubGlobal('window', undefined);
    try {
      const uninstallSSR = installVoteIntentReplayTriggers();
      expect(scheduleReplayMock).not.toHaveBeenCalled();
      expect(() => uninstallSSR()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    uninstall = () => {};
  });

  it('drains on startup only when intents are pending', () => {
    getPendingIntentsMock.mockReturnValue([{ intent_id: 'a' }]);
    uninstall = installVoteIntentReplayTriggers();
    expect(scheduleReplayMock).toHaveBeenCalledTimes(1);
  });

  it('does not drain on startup when the queue is empty', () => {
    getPendingIntentsMock.mockReturnValue([]);
    uninstall = installVoteIntentReplayTriggers();
    expect(scheduleReplayMock).not.toHaveBeenCalled();
  });

  it('drains when connectivity returns', () => {
    uninstall = installVoteIntentReplayTriggers();
    scheduleReplayMock.mockClear();
    getPendingIntentsMock.mockReturnValue([{ intent_id: 'a' }]);
    window.dispatchEvent(new Event('online'));
    expect(scheduleReplayMock).toHaveBeenCalledTimes(1);
  });

  it('drains when a backgrounded tab becomes visible, not when hidden', () => {
    uninstall = installVoteIntentReplayTriggers();
    scheduleReplayMock.mockClear();
    getPendingIntentsMock.mockReturnValue([{ intent_id: 'a' }]);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(scheduleReplayMock).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(scheduleReplayMock).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when installed more than once', () => {
    getPendingIntentsMock.mockReturnValue([{ intent_id: 'a' }]);
    uninstall = installVoteIntentReplayTriggers();
    const secondUninstall = installVoteIntentReplayTriggers();

    expect(secondUninstall).toBe(uninstall);
    expect(scheduleReplayMock).toHaveBeenCalledTimes(1);

    scheduleReplayMock.mockClear();
    window.dispatchEvent(new Event('online'));
    expect(scheduleReplayMock).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners on uninstall', () => {
    const install = installVoteIntentReplayTriggers();
    scheduleReplayMock.mockClear();
    install();
    getPendingIntentsMock.mockReturnValue([{ intent_id: 'a' }]);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(scheduleReplayMock).not.toHaveBeenCalled();
    uninstall = () => {};
  });
});
