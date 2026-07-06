import assert from 'node:assert/strict';
import test from 'node:test';
import { planTriageRun, safeIssueContext } from './vhc-incident-triage-worker.mjs';

function issue(overrides = {}) {
  return {
    number: 100,
    state: 'open',
    title: '[A6 incident] critical exit_78',
    labels: ['incident', 'a6', 'public-feed', 'needs-codex-triage'],
    body: 'Incident key: `a6:public-feed:exit_78`\nsecret https://hooks.example.invalid/token',
    comments: [],
    ...overrides,
  };
}

test('triage worker builds redacted prompt for active incident', () => {
  const plan = planTriageRun({ issues: [issue()], allowlist: ['lou'] });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.prompts[0].incidentKey, 'a6:public-feed:exit_78');
  assert.match(plan.prompts[0].prompt, /Do not mutate A6/);
  assert.doesNotMatch(plan.prompts[0].prompt, /hooks\.example/);
});

test('triage context ignores edited non-allowlisted command comments', () => {
  const context = safeIssueContext({
    issue: issue({
      comments: [
        {
          id: 1,
          user: { login: 'internet-user' },
          author_association: 'NONE',
          body: '/vhc approve packet pkt abc',
          created_at: '2026-07-06T10:00:00Z',
          updated_at: '2026-07-06T10:01:00Z',
        },
        {
          id: 2,
          user: { login: 'lou' },
          author_association: 'OWNER',
          body: '/vhc reviewer sol',
          created_at: '2026-07-06T10:00:00Z',
          updated_at: '2026-07-06T10:00:00Z',
        },
      ],
    }),
    allowlist: ['lou'],
  });
  assert.deepEqual(context.commands.map((entry) => entry.command.kind), ['set_reviewer']);
});

test('triage worker obeys automation kill switch', () => {
  const plan = planTriageRun({
    issues: [issue()],
    env: { VH_INCIDENT_AUTOMATION_PAUSED: '1' },
    allowlist: ['lou'],
  });
  assert.equal(plan.status, 'paused');
});
