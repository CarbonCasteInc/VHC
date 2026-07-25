import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = '.github/workflows/public-feed-freshness-monitor.yml';

test('freshness workflow scopes the OpenAI secret to the monitor step', () => {
  const source = readFileSync(WORKFLOW, 'utf8');
  const jobEnv = source.match(/    env:\n(?<body>(?:      .*\n)+?)    steps:/)?.groups?.body ?? '';
  const monitorStep = source.match(
    /      - name: Run Public Feed Freshness Monitor\n(?<body>[\s\S]*?)\n      - name:/,
  )?.groups?.body ?? '';

  assert.doesNotMatch(jobEnv, /OPENAI_API_KEY/);
  assert.match(monitorStep, /env:\n          OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(monitorStep, /run: pnpm check:public-feed:freshness-monitor/);
  assert.equal(source.match(/secrets\.OPENAI_API_KEY/g)?.length, 1);
});
