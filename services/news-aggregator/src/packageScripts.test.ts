import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package scripts', () => {
  it('builds the LUMA SDK before gun-client for daemon runtime imports', () => {
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const buildScript = packageJson.scripts?.['build:source-health-deps'];

    expect(buildScript).toContain('pnpm --filter @vh/luma-sdk build');
    expect(buildScript).toContain('pnpm --filter @vh/gun-client build');
    expect(buildScript?.indexOf('@vh/luma-sdk')).toBeLessThan(buildScript?.indexOf('@vh/gun-client'));
  });
});
