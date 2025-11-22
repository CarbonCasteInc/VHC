import { describe, expect, it } from 'vitest';
import { LamportClock } from './clock';

describe('LamportClock', () => {
  it('ticks forward', () => {
    const clock = new LamportClock();
    expect(clock.value()).toBe(0n);
    expect(clock.tick()).toBe(1n);
    expect(clock.value()).toBe(1n);
  });

  it('merges and advances to max+1', () => {
    const clock = new LamportClock(5n);
    expect(clock.merge(10)).toBe(11n);
    expect(clock.value()).toBe(11n);
    expect(clock.merge(1)).toBe(12n);
  });
});
