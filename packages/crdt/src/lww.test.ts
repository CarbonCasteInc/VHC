import { describe, expect, it } from 'vitest';
import { LamportClock } from './clock';
import { LwwRegister } from './lww';

describe('LwwRegister', () => {
  it('sets and reads latest value', () => {
    const reg = new LwwRegister<string>(new LamportClock());
    reg.set('a');
    expect(reg.read()).toBe('a');
    reg.set('b');
    expect(reg.read()).toBe('b');
  });

  it('merges newer incoming entry', () => {
    const clock = new LamportClock();
    const reg = new LwwRegister<string>(clock);
    const local = reg.set('local');
    const incoming = { value: 'remote', timestamp: local.timestamp + 1n };
    const merged = reg.merge(incoming);
    expect(merged.value).toBe('remote');
    expect(clock.value()).toBeGreaterThan(local.timestamp);
  });

  it('retains newer local entry when incoming is older', () => {
    const clock = new LamportClock();
    const reg = new LwwRegister<string>(clock);
    const local = reg.set('local');
    const incoming = { value: 'remote', timestamp: local.timestamp - 1n };
    const merged = reg.merge(incoming);
    expect(merged.value).toBe('local');
    expect(clock.value()).toBeGreaterThan(local.timestamp);
  });

  it('accepts incoming when empty', () => {
    const clock = new LamportClock();
    const reg = new LwwRegister<string>(clock);
    const incoming = { value: 'remote', timestamp: 5n };
    const merged = reg.merge(incoming);
    expect(merged.value).toBe('remote');
    expect(clock.value()).toBeGreaterThan(0n);
  });
});
