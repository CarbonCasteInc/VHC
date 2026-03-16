import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyNewsSourceHealthEnv,
  findLatestNewsSourceHealthReportPath,
  resolveNewsSourceHealthArtifactRoot,
  resolveNewsSourceHealthEnv,
} from './newsSourceHealthEnv';

function makeAppRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-news-health-env-'));
  const appRoot = path.join(root, 'apps', 'web-pwa');
  mkdirSync(path.join(appRoot, '../../services/news-aggregator/.tmp/news-source-admission'), {
    recursive: true,
  });
  return appRoot;
}

describe('newsSourceHealthEnv', () => {
  const originalReportJson = process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_JSON;
  const originalReportSource = process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_SOURCE;
  const originalReportPath = process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_PATH;

  afterEach(() => {
    if (typeof originalReportJson === 'undefined') {
      delete process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_JSON;
    } else {
      process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_JSON = originalReportJson;
    }
    if (typeof originalReportSource === 'undefined') {
      delete process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_SOURCE;
    } else {
      process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_SOURCE = originalReportSource;
    }
    if (typeof originalReportPath === 'undefined') {
      delete process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_PATH;
    } else {
      process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_PATH = originalReportPath;
    }
  });

  it('prefers the stable latest artifact path when present', () => {
    const appRoot = makeAppRoot();
    const latestPath = path.join(
      resolveNewsSourceHealthArtifactRoot(appRoot),
      'latest',
      'source-health-report.json',
    );
    mkdirSync(path.dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, '{"ok":true}\n', 'utf8');

    expect(findLatestNewsSourceHealthReportPath({ appRoot, env: {} })).toBe(latestPath);
  });

  it('falls back to the newest timestamped artifact when latest is absent', () => {
    const appRoot = makeAppRoot();
    const artifactRoot = resolveNewsSourceHealthArtifactRoot(appRoot);
    const olderPath = path.join(artifactRoot, '100', 'source-health-report.json');
    const newerPath = path.join(artifactRoot, '200', 'source-health-report.json');
    mkdirSync(path.dirname(olderPath), { recursive: true });
    mkdirSync(path.dirname(newerPath), { recursive: true });
    writeFileSync(olderPath, '{"run":"older"}\n', 'utf8');
    writeFileSync(newerPath, '{"run":"newer"}\n', 'utf8');

    expect(findLatestNewsSourceHealthReportPath({ appRoot, env: {} })).toBe(newerPath);
  });

  it('honors an explicit report path override when the file exists', () => {
    const appRoot = makeAppRoot();
    const explicitPath = path.join(appRoot, 'tmp', 'explicit-source-health-report.json');
    mkdirSync(path.dirname(explicitPath), { recursive: true });
    writeFileSync(explicitPath, '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}\n', 'utf8');

    expect(
      findLatestNewsSourceHealthReportPath({
        appRoot,
        env: {
          VITE_NEWS_SOURCE_HEALTH_REPORT_PATH: './tmp/explicit-source-health-report.json',
        },
      }),
    ).toBe(explicitPath);
  });

  it('returns null for an explicit report path override when the file is missing', () => {
    const appRoot = makeAppRoot();

    expect(
      findLatestNewsSourceHealthReportPath({
        appRoot,
        env: {
          VITE_NEWS_SOURCE_HEALTH_REPORT_PATH: './tmp/missing-source-health-report.json',
        },
      }),
    ).toBeNull();
  });

  it('uses process.env when no explicit env map is passed for path lookup', () => {
    const appRoot = makeAppRoot();
    const explicitPath = path.join(appRoot, 'tmp', 'explicit-process-report.json');
    mkdirSync(path.dirname(explicitPath), { recursive: true });
    writeFileSync(explicitPath, '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}\n', 'utf8');
    process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_PATH = './tmp/explicit-process-report.json';

    expect(findLatestNewsSourceHealthReportPath({ appRoot })).toBe(explicitPath);
  });

  it('uses explicit env JSON without attempting artifact lookup', () => {
    const appRoot = makeAppRoot();
    const resolution = resolveNewsSourceHealthEnv({
      appRoot,
      env: {
        VITE_NEWS_SOURCE_HEALTH_REPORT_JSON: '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}',
      },
    });

    expect(resolution).toEqual({
      reportJson: '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}',
      reportPath: null,
      reportSource: 'env:VITE_NEWS_SOURCE_HEALTH_REPORT_JSON',
      autoloaded: false,
    });
  });

  it('autoloads the latest artifact and labels it as an artifact source', () => {
    const appRoot = makeAppRoot();
    const latestPath = path.join(
      resolveNewsSourceHealthArtifactRoot(appRoot),
      'latest',
      'source-health-report.json',
    );
    mkdirSync(path.dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}\n', 'utf8');

    expect(resolveNewsSourceHealthEnv({ appRoot, env: {} })).toEqual({
      reportJson: '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}',
      reportPath: latestPath,
      reportSource: `artifact:${latestPath}`,
      autoloaded: true,
    });
  });

  it('can disable artifact autoload', () => {
    const appRoot = makeAppRoot();
    const latestPath = path.join(
      resolveNewsSourceHealthArtifactRoot(appRoot),
      'latest',
      'source-health-report.json',
    );
    mkdirSync(path.dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}\n', 'utf8');

    expect(
      resolveNewsSourceHealthEnv({
        appRoot,
        env: {
          VITE_NEWS_SOURCE_HEALTH_REPORT_AUTOLOAD: 'false',
        },
      }),
    ).toEqual({
      reportJson: null,
      reportPath: null,
      reportSource: null,
      autoloaded: false,
    });
  });

  it('falls back to autoload when the autoload flag is malformed', () => {
    const appRoot = makeAppRoot();
    const latestPath = path.join(
      resolveNewsSourceHealthArtifactRoot(appRoot),
      'latest',
      'source-health-report.json',
    );
    mkdirSync(path.dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}\n', 'utf8');

    expect(
      resolveNewsSourceHealthEnv({
        appRoot,
        env: {
          VITE_NEWS_SOURCE_HEALTH_REPORT_AUTOLOAD: 'maybe',
        },
      }),
    ).toEqual({
      reportJson: '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}',
      reportPath: latestPath,
      reportSource: `artifact:${latestPath}`,
      autoloaded: true,
    });
  });

  it('honors explicit true autoload flag values', () => {
    const appRoot = makeAppRoot();
    const latestPath = path.join(
      resolveNewsSourceHealthArtifactRoot(appRoot),
      'latest',
      'source-health-report.json',
    );
    mkdirSync(path.dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}\n', 'utf8');

    expect(
      resolveNewsSourceHealthEnv({
        appRoot,
        env: {
          VITE_NEWS_SOURCE_HEALTH_REPORT_AUTOLOAD: 'on',
        },
      }),
    ).toEqual({
      reportJson: '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}',
      reportPath: latestPath,
      reportSource: `artifact:${latestPath}`,
      autoloaded: true,
    });
  });

  it('treats empty artifact files as unresolved', () => {
    const appRoot = makeAppRoot();
    const latestPath = path.join(
      resolveNewsSourceHealthArtifactRoot(appRoot),
      'latest',
      'source-health-report.json',
    );
    mkdirSync(path.dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, '   \n', 'utf8');

    expect(resolveNewsSourceHealthEnv({ appRoot, env: {} })).toEqual({
      reportJson: null,
      reportPath: null,
      reportSource: null,
      autoloaded: false,
    });
  });

  it('applies the resolved artifact JSON into the Vite env surface', () => {
    const appRoot = makeAppRoot();
    const latestPath = path.join(
      resolveNewsSourceHealthArtifactRoot(appRoot),
      'latest',
      'source-health-report.json',
    );
    mkdirSync(path.dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}\n', 'utf8');

    const env: Record<string, string | undefined> = {};
    const resolution = applyNewsSourceHealthEnv({ appRoot, env });

    expect(resolution.reportPath).toBe(latestPath);
    expect(env.VITE_NEWS_SOURCE_HEALTH_REPORT_JSON).toBe(
      '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}',
    );
    expect(env.VITE_NEWS_SOURCE_HEALTH_REPORT_SOURCE).toBe(`artifact:${latestPath}`);
  });

  it('returns unresolved state unchanged when no artifact is available', () => {
    const appRoot = makeAppRoot();
    const env: Record<string, string | undefined> = {};

    expect(applyNewsSourceHealthEnv({ appRoot, env })).toEqual({
      reportJson: null,
      reportPath: null,
      reportSource: null,
      autoloaded: false,
    });
    expect(env).toEqual({});
  });

  it('uses process.env when no explicit env map is passed for env application', () => {
    const appRoot = makeAppRoot();
    process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_JSON =
      '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}';
    process.env.VITE_NEWS_SOURCE_HEALTH_REPORT_SOURCE = 'env:test-process-source';

    expect(applyNewsSourceHealthEnv({ appRoot })).toEqual({
      reportJson: '{"runtimePolicy":{"enabledSourceIds":["source-a"]}}',
      reportPath: null,
      reportSource: 'env:test-process-source',
      autoloaded: false,
    });
  });

  it('returns unresolved state when the artifact root does not exist', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'vh-news-health-missing-root-'));
    const appRoot = path.join(root, 'apps', 'web-pwa');

    expect(resolveNewsSourceHealthEnv({ appRoot, env: {} })).toEqual({
      reportJson: null,
      reportPath: null,
      reportSource: null,
      autoloaded: false,
    });
  });
});
