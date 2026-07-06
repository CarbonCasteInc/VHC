import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubIncidentBridge, incidentIssueBody, isBridgeOwnedIncidentIssue } from './github-bridge.mjs';

const alert = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  severity: 'critical',
  alertClass: 'exit_78_fail_closed',
  status: 'fail',
  fingerprint: 'abc',
  blockers: ['publisher_exit_78:https://secret.example.invalid/hook'],
  publisher: { failureClass: 'exit_78_fail_closed' },
};

test('incident body is public-safe and contains required workflow fields', () => {
  const body = incidentIssueBody({ incidentKey: 'a6:public-feed:exit_78', alert });
  assert.match(body, /vhc-incident-v1/);
  assert.match(body, /Reviewer: `fable`/);
  assert.equal(body.includes('https://secret.example.invalid'), false);
  assert.match(body, /url_hash:/);
});

test('bridge creates when no open incident exists and updates existing issues', async () => {
  const calls = [];
  const bridge = new GitHubIncidentBridge({
    owner: 'CarbonCasteInc',
    repo: 'VHC',
    token: 'issue-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/issues?')) {
        return {
          ok: true,
          text: async () => JSON.stringify(calls.length > 1 ? [{
            number: 9,
            body: incidentIssueBody({ incidentKey: 'a6:public-feed:exit_78', alert }),
            labels: [
              { name: 'incident' },
              { name: 'a6' },
              { name: 'public-feed' },
              { name: 'needs-codex-triage' },
              { name: 'vhc-pager-bridge' },
              { name: 'severity:critical' },
            ],
          }] : []),
        };
      }
      if (url.endsWith('/issues')) {
        return { ok: true, text: async () => JSON.stringify({ number: 9, body: init.body }) };
      }
      if (url.endsWith('/comments')) {
        return { ok: true, text: async () => JSON.stringify({ id: 10 }) };
      }
      if (url.endsWith('/labels')) {
        return { ok: true, text: async () => JSON.stringify([]) };
      }
      throw new Error(url);
    },
  });
  assert.equal((await bridge.createOrUpdateIncident({ incidentKey: 'a6:public-feed:exit_78', alert })).status, 'created');
  assert.equal((await bridge.createOrUpdateIncident({ incidentKey: 'a6:public-feed:exit_78', alert })).status, 'updated');
  assert.equal(calls.some((call) => call.url.endsWith('/issues/9/comments')), true);
});

test('bridge refuses to dedupe into public preseeded incident issues', () => {
  assert.equal(isBridgeOwnedIncidentIssue({
    body: 'Incident key: `a6:public-feed:exit_78`',
    labels: [
      { name: 'incident' },
      { name: 'a6' },
      { name: 'public-feed' },
      { name: 'needs-codex-triage' },
    ],
  }, 'a6:public-feed:exit_78'), false);
  assert.equal(isBridgeOwnedIncidentIssue({
    body: incidentIssueBody({ incidentKey: 'a6:public-feed:exit_78', alert }),
    labels: [
      { name: 'incident' },
      { name: 'a6' },
      { name: 'public-feed' },
      { name: 'needs-codex-triage' },
      { name: 'vhc-pager-bridge' },
      { name: 'severity:critical' },
    ],
  }, 'a6:public-feed:exit_78'), true);
});
