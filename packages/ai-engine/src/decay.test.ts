
import { describe, it, expect, vi } from 'vitest';
import { applyDecay, calculateDecay, getDecayState, type CivicInteraction } from './decay';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('civic decay', () => {
  it('creates new decay entry on first interaction', () => {
    const storage = new MemoryStorage();
    const interaction: CivicInteraction = { topicId: 'topic', weight: 2, timestamp: 1 };
    const state = applyDecay(interaction, storage);
    expect(state.weight).toBe(2);
    expect(state.interactions).toBe(1);
    expect(getDecayState(storage).topic).toEqual(state);
  });

  it('halves prior weight and accumulates new weight', () => {
    const storage = new MemoryStorage();
    const first = applyDecay({ topicId: 'topic', weight: 4, timestamp: 1 }, storage);
    expect(first.weight).toBe(4);

    const second = applyDecay({ topicId: 'topic', weight: 2, timestamp: 2 }, storage);
    expect(second.weight).toBe(4); // 4/2 + 2
    expect(second.interactions).toBe(2);

    const third = applyDecay({ topicId: 'topic', weight: 1, timestamp: 3 }, storage);
    expect(third.weight).toBe(3); // 4/2 +1
    expect(third.interactions).toBe(3);
    expect(third.lastUpdated).toBe(3);
  });

  it('persists and reloads state', () => {
    const storage = new MemoryStorage();
    applyDecay({ topicId: 'topic', weight: 1, timestamp: 1 }, storage);
    const persisted = getDecayState(storage);
    expect(Object.keys(persisted)).toContain('topic');
    expect(persisted.topic.weight).toBe(1);
  });

  it('returns empty state if storage read fails', () => {
    const storage = {
      getItem: () => {
        throw new Error('broken');
      },
      setItem: () => { }
    };
    expect(getDecayState(storage as any)).toEqual({});
  });

  it('applies asymptotic decay without exceeding 2.0', () => {
    const first = calculateDecay(0.5, 1);
    expect(first).toBeLessThanOrEqual(2);
    const many = calculateDecay(first, 10);
    expect(many).toBeLessThanOrEqual(2);
  });

  it('should cap decay at 2.0', () => {
    // Start at 3.0, should clamp to 2.0
    const result = calculateDecay(3.0, 1);
    expect(result).toBe(2.0);
  });

  it('should handle storage errors gracefully', () => {
    const mockStorage = {
      getItem: () => '{ invalid json }',
      setItem: vi.fn()
    };
    const state = getDecayState(mockStorage);
    expect(state).toEqual({});
  });

  it('monotonically increases with more interactions', () => {
    const a = calculateDecay(0.2, 1);
    const b = calculateDecay(0.2, 2);
    expect(b).toBeGreaterThan(a);
  });
});
