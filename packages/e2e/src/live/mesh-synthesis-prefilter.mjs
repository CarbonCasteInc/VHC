#!/usr/bin/env node
const DEFAULT_PEERS = ['http://127.0.0.1:7777/gun'];
const DEFAULT_READ_TIMEOUT_MS = 6_000;

function readPositiveIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseArgs(argv) {
  const parsed = {
    peers: process.env.VH_GUN_PEERS ?? process.env.VITE_GUN_PEERS ?? JSON.stringify(DEFAULT_PEERS),
    topics: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--peers') {
      parsed.peers = argv[index + 1] ?? parsed.peers;
      index += 1;
      continue;
    }
    parsed.topics.push(arg);
  }
  return parsed;
}

function parsePeers(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_PEERS;
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : DEFAULT_PEERS;
  }
  return trimmed.split(',').map((peer) => peer.trim()).filter(Boolean);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

function hasVoteableAcceptedSynthesis(synthesis) {
  return Boolean(
    synthesis?.facts_summary?.trim?.()
      && synthesis?.frames?.some?.((frame) =>
        Boolean(frame?.frame_point_id?.trim?.() || frame?.reframe_point_id?.trim?.())
      )
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const timeoutMs = readPositiveIntEnv(
    'VH_FULL_PRODUCT_MESH_SYNTHESIS_READ_TIMEOUT_MS',
    DEFAULT_READ_TIMEOUT_MS,
  );
  const peers = parsePeers(options.peers);
  const accepted = {};

  // Gun writes noisy startup messages to stdout. Keep stdout machine-readable
  // and emit only the final JSON payload from this short-lived helper process.
  console.log = () => {};
  const { createClient, readTopicLatestSynthesis } = await import('@vh/gun-client');
  const client = createClient({ requireSession: false, peers, gunRadisk: false });
  client.markSessionReady();
  await new Promise((resolve) => setTimeout(resolve, 500));

  await Promise.all([...new Set(options.topics)].map(async (topicId) => {
    const synthesis = await withTimeout(readTopicLatestSynthesis(client, topicId), timeoutMs);
    accepted[topicId] = hasVoteableAcceptedSynthesis(synthesis);
  }));

  client.shutdown?.();
  process.stdout.write(`${JSON.stringify({ accepted })}\n`);
  setTimeout(() => process.exit(0), 50).unref();
}

main().catch((error) => {
  process.stderr.write(`[vh:mesh-synthesis-prefilter] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
