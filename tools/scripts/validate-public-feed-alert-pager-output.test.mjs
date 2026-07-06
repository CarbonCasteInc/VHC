import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePublicFeedAlertPagerOutput } from './validate-public-feed-alert-pager-output.mjs';

test('validates a test-fire alert handoff to pager issue', () => {
  const result = validatePublicFeedAlertPagerOutput({
    startedAt: '2026-07-06T09:59:00.000Z',
    alertSummary: {
      generatedAt: '2026-07-06T10:00:00.000Z',
      delivery: {
        status: 'sent',
        reason: 'test_fire',
        channels: [{ channel: 'webhook', status: 'sent' }],
      },
      publisher: { failureClass: 'exit_69_transport_unavailable' },
    },
    pagerReadback: {
      status: 'ok',
      incidentKey: 'a6:public-feed:exit_69',
      issue: {
        number: 7220,
        url: 'https://github.com/CarbonCasteInc/VHC/issues/7220',
      },
    },
  });
  assert.equal(result.status, 'pass');
});

test('rejects email-only delivery and unrelated pager readback', () => {
  const result = validatePublicFeedAlertPagerOutput({
    startedAt: '2026-07-06T09:59:00.000Z',
    alertSummary: {
      generatedAt: '2026-07-06T10:00:00.000Z',
      delivery: {
        status: 'sent',
        reason: 'test_fire',
        channels: [{ channel: 'email', status: 'sent' }],
      },
      publisher: { failureClass: 'exit_69_transport_unavailable' },
    },
    pagerReadback: {
      status: 'ok',
      incidentKey: 'a6:public-feed:unrelated',
      issue: {
        number: 7220,
        url: 'https://github.com/CarbonCasteInc/VHC/issues/7220',
      },
    },
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /alert_webhook_channel_not_sent/);
  assert.match(result.blockers.join('\n'), /pager_incident_key_mismatch/);
});

test('fails closed when delivery was not a post-start test fire', () => {
  const result = validatePublicFeedAlertPagerOutput({
    startedAt: '2026-07-06T10:01:00.000Z',
    alertSummary: {
      generatedAt: '2026-07-06T10:00:00.000Z',
      delivery: { status: 'suppressed', reason: 'state_unchanged', channels: [] },
    },
    pagerReadback: { status: 'missing' },
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /alert_delivery_not_sent/);
  assert.match(result.blockers.join('\n'), /pager_issue_missing/);
});
