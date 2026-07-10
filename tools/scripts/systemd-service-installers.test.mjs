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

function readPackageSource(...segments) {
  return readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');
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
  assert.match(source, /VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR="\$\{VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR:-\$\{VH_STORYCLUSTER_STATE_DIR\}\/openai-failures\}"/);
  assert.match(source, /refusing non-absolute VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR/);
  assert.match(source, /OpenAI failure artifact directory is not writable/);
  assert.match(source, /OpenAI failure artifacts enabled at/);
  assert.match(source, /Qdrant readiness preflight starting/);
  assert.match(source, /stage: 'storycluster_qdrant_readiness'/);
  assert.match(source, /preflightOpenAIStoryClusterProviderFromEnv/);
  assert.match(source, /start-storycluster-local\.mjs/);
});

test('news aggregator installer retires direct start and binds all generated evidence services to one exact revision', () => {
  const source = readScript('install-news-aggregator-production-service.sh');
  assert.match(source, /--expected-revision/);
  assert.match(source, /vh_publisher_require_exact_checkout "\$\{REPO_ROOT\}" "\$\{EXPECTED_REVISION\}"/);
  assert.match(source, /--start-publisher is retired/);
  assert.doesNotMatch(source, /set-environment VH_NEWS_DAEMON_START_APPROVED=1/);
  assert.equal((source.match(/Environment=VH_NEWS_DAEMON_EXPECTED_REVISION=\$\{EXPECTED_REVISION\}/g) ?? []).length, 6);
  assert.equal((source.match(/ExecStartPre=\/usr\/bin\/env bash \$\{REPO_ROOT\}\/tools\/scripts\/check-news-aggregator-expected-revision\.sh \$\{EXPECTED_REVISION\}/g) ?? []).length, 6);
});

test('news aggregator publisher unit restarts only exit 69, keeps fail-closed exits stopped, and bounds loops', () => {
  const daemonCliSource = readPackageSource('services/news-aggregator/src/daemonCli.ts');
  const exitCodeMatch = daemonCliSource.match(/NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE\s*=\s*(\d+)/);
  assert.equal(exitCodeMatch?.[1], '78');

  for (const source of [
    readScript('install-news-aggregator-production-service.sh'),
    readInfraUnit('vh-news-aggregator.service'),
  ]) {
    assert.match(source, /StartLimitIntervalSec=10min/);
    assert.match(source, /StartLimitBurst=3/);
    assert.match(source, /^Restart=no$/m);
    assert.match(source, /^RestartForceExitStatus=69$/m);
    assert.doesNotMatch(source, /^Restart=on-failure$/m);
    assert.doesNotMatch(source, /^RestartPreventExitStatus=/m);
    assert.match(source, /RestartSec=30/);
  }
  const installer = readScript('install-news-aggregator-production-service.sh');
  assert.match(installer, /Environment=VH_NEWS_DAEMON_RESTART_AUTHORITY_FILE=%h\/\.local\/state\/vhc\/news-aggregator\/recovery\/automatic-restart-authority\.json/);
  assert.match(installer, /Environment=VH_NEWS_DAEMON_RESTART_PERMIT_FILE=%h\/\.local\/state\/vhc\/news-aggregator\/recovery\/automatic-restart-permit\.json/);
  assert.match(installer, /ExecStopPost=.*record-news-aggregator-restartable-exit\.sh \$\{EXPECTED_REVISION\}/);
  assert.match(
    readScript('record-news-aggregator-restartable-exit.sh'),
    /ExecStopPost finishes[\s\S]*service_enter_restart\(\) runs afterward[\s\S]*increments n_restarts/,
  );
});

test('news aggregator installer writes publisher liveness watch units without enabling them by default', () => {
  const source = readScript('install-news-aggregator-production-service.sh');
  const service = readInfraUnit('vh-news-aggregator-liveness-watch.service');
  const timer = readInfraUnit('vh-news-aggregator-liveness-watch.timer');

  assert.match(source, /vh-news-aggregator-liveness-watch\.service/);
  assert.match(source, /vh-news-aggregator-liveness-watch\.timer/);
  assert.match(source, /--enable-publisher-liveness-watch/);
  assert.match(source, /if \[\[ "\$\{ENABLE_PUBLISHER_LIVENESS_WATCH\}" == "true" \]\]/);
  assert.match(source, /systemctl --user enable --now vh-news-aggregator-liveness-watch\.timer/);

  for (const unitSource of [source, service]) {
    assert.match(unitSource, /news-aggregator-publisher-liveness-watch\.mjs/);
    assert.match(unitSource, /VH_NEWS_PUBLISHER_LIVENESS_OUTPUT_FILE/);
  }
  assert.match(source, /source "\$\{ENV_FILE\}"/);
  assert.match(service, /source "%h\/\.config\/vhc\/news-aggregator\.env"/);
  assert.match(timer, /OnUnitActiveSec=5min/);
  assert.match(timer, /Unit=vh-news-aggregator-liveness-watch\.service/);
});

test('news aggregator installer writes relay liveness watch units without enabling them by default', () => {
  const source = readScript('install-news-aggregator-production-service.sh');
  const service = readInfraUnit('vh-news-relay-liveness-watch.service');
  const timer = readInfraUnit('vh-news-relay-liveness-watch.timer');

  assert.match(source, /vh-news-relay-liveness-watch\.service/);
  assert.match(source, /vh-news-relay-liveness-watch\.timer/);
  assert.match(source, /--enable-relay-liveness-watch/);
  assert.match(source, /if \[\[ "\$\{ENABLE_RELAY_LIVENESS_WATCH\}" == "true" \]\]/);
  assert.match(source, /systemctl --user enable --now vh-news-relay-liveness-watch\.timer/);

  for (const unitSource of [source, service]) {
    assert.match(unitSource, /news-relay-liveness-watch\.mjs/);
    assert.match(unitSource, /VH_RELAY_LIVENESS_OUTPUT_FILE/);
    assert.match(unitSource, /VH_RELAY_LIVENESS_RESTART_ON_FAIL=true/);
    assert.match(unitSource, /VH_RELAY_LIVENESS_RESTART_MAX_PER_RUN=1/);
    assert.match(unitSource, /VH_RELAY_LIVENESS_RESTART_MIN_INTERVAL_MS=600000/);
  }
  assert.match(timer, /OnUnitActiveSec=5min/);
  assert.match(timer, /Unit=vh-news-relay-liveness-watch\.service/);
});

