import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSourceHealthWorkflowJob(): string {
  const workflowPath = path.resolve(__dirname, '../../../.github/workflows/main.yml');
  const workflow = readFileSync(workflowPath, 'utf8');
  const match = workflow.match(/\n  source-health:\n(?<job>[\s\S]*?)\n  storycluster-correctness:/);
  if (!match?.groups?.job) {
    throw new Error('Unable to locate source-health job in .github/workflows/main.yml');
  }
  return match.groups.job;
}

describe('source health CI workflow', () => {
  it('uses the operational liveness gate instead of the release evidence gate for PR validation', () => {
    const job = readSourceHealthWorkflowJob();

    expect(job).toContain('run: pnpm check:news-sources:liveness');
    expect(job).toContain('source-health-liveness-report.json');
    expect(job).not.toContain('run: pnpm check:news-sources:health');
  });
});
