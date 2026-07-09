import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const packets = {
  storycluster: {
    path: 'docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md',
    text: readFileSync('docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md', 'utf8'),
  },
  acceptedSynthesis: {
    path: 'docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md',
    text: readFileSync('docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md', 'utf8'),
  },
  authCallback: {
    path: 'docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md',
    text: readFileSync('docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md', 'utf8'),
  },
};

function assertIncludes(text, expected, label) {
  assert.ok(text.includes(expected), `missing ${label}: ${expected}`);
}

function assertNotIncludes(text, forbidden, label) {
  assert.ok(!text.includes(forbidden), `must not include ${label}: ${forbidden}`);
}

test('StoryCluster credential repair packet stays secret-safe and narrowly scoped', () => {
  const { text } = packets.storycluster;

  assert.match(text, /> Status: `operator_packet_pending`/);
  assertIncludes(text, 'storycluster_openai_invalid_api_key', 'current failure class');
  assertIncludes(text, 'repair_storycluster_openai_credential_or_endpoint', 'recommended action');
  assertIncludes(text, 'This packet does not approve publisher restart, relay restart, source-surface', 'non-goals');
  assertIncludes(text, 'Do not interpret it as source scarcity, source-health failure, or StoryCluster', 'diagnostic boundary');

  for (const secret of [
    'OPENAI_API_KEY',
    'ANALYSIS_RELAY_API_KEY',
    'VH_STORYCLUSTER_SERVER_AUTH_TOKEN',
    'VH_STORYCLUSTER_REMOTE_AUTH_TOKEN',
  ]) {
    assertIncludes(text, secret, `${secret} secret handling`);
  }

  for (const allowedEvidence of [
    'file mode, owner, group, path',
    'sorted variable names only',
    'boolean/presence checks',
    'OpenAI preflight status/code/provider provenance',
  ]) {
    assertIncludes(text, allowedEvidence, `${allowedEvidence} allowed evidence`);
  }

  assertIncludes(text, 'corepack pnpm@9.7.1 collect:storycluster:headline-soak', 'headline-soak rerun command');
  assertIncludes(text, 'corepack pnpm@9.7.1 check:storycluster:production-readiness', 'production-readiness rerun command');
  assertIncludes(text, 'Do not restart `vh-news-aggregator.service` in this packet', 'publisher restart boundary');
  assertIncludes(text, '`vh-news-aggregator.service` is not restarted under this packet', 'exit criterion preserving publisher');
  assertIncludes(text, 'Stop and open a focused incident or follow-up packet', 'stop rule section');
});

test('accepted-synthesis canary packet remains one-shot, draft, and non-destructive', () => {
  const { text } = packets.acceptedSynthesis;

  assert.match(text, /> Status: `draft_do_not_run_until_preconditions_pass`/);
  assertIncludes(text, 'Do not run it until the preconditions below are verified', 'draft boundary');
  assertIncludes(text, 'one-shot public synthesis catch-up', 'one-shot canary shape');
  assertIncludes(text, '`VH_NEWS_SCOPE_B_ENRICHMENT_ENABLED` stays `0`', 'Scope B remains off');
  assertIncludes(text, '`vh-news-aggregator.service` is not restarted by this', 'publisher not restarted');
  assertIncludes(text, 'VH_PUBLIC_SYNTHESIS_CATCHUP_LIMIT=1', 'single-candidate limit');
  assertIncludes(text, 'VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS=2', '2-of-3 quorum');
  assertIncludes(text, 'corepack pnpm@9.7.1 catchup:public-synthesis', 'catchup command');
  assertIncludes(text, 'VH_PUBLIC_FEED_SMOKE_REQUIRE_ACCEPTED_SYNTHESIS=true', 'browser proof requires accepted synthesis');
  assertIncludes(text, 'Do not use this browser canary as the final three-browser stance persistence', 'Lane 7 separation');

  for (const precondition of [
    'StoryCluster production-readiness is no longer blocked',
    'Email alerting remains active and reaches the release owner',
    'public-feed freshness monitor passing',
    'relay liveness, relay snapshot freshness, and watch-closure passing',
  ]) {
    assertIncludes(text, precondition, `${precondition} precondition`);
  }

  for (const stopRule of [
    '`catchup:public-synthesis` returns `fail` or `no_candidates`',
    'public lifecycle readback is not `accepted_available`',
    'browser evidence cannot render the accepted-current summary/table',
    'requires publisher restart',
  ]) {
    assertIncludes(text, stopRule, `${stopRule} stop rule`);
  }

  assertIncludes(text, 'Rollback is claim-first', 'claim-first rollback');
  assertIncludes(text, 'Do not attempt destructive', 'no destructive rollback');
});

