import { describe, expect, it } from 'vitest';
import { loadEnvFileFromEnv, parseEnvFile } from './envFile.mjs';

describe('live env file loader', () => {
  it('parses dotenv-style assignments without exposing values', () => {
    expect(parseEnvFile(`
      # comment
      export OPENAI_API_KEY="line\\nkey"
      ANALYSIS_RELAY_API_KEY='relay-key'
      VITE_FLAG=enabled # inline comment
      INVALID-KEY=ignored
    `)).toEqual([
      ['OPENAI_API_KEY', 'line\nkey'],
      ['ANALYSIS_RELAY_API_KEY', 'relay-key'],
      ['VITE_FLAG', 'enabled'],
    ]);
  });

  it('loads ENV_FILE values while preserving explicit process env overrides', () => {
    const env = {
      ENV_FILE: '/release/.env',
      OPENAI_API_KEY: 'already-set',
    };
    const result = loadEnvFileFromEnv({
      env,
      cwd: '/repo',
      exists: (filePath) => filePath === '/release/.env',
      readFile: () => [
        'OPENAI_API_KEY=from-file',
        'ANALYSIS_RELAY_API_KEY=relay-from-file',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      loaded: true,
      path: '/release/.env',
      loadedKeys: ['ANALYSIS_RELAY_API_KEY'],
      skippedKeys: ['OPENAI_API_KEY'],
    });
    expect(env.OPENAI_API_KEY).toBe('already-set');
    expect(env.ANALYSIS_RELAY_API_KEY).toBe('relay-from-file');
  });
});
