import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGunTimeoutMs } from './runtimeConfig';

const PROCESS_ENV = process.env;

function clearEnv(name: string): void {
  delete process.env[name];
}

describe('runtimeConfig', () => {
  afterEach(() => {
    process.env = PROCESS_ENV;
    vi.unstubAllEnvs();
    delete (globalThis as { __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> }).__VH_GUN_CLIENT_CONFIG__;
    delete (globalThis as { __VH_IMPORT_META_ENV__?: Record<string, unknown> }).__VH_IMPORT_META_ENV__;
  });

  it('returns fallback when no names resolve', () => {
    clearEnv('VH_TIMEOUT_A');
    clearEnv('VH_TIMEOUT_B');

    expect(readGunTimeoutMs(['VH_TIMEOUT_A', 'VH_TIMEOUT_B'], 2500)).toBe(2500);
  });

  it('prefers the first resolved name and trims values', () => {
    process.env.VH_TIMEOUT_A = ' 6000 ';
    process.env.VH_TIMEOUT_B = '7000';

    expect(readGunTimeoutMs(['VH_TIMEOUT_A', 'VH_TIMEOUT_B'], 2500)).toBe(6000);
  });

  it('falls back when value is empty/invalid and enforces minimum floor', () => {
    process.env.VH_TIMEOUT_A = '   ';
    process.env.VH_TIMEOUT_B = 'not-a-number';
    expect(readGunTimeoutMs(['VH_TIMEOUT_A', 'VH_TIMEOUT_B'], 2500)).toBe(2500);

    process.env.VH_TIMEOUT_A = '-1';
    expect(readGunTimeoutMs(['VH_TIMEOUT_A'], 2500)).toBe(2500);

    process.env.VH_TIMEOUT_A = '1';
    expect(readGunTimeoutMs(['VH_TIMEOUT_A'], 2500, 250)).toBe(250);

    process.env.VH_TIMEOUT_A = '1000.9';
    expect(readGunTimeoutMs(['VH_TIMEOUT_A'], 2500, 250)).toBe(1000);
  });

  it('reads from global config when process env is unavailable for a name', () => {
    clearEnv('VH_TIMEOUT_GLOBAL');
    (globalThis as { __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> }).__VH_GUN_CLIENT_CONFIG__ = {
      VH_TIMEOUT_GLOBAL: ' 4800 ',
    };

    expect(readGunTimeoutMs(['VH_TIMEOUT_GLOBAL'], 2500)).toBe(4800);
  });

  it('ignores non-string global values and keeps fallback', () => {
    (globalThis as { __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> }).__VH_GUN_CLIENT_CONFIG__ = {
      VH_TIMEOUT_GLOBAL: 1234,
    };

    expect(readGunTimeoutMs(['VH_TIMEOUT_GLOBAL'], 2500)).toBe(2500);
  });

  it('supports import-meta env values via stubbed env', () => {
    vi.stubEnv('VH_TIMEOUT_IMPORT_META', '3300');
    expect(readGunTimeoutMs(['VH_TIMEOUT_IMPORT_META'], 2500)).toBe(3300);
  });

  it('prefers import-meta override over process and global values', () => {
    process.env.VH_TIMEOUT_PRECEDENCE = '3600';
    (globalThis as { __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> }).__VH_GUN_CLIENT_CONFIG__ = {
      VH_TIMEOUT_PRECEDENCE: '3700',
    };
    (globalThis as { __VH_IMPORT_META_ENV__?: Record<string, unknown> }).__VH_IMPORT_META_ENV__ = {
      VH_TIMEOUT_PRECEDENCE: '3500',
    };

    expect(readGunTimeoutMs(['VH_TIMEOUT_PRECEDENCE'], 2500)).toBe(3500);
  });

  it('falls through blank import-meta override to process env and global config', () => {
    process.env.VH_TIMEOUT_FALLTHROUGH = '3900';
    (globalThis as { __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> }).__VH_GUN_CLIENT_CONFIG__ = {
      VH_TIMEOUT_FALLTHROUGH_GLOBAL: '4100',
    };
    (globalThis as { __VH_IMPORT_META_ENV__?: Record<string, unknown> }).__VH_IMPORT_META_ENV__ = {
      VH_TIMEOUT_FALLTHROUGH: '   ',
      VH_TIMEOUT_FALLTHROUGH_GLOBAL: '   ',
    };

    expect(readGunTimeoutMs(['VH_TIMEOUT_FALLTHROUGH'], 2500)).toBe(3900);
    expect(readGunTimeoutMs(['VH_TIMEOUT_FALLTHROUGH_GLOBAL'], 2500)).toBe(4100);
  });
});
