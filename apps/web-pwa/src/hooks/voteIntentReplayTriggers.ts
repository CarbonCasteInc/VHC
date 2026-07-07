import { getPendingIntents } from './voteIntentQueue';
import { scheduleVoteIntentReplay } from './voteIntentMaterializer';

let installedUninstall: (() => void) | null = null;

/**
 * App-lifecycle drain triggers for the durable vote-intent queue.
 *
 * Without these, a queued intent only ever materializes when the user casts
 * *another* vote (the sole caller of `scheduleVoteIntentReplay`) — so a vote
 * cast offline, or one whose first replay failed, could sit in localStorage
 * indefinitely, violating the durable-enqueue contract ("admitted → materialize
 * or surface failure"). Installing these at bootstrap drains on startup, when
 * connectivity returns, and when a backgrounded tab becomes visible again.
 *
 * Draining is gated on there being pending intents so an empty queue produces
 * no replay work or log noise. `scheduleVoteIntentReplay` is itself idempotent
 * (it no-ops while a replay is in flight), so overlapping triggers are safe.
 */
export function installVoteIntentReplayTriggers(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  if (installedUninstall) {
    return installedUninstall;
  }

  const drainIfPending = (): void => {
    if (getPendingIntents().length > 0) {
      scheduleVoteIntentReplay();
    }
  };

  const onOnline = (): void => drainIfPending();
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      drainIfPending();
    }
  };

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  // Initial drain for intents left pending by a prior session.
  drainIfPending();

  installedUninstall = () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    installedUninstall = null;
  };

  return installedUninstall;
}
