import { describe, expect, it, vi } from 'vitest';
import {
  buildCorrectnessGateStatusPaths,
  buildCorrectnessGateStatusReport,
  runStoryclusterCorrectnessGate,
  STORYCLUSTER_CORRECTNESS_GATE_STATUS_SCHEMA_VERSION,
  writeCorrectnessGateStatusReport,
} from './storycluster-correctness-gate.mjs';

describe('storycluster-correctness-gate', () => {
  it('builds repo-rooted correctness status paths', () => {
    expect(buildCorrectnessGateStatusPaths('/repo', 123)).toEqual({
      artifactDir: '/repo/.tmp/storycluster-production-readiness/correctness-gate/123',
      reportPath: '/repo/.tmp/storycluster-production-readiness/correctness-gate/123/correctness-gate-status.json',
      latestArtifactDir: '/repo/.tmp/storycluster-production-readiness/latest',
      latestReportPath: '/repo/.tmp/storycluster-production-readiness/latest/correctness-gate-status.json',
    });
  });

  it('writes both run-specific and latest correctness receipts', () => {
    const writes = new Map();
    const report = buildCorrectnessGateStatusReport({
      repoRoot: '/repo',
      status: 'pass',
      exitCode: 0,
      generatedAt: '2026-04-09T00:00:00.000Z',
    });

    const paths = writeCorrectnessGateStatusReport(report, {
      paths: buildCorrectnessGateStatusPaths('/repo', 456),
      mkdir: () => {},
      writeFile: (filePath, content) => writes.set(filePath, String(content)),
    });

    expect(paths.reportPath).toBe('/repo/.tmp/storycluster-production-readiness/correctness-gate/456/correctness-gate-status.json');
    expect(writes.get(paths.reportPath)).toContain(STORYCLUSTER_CORRECTNESS_GATE_STATUS_SCHEMA_VERSION);
    expect(writes.get(paths.latestReportPath)).toContain('"status": "pass"');
  });

  it('runs the correctness command and persists a passing receipt', () => {
    const writes = new Map();
    const spawn = vi.fn(() => ({
      status: 0,
      error: null,
    }));

    const report = runStoryclusterCorrectnessGate({
      env: {},
      repoRoot: '/repo',
      spawn,
      log: () => {},
      now: () => 789,
      mkdir: () => {},
      writeFile: (filePath, content) => writes.set(filePath, String(content)),
    });

    expect(spawn).toHaveBeenCalledWith('pnpm', ['test:storycluster:correctness'], expect.objectContaining({
      cwd: '/repo',
      stdio: 'inherit',
    }));
    expect(report.status).toBe('pass');
    expect(writes.get('/repo/.tmp/storycluster-production-readiness/latest/correctness-gate-status.json')).toContain('"exitCode": 0');
  });
});
