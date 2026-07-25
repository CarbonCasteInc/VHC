import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = '.github/workflows/public-feed-freshness-monitor.yml';
const TEST_PATH = './tools/scripts/public-feed-freshness-workflow.test.mjs';

function count(source, needle) {
  return source.split(needle).length - 1;
}

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

test('freshness secret-scope regression remains in every recovery manifest', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const closeout = readFileSync('tools/scripts/check-public-beta-launch-closeout.mjs', 'utf8');
  const sprint = readFileSync('tools/scripts/public-beta-next-phase-sprint.test.mjs', 'utf8');
  const recoveryScript = packageJson.scripts?.['check:public-beta-s1-recovery-control-plane'] ?? '';

  assert.equal(count(recoveryScript, TEST_PATH), 1);
  assert.equal(count(closeout, TEST_PATH), 1);
  assert.equal(count(sprint, TEST_PATH), 1);
});