test('auth-callback provider packet keeps secrets outside A6 and advertises only rehearsed providers', () => {
  const { text } = packets.authCallback;

  assert.match(text, /> Status: `operator_packet_pending`/);
  assertIncludes(text, 'auth-callback service must run outside A6', 'outside-A6 boundary');
  assertIncludes(text, 'does not authorize A6 mutation by itself', 'A6 mutation boundary');
  assertIncludes(text, 'at least one provider is registered, configured, and rehearsed live', 'provider rehearsal blocker');
  assertIncludes(text, 'every provider visible in tester copy/UI passes the live rehearsal matrix', 'visible provider rehearsal rule');
  assertIncludes(text, 'VITE_AUTH_CALLBACK_PROVIDERS', 'provider allowlist');
  assertIncludes(text, 'remove it from tester copy and from', 'hide unrehearsed providers');

  for (const decision of [
    'Auth boundary host URL',
    'Edge host/project/account',
    'Durable nonce store binding',
    'Providers advertised for `dev-small`',
    'Origin image rebuild owner',
    'Rollback owner',
  ]) {
    assertIncludes(text, `| ${decision} |`, `${decision} decision row`);
  }

  for (const secret of [
    'VH_AUTH_STATE_SECRET',
    'VH_AUTH_GOOGLE_CLIENT_SECRET',
    'VH_AUTH_X_CLIENT_SECRET',
    'VH_AUTH_APPLE_PRIVATE_KEY',
    'PKCE verifier',
    'signed `state` values',
  ]) {
    assertIncludes(text, secret, `${secret} secret handling`);
  }

  assertIncludes(text, 'Apple provider redirect URI | `https://<auth-boundary>/auth/apple/return`', 'Apple form_post redirect');
  assertIncludes(text, 'Google provider redirect URI | `https://venn.carboncaste.io/auth/callback`', 'Google PWA redirect');
  assertIncludes(text, 'X provider redirect URI | `https://venn.carboncaste.io/auth/callback`', 'X PWA redirect');
  assertIncludes(text, 'Do not register Google or X directly to the worker callback endpoint', 'Google/X callback boundary');
  assertIncludes(text, 'durableStore` is `true`', 'durable store health requirement');
  assertIncludes(text, 'Start-Leg Smoke', 'start-leg smoke');
  assertIncludes(text, 'Secret Scan', 'secret scan');
  assertIncludes(text, 'Live Provider Rehearsal', 'live provider rehearsal');
  assertIncludes(text, 'disable the affected provider at the auth boundary host', 'non-A6 rollback');
  assertIncludes(text, 'Do not restart publisher or relays from this auth packet', 'publisher/relay rollback boundary');
});

test('operator packets do not grant pager, Codex, broad synthesis, or release approval authority', () => {
  for (const [name, { text }] of Object.entries(packets)) {
    assertNotIncludes(text, 'go_for_dev_small_distribution', `${name} distribution approval`);
    assertNotIncludes(text, 'go_for_dev_small_tester_wave', `${name} launch approval`);
    assertNotIncludes(text, 'Codex live execution enabled', `${name} Codex autonomy approval`);
    assertNotIncludes(text, 'pager-backed 24/7 operations', `${name} pager launch claim`);
  }

  assertIncludes(packets.storycluster.text, 'Codex live execution', 'StoryCluster Codex non-goal');
  assertIncludes(packets.acceptedSynthesis.text, 'Codex live execution/autonomy', 'canary Codex non-goal');
  assertIncludes(packets.authCallback.text, 'Codex live execution/autonomy', 'auth Codex non-goal');
  assertIncludes(packets.acceptedSynthesis.text, 'broad accepted-synthesis rollout beyond a one-story canary', 'broad synthesis non-goal');
  assertIncludes(packets.authCallback.text, 'It is not a release approval', 'auth not release approval');
});
