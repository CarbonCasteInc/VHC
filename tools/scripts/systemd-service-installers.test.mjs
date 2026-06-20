import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const SERVICE_PATH = '%h/.local/bin:%h/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin';

function readScript(name) {
  return readFileSync(path.join(REPO_ROOT, 'tools/scripts', name), 'utf8');
}

function readInfraUnit(name) {
  return readFileSync(path.join(REPO_ROOT, 'infra/systemd/user', name), 'utf8');
}

test('systemd installers include A6 node and pnpm paths', () => {
  for (const scriptName of [
    'install-analysis-backend-service.sh',
    'install-news-aggregator-production-service.sh',
    'install-storycluster-production-service.sh',
  ]) {
    const source = readScript(scriptName);
    assert.match(source, new RegExp(`SERVICE_PATH="${SERVICE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(source, /Environment=PATH=\$\{SERVICE_PATH\}/);
  }
});

test('storycluster installer writes qdrant and production engine user units', () => {
  const source = readScript('install-storycluster-production-service.sh');
  assert.match(source, /vh-storycluster-qdrant\.service/);
  assert.match(source, /vh-storycluster-engine\.service/);
  assert.match(source, /start-storycluster-qdrant-production\.sh/);
  assert.match(source, /start-storycluster-production\.sh/);
  assert.match(source, /--start-storycluster requires readable/);
  assert.match(source, /stage: 'qdrant_readiness'/);
  assert.match(source, /stage: 'storycluster_readiness'/);
  assert.match(source, /startsWith\('qdrant:'\)/);
});

test('storycluster production starter refuses non-qdrant service mode', () => {
  const source = readScript('start-storycluster-production.sh');
  assert.match(source, /export NODE_ENV=production/);
  assert.match(source, /VH_STORYCLUSTER_VECTOR_BACKEND="\$\{VH_STORYCLUSTER_VECTOR_BACKEND:-qdrant\}"/);
  assert.match(source, /refusing non-qdrant vector backend in production/);
  assert.match(source, /Qdrant readiness preflight starting/);
  assert.match(source, /stage: 'storycluster_qdrant_readiness'/);
  assert.match(source, /preflightOpenAIStoryClusterProviderFromEnv/);
  assert.match(source, /start-storycluster-local\.mjs/);
});

test('news aggregator installer still gates publisher start on explicit approval', () => {
  const source = readScript('install-news-aggregator-production-service.sh');
  assert.match(source, /if \[\[ "\$\{START_PUBLISHER\}" == "true" \]\]/);
  assert.match(source, /VH_NEWS_DAEMON_START_APPROVED:-/);
  assert.match(source, /--start-publisher requires VH_NEWS_DAEMON_START_APPROVED=1/);
  assert.match(source, /systemctl --user enable --now vh-news-aggregator\.service/);
});

test('news aggregator publisher unit keeps deliberate fail-closed exits stopped and bounds crash loops', () => {
  for (const source of [
    readScript('install-news-aggregator-production-service.sh'),
    readInfraUnit('vh-news-aggregator.service'),
  ]) {
    assert.match(source, /StartLimitIntervalSec=10min/);
    assert.match(source, /StartLimitBurst=3/);
    assert.match(source, /Restart=on-failure/);
    assert.match(source, /RestartPreventExitStatus=78/);
    assert.match(source, /RestartSec=30/);
  }
});

test('news aggregator user unit orders publisher after StoryCluster', () => {
  for (const source of [
    readScript('install-news-aggregator-production-service.sh'),
    readInfraUnit('vh-news-aggregator.service'),
  ]) {
    assert.match(source, /After=network-online\.target vh-storycluster-engine\.service/);
    assert.match(source, /Wants=network-online\.target vh-storycluster-engine\.service/);
  }
});

test('installers fail closed unless user linger is enabled', () => {
  for (const scriptName of [
    'install-analysis-backend-service.sh',
    'install-news-aggregator-production-service.sh',
    'install-storycluster-production-service.sh',
  ]) {
    const source = readScript(scriptName);
    assert.match(source, /loginctl show-user "\$\{user_name\}" -p Linger --value/);
    assert.match(source, /loginctl enable-linger \$\{user_name\}/);
    assert.match(source, /User linger is required for durable user services/);
    assert.match(source, /vh-analysis-backend-3001\.service vh-storycluster-qdrant\.service vh-storycluster-engine\.service vh-news-aggregator\.service/);
  }
});

test('news aggregator production start requires qdrant-backed StoryCluster readiness', () => {
  const source = readScript('start-news-aggregator-daemon-production.sh');
  assert.match(source, /StoryCluster service readiness preflight starting/);
  assert.match(source, /VH_STORYCLUSTER_REMOTE_HEALTH_URL/);
  assert.match(source, /storycluster-ready-not-qdrant-backed/);
  assert.match(source, /detail\?\.startsWith\('qdrant:'\)/);
});
