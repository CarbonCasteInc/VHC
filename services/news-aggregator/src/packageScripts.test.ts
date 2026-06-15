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

  it('keeps release evidence and restart liveness as separate source-health scripts', () => {
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['check:source-health']).toContain(
      'VH_NEWS_SOURCE_HEALTH_ENFORCE_RELEASE_EVIDENCE=1',
    );
    expect(packageJson.scripts?.['check:source-health:liveness']).toContain(
      'sourceHealthLivenessReport.js',
    );
    expect(packageJson.scripts?.['check:source-health:liveness']).not.toContain(
      'VH_NEWS_SOURCE_HEALTH_ENFORCE_RELEASE_EVIDENCE=1',
    );
  });
});