test('news aggregator installer writes Phase 5 soak archive units without enabling them by default', () => {
  const source = readScript('install-news-aggregator-production-service.sh');
  const service = readInfraUnit('vh-phase5-scope-a-soak-archive.service');
  const timer = readInfraUnit('vh-phase5-scope-a-soak-archive.timer');

  assert.match(source, /vh-phase5-scope-a-soak-archive\.service/);
  assert.match(source, /vh-phase5-scope-a-soak-archive\.timer/);
  assert.match(source, /--enable-soak-archive/);
  assert.match(source, /if \[\[ "\$\{ENABLE_SOAK_ARCHIVE\}" == "true" \]\]/);
  assert.match(source, /systemctl --user enable --now vh-phase5-scope-a-soak-archive\.timer/);

  for (const unitSource of [source, service]) {
    assert.match(unitSource, /archive-phase5-scope-a-soak-sample\.mjs/);
    assert.match(unitSource, /VH_PHASE5_SCOPE_A_SOAK_ARCHIVE_ROOT=%h\/\.local\/state\/vhc\/phase5-scope-a-soak/);
    assert.match(unitSource, /VH_PHASE5_SCOPE_A_SOAK_RUN_PUBLIC_MONITOR=true/);
  }
  assert.match(timer, /OnUnitActiveSec=1h/);
  assert.match(timer, /Unit=vh-phase5-scope-a-soak-archive\.service/);
});

test('news aggregator installer writes Phase 5 watch closure packet units without enabling them by default', () => {
  const source = readScript('install-news-aggregator-production-service.sh');
  const service = readInfraUnit('vh-phase5-scope-a-watch-closure.service');
  const timer = readInfraUnit('vh-phase5-scope-a-watch-closure.timer');

  assert.match(source, /vh-phase5-scope-a-watch-closure\.service/);
  assert.match(source, /vh-phase5-scope-a-watch-closure\.timer/);
  assert.match(source, /--enable-watch-closure/);
  assert.match(source, /if \[\[ "\$\{ENABLE_WATCH_CLOSURE\}" == "true" \]\]/);
  assert.match(source, /systemctl --user enable --now vh-phase5-scope-a-watch-closure\.timer/);

  for (const unitSource of [source, service]) {
    assert.match(unitSource, /phase5-scope-a-watch-closure-packet\.mjs/);
    assert.match(unitSource, /VH_PHASE5_SCOPE_A_WATCH_ARCHIVE_ROOT=%h\/\.local\/state\/vhc\/phase5-scope-a-soak/);
    assert.match(unitSource, /VH_PHASE5_SCOPE_A_WATCH_OUTPUT_FILE=%h\/\.local\/state\/vhc\/phase5-scope-a-watch-closure\/latest\.json/);
    assert.match(unitSource, /VH_PHASE5_SCOPE_A_WATCH_VERDICT_FILE=%h\/\.local\/state\/vhc\/phase5-scope-a-watch-closure\/verdict\.json/);
    assert.match(unitSource, /phase5-scope-a-watch-closure\.env/);
  }
  assert.match(timer, /OnUnitActiveSec=30min/);
  assert.match(timer, /Unit=vh-phase5-scope-a-watch-closure\.service/);
});

test('public feed alert watch unit bounds host-local probe runtime', () => {
  const service = readInfraUnit('vh-public-feed-alert-watch.service');

  assert.match(service, /public-feed-alert-watch\.mjs/);
  assert.match(service, /TimeoutStartSec=180/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_STATE_DIR=%h\/\.local\/state\/vhc\/public-feed-alert/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_LIVENESS=true/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_FILE=%h\/\.local\/state\/vhc\/relay-liveness\/latest\.json/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_MAX_AGE_MS=900000/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_SNAPSHOT=true/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_FILE=%h\/\.local\/state\/vhc\/relay-snapshot-watch\/latest\.json/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_MAX_AGE_MS=2700000/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_REQUIRE_WATCH_CLOSURE=true/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_VERDICT_FILE=%h\/\.local\/state\/vhc\/phase5-scope-a-watch-closure\/verdict\.json/);
  assert.match(service, /VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_MAX_AGE_MS=5400000/);
  assert.match(service, /source "%h\/\.config\/vhc\/public-feed-alert\.env"/);
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

test('publisher evidence hard-link writers make post-commit temp cleanup non-fatal', () => {
  for (const scriptName of [
    'verify-news-aggregator-publisher-recovery.mjs',
    'write-news-aggregator-publisher-start-control-artifact.mjs',
    'write-news-aggregator-production-start-artifact.mjs',
  ]) {
    assert.match(readScript(scriptName), /await link\([\s\S]*await rm\([^;]+\)\.catch\(\(\) => undefined\)/);
  }
  assert.match(
    readScript('news-aggregator-publisher-recovery-control.sh'),
    /ln "\$\{finalization_temp\}" "\$\{FINALIZATION_OUTPUT\}"[\s\S]*rm -f "\$\{finalization_temp\}"[^\n]+\|\| true/,
  );
});
