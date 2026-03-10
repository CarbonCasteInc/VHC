export interface ReplayContinuityCounts {
  persistence_observations: number;
  persistence_retained: number;
  persistence_rate: number;
  reappearance_observations: number;
  reappearance_retained: number;
  reappearance_rate: number;
}

interface ReplayContinuityTracker extends Omit<ReplayContinuityCounts, 'persistence_rate' | 'reappearance_rate'> {
  previous_story_by_event: Map<string, string | null>;
  last_present_story_by_event: Map<string, string>;
}

function toRate(retained: number, observations: number): number {
  return Number((retained / Math.max(1, observations)).toFixed(6));
}

export function createReplayContinuityTracker(): ReplayContinuityTracker {
  return {
    previous_story_by_event: new Map<string, string | null>(),
    last_present_story_by_event: new Map<string, string>(),
    persistence_observations: 0,
    persistence_retained: 0,
    reappearance_observations: 0,
    reappearance_retained: 0,
  };
}

export function observeReplayContinuityTick(
  tracker: ReplayContinuityTracker,
  currentStoryByEvent: ReadonlyMap<string, string | null>,
): void {
  const observedEventIds = new Set<string>([
    ...tracker.previous_story_by_event.keys(),
    ...currentStoryByEvent.keys(),
  ]);
  for (const eventId of observedEventIds) {
    const previous = tracker.previous_story_by_event.get(eventId);
    const current = currentStoryByEvent.get(eventId) ?? null;
    const lastPresent = tracker.last_present_story_by_event.get(eventId);
    if (previous !== undefined) {
      tracker.persistence_observations += 1;
      if (previous !== null && current !== null && previous === current) {
        tracker.persistence_retained += 1;
      }
    }
    if (previous === null && current !== null && lastPresent !== undefined) {
      tracker.reappearance_observations += 1;
      if (current === lastPresent) {
        tracker.reappearance_retained += 1;
      }
    }
    if (current !== null) {
      tracker.last_present_story_by_event.set(eventId, current);
    }
    tracker.previous_story_by_event.set(eventId, current);
  }
}

export function summarizeReplayContinuity(tracker: ReplayContinuityTracker): ReplayContinuityCounts {
  return {
    persistence_observations: tracker.persistence_observations,
    persistence_retained: tracker.persistence_retained,
    persistence_rate: toRate(tracker.persistence_retained, tracker.persistence_observations),
    reappearance_observations: tracker.reappearance_observations,
    reappearance_retained: tracker.reappearance_retained,
    reappearance_rate: toRate(tracker.reappearance_retained, tracker.reappearance_observations),
  };
}

export function aggregateReplayContinuity(results: readonly ReplayContinuityCounts[]): ReplayContinuityCounts {
  const persistenceObservations = results.reduce((total, result) => total + result.persistence_observations, 0);
  const persistenceRetained = results.reduce((total, result) => total + result.persistence_retained, 0);
  const reappearanceObservations = results.reduce((total, result) => total + result.reappearance_observations, 0);
  const reappearanceRetained = results.reduce((total, result) => total + result.reappearance_retained, 0);
  return {
    persistence_observations: persistenceObservations,
    persistence_retained: persistenceRetained,
    persistence_rate: toRate(persistenceRetained, persistenceObservations),
    reappearance_observations: reappearanceObservations,
    reappearance_retained: reappearanceRetained,
    reappearance_rate: toRate(reappearanceRetained, reappearanceObservations),
  };
}
