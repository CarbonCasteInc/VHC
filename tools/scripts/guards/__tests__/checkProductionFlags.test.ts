import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../checkProductionFlags';

const scriptPath = fileURLToPath(new URL('../checkProductionFlags.ts', import.meta.url));
const originalEnv = { ...process.env };
const originalArgv = [...process.argv];
const originalCwd = process.cwd();

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value as string;
  }
};

describe.sequential('checkProductionFlags', () => {
  afterEach(() => {
    process.argv = [...originalArgv];
    process.chdir(originalCwd);
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('passes in production with real proof and e2e false', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = run(
      ['node', 'script', '--production'],
      { VITE_CONSTITUENCY_PROOF_REAL: 'true', VITE_E2E_MODE: 'false' },
    );

    expect(ok).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('fails in production when proof is false', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = run(
      ['node', 'script'],
      { NODE_ENV: 'production', VITE_CONSTITUENCY_PROOF_REAL: 'false', VITE_E2E_MODE: 'false' },
    );

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('fails in production when proof is unset', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = run(
      ['node', 'script'],
      { NODE_ENV: 'production', VITE_E2E_MODE: 'false' },
    );

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('VITE_CONSTITUENCY_PROOF_REAL'));
  });

  it('fails in production when e2e mode is true', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = run(
      ['node', 'script'],
      { NODE_ENV: 'production', VITE_CONSTITUENCY_PROOF_REAL: 'true', VITE_E2E_MODE: 'true' },
    );

    expect(ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('VITE_E2E_MODE'));
  });

  it('warns in non-production when flags are invalid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = run(
      ['node', 'script'],
      { NODE_ENV: 'development', VITE_CONSTITUENCY_PROOF_REAL: 'false', VITE_E2E_MODE: 'true' },
    );

    expect(ok).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('passes in non-production when flags are valid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = run(
      ['node', 'script'],
      { NODE_ENV: 'development', VITE_CONSTITUENCY_PROOF_REAL: 'true', VITE_E2E_MODE: 'false' },
    );

    expect(ok).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('uses process.env when env files are missing', () => {
    const temp = mkdtempSync(join(tmpdir(), 'guard-'));
    process.chdir(temp);
    process.argv = ['node', 'script'];
    process.env.NODE_ENV = 'production';
    process.env.VITE_CONSTITUENCY_PROOF_REAL = 'true';
    process.env.VITE_E2E_MODE = 'false';

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(run()).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();

    rmSync(temp, { recursive: true, force: true });
  });

  it('loads env files and auto-runs when invoked directly', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'guard-'));
    process.chdir(temp);
    writeFileSync(
      join(temp, '.env'),
      '# comment\nINVALID LINE\nVITE_CONSTITUENCY_PROOF_REAL=false\n',
    );
    writeFileSync(
      join(temp, '.env.production'),
      'export VITE_CONSTITUENCY_PROOF_REAL="true"\nVITE_E2E_MODE=\'false\'\n',
    );

    delete process.env.VITE_CONSTITUENCY_PROOF_REAL;
    delete process.env.VITE_E2E_MODE;
    delete process.env.NODE_ENV;
    process.argv = ['node', scriptPath, '--production'];

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.resetModules();
    await import(pathToFileURL(scriptPath).href);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    rmSync(temp, { recursive: true, force: true });
  });
});
