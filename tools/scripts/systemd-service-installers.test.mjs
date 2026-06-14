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

test('systemd installers include A6 node and pnpm paths', () => {
  for (const scriptName of [
    'install-analysis-backend-service.sh',
    'install-news-aggregator-production-service.sh',
  ]) {
    const source = readScript(scriptName);
    assert.match(source, new RegExp(`SERVICE_PATH="${SERVICE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(source, /Environment=PATH=\$\{SERVICE_PATH\}/);
  }
});

test('news aggregator installer still gates publisher start on explicit approval', () => {
  const source = readScript('install-news-aggregator-production-service.sh');
  assert.match(source, /if \[\[ "\$\{START_PUBLISHER\}" == "true" \]\]/);
  assert.match(source, /VH_NEWS_DAEMON_START_APPROVED:-/);
  assert.match(source, /--start-publisher requires VH_NEWS_DAEMON_START_APPROVED=1/);
  assert.match(source, /systemctl --user enable --now vh-news-aggregator\.service/);
});
