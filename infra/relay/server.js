/* Minimal Gun relay for local/dev usage */
const http = require('http');
const { createRequire } = require('module');
const path = require('path');

function resolveGun() {
  try {
    return { Gun: require('gun'), gunRequire: require };
  } catch {
    // Monorepo fallback: gun is declared under packages/gun-client.
    const gunRequire = createRequire(
      path.resolve(__dirname, '../../packages/gun-client/package.json')
    );
    return { Gun: gunRequire('gun'), gunRequire };
  }
}

const { Gun, gunRequire } = resolveGun();

// Provide required internal utilities that the WS adapter depends on.
// These were deprecated in Gun but ws.js still uses Gun.text.random and Gun.obj.* helpers.
// Without these shims, the WS adapter crashes on connection/disconnect.
Gun.text = Gun.text || {};
Gun.text.random =
  Gun.text.random ||
  ((len = 6) => {
    let s = '';
    const c = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXZabcdefghijklmnopqrstuvwxyz';
    while (len-- > 0) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  });

Gun.obj = Gun.obj || {};
Gun.obj.map =
  Gun.obj.map ||
  function map(obj, cb, ctx) {
    if (!obj) return obj;
    Object.keys(obj).forEach((k) => cb.call(ctx, obj[k], k));
    return obj;
  };
Gun.obj.del = Gun.obj.del || ((obj, key) => {
  if (obj) delete obj[key];
  return obj;
});

gunRequire('gun/lib/ws');

const port = Number(process.env.GUN_PORT || 7777);
const host = process.env.GUN_HOST || '127.0.0.1';
const radiskEnabled = process.env.GUN_RADISK !== 'false';
const gunFile = radiskEnabled ? process.env.GUN_FILE || 'data' : false;
const COMMENT_JSON_FIELD = '__comment_json';
const COMMENT_INDEX_SCHEMA_VERSION = 'hermes-comment-index-v1';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJsonBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        reject(new Error('body-too-large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body.trim() ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', reject);
  });
}

function putWithTimeout(chain, value, timeoutMs = 1_500) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, timeoutMs);
    chain.put(value, (ack) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ack });
    });
  });
}

function readOnce(chain, timeoutMs = 1_500) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    chain.once((data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data ?? null);
    });
  });
}

function stripGunMetadata(value) {
  if (!value || typeof value !== 'object') return value;
  const { _, ...rest } = value;
  return rest;
}

function parseThreadEnvelope(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseTopicSynthesisEnvelope(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function stateNode(node, field, state, value, soul) {
  return Gun.state.ify(node || {}, field, state, value, soul);
}

function linkNode(graph, soul, field, childSoul, state) {
  graph[soul] = stateNode(graph[soul], field, state, { '#': childSoul }, soul);
}

function buildThreadGraph(thread) {
  const state = Gun.state();
  const threadSoul = `vh/forum/threads/${thread.id}`;
  const graph = {};
  linkNode(graph, 'vh', 'forum', 'vh/forum', state);
  linkNode(graph, 'vh/forum', 'threads', 'vh/forum/threads', state);
  linkNode(graph, 'vh/forum/threads', thread.id, threadSoul, state);
  for (const [key, value] of Object.entries(thread)) {
    if (value === undefined) continue;
    graph[threadSoul] = stateNode(graph[threadSoul], key, state, value, threadSoul);
  }
  return graph;
}

function buildCommentGraph(comment) {
  const state = Gun.state();
  const threadSoul = `vh/forum/threads/${comment.threadId}`;
  const commentsSoul = `${threadSoul}/comments`;
  const commentSoul = `${commentsSoul}/${comment.id}`;
  const indexKey = encodeURIComponent(comment.threadId);
  const indexRootSoul = `vh/forum/indexes/comment_ids/${indexKey}`;
  const indexCurrentSoul = `${indexRootSoul}/current`;
  const indexEntriesSoul = `${indexRootSoul}/entries`;
  const indexEntrySoul = `${indexEntriesSoul}/${comment.id}`;
  const updatedAt = Date.now();
  const indexEntry = {
    schemaVersion: COMMENT_INDEX_SCHEMA_VERSION,
    threadId: comment.threadId,
    commentId: comment.id,
    updatedAt,
  };
  const indexCurrent = {
    schemaVersion: COMMENT_INDEX_SCHEMA_VERSION,
    threadId: comment.threadId,
    idsJson: JSON.stringify([comment.id]),
    updatedAt,
  };
  const encodedComment = {
    ...comment,
    [COMMENT_JSON_FIELD]: JSON.stringify(comment),
  };
  const graph = {};

  linkNode(graph, 'vh', 'forum', 'vh/forum', state);
  linkNode(graph, 'vh/forum', 'threads', 'vh/forum/threads', state);
  linkNode(graph, 'vh/forum/threads', comment.threadId, threadSoul, state);
  linkNode(graph, threadSoul, 'comments', commentsSoul, state);
  linkNode(graph, commentsSoul, comment.id, commentSoul, state);
  linkNode(graph, 'vh/forum', 'indexes', 'vh/forum/indexes', state);
  linkNode(graph, 'vh/forum/indexes', 'comment_ids', 'vh/forum/indexes/comment_ids', state);
  linkNode(graph, 'vh/forum/indexes/comment_ids', indexKey, indexRootSoul, state);
  linkNode(graph, indexRootSoul, 'current', indexCurrentSoul, state);
  linkNode(graph, indexRootSoul, 'entries', indexEntriesSoul, state);
  linkNode(graph, indexEntriesSoul, comment.id, indexEntrySoul, state);

  for (const [key, value] of Object.entries(encodedComment)) {
    if (value === undefined) continue;
    graph[commentSoul] = stateNode(graph[commentSoul], key, state, value, commentSoul);
  }
  for (const [key, value] of Object.entries(indexEntry)) {
    graph[indexEntrySoul] = stateNode(graph[indexEntrySoul], key, state, value, indexEntrySoul);
  }
  for (const [key, value] of Object.entries(indexCurrent)) {
    graph[indexCurrentSoul] = stateNode(graph[indexCurrentSoul], key, state, value, indexCurrentSoul);
  }

  return graph;
}

function encodeTopicSynthesis(synthesis) {
  return {
    __topic_synthesis_json: JSON.stringify(synthesis),
    schemaVersion: synthesis.schemaVersion,
    topic_id: synthesis.topic_id,
    epoch: synthesis.epoch,
    synthesis_id: synthesis.synthesis_id,
    created_at: synthesis.created_at,
  };
}

function buildTopicSynthesisGraph(synthesis) {
  const state = Gun.state();
  const topicId = String(synthesis.topic_id);
  const epoch = String(synthesis.epoch);
  const latestSoul = `vh/topics/${topicId}/latest`;
  const epochRootSoul = `vh/topics/${topicId}/epochs`;
  const epochSoul = `${epochRootSoul}/${epoch}`;
  const epochSynthesisSoul = `${epochSoul}/synthesis`;
  const encoded = encodeTopicSynthesis(synthesis);
  const graph = {};

  linkNode(graph, 'vh', 'topics', 'vh/topics', state);
  linkNode(graph, 'vh/topics', topicId, `vh/topics/${topicId}`, state);
  linkNode(graph, `vh/topics/${topicId}`, 'latest', latestSoul, state);
  linkNode(graph, `vh/topics/${topicId}`, 'epochs', epochRootSoul, state);
  linkNode(graph, epochRootSoul, epoch, epochSoul, state);
  linkNode(graph, epochSoul, 'synthesis', epochSynthesisSoul, state);

  for (const [key, value] of Object.entries(encoded)) {
    if (value === undefined) continue;
    graph[latestSoul] = stateNode(graph[latestSoul], key, state, value, latestSoul);
    graph[epochSynthesisSoul] = stateNode(graph[epochSynthesisSoul], key, state, value, epochSynthesisSoul);
  }

  return graph;
}

function buildAggregateVoterGraph(write) {
  const state = Gun.state();
  const topicRootSoul = `vh/aggregates/topics/${write.topic_id}`;
  const synthesesSoul = `${topicRootSoul}/syntheses`;
  const synthesisSoul = `${synthesesSoul}/${write.synthesis_id}`;
  const epochsSoul = `${synthesisSoul}/epochs`;
  const epochSoul = `${epochsSoul}/${write.epoch}`;
  const votersSoul = `${epochSoul}/voters`;
  const voterSoul = `${votersSoul}/${write.voter_id}`;
  const pointSoul = `${voterSoul}/${write.node.point_id}`;
  const graph = {};

  linkNode(graph, 'vh', 'aggregates', 'vh/aggregates', state);
  linkNode(graph, 'vh/aggregates', 'topics', 'vh/aggregates/topics', state);
  linkNode(graph, 'vh/aggregates/topics', write.topic_id, topicRootSoul, state);
  linkNode(graph, topicRootSoul, 'syntheses', synthesesSoul, state);
  linkNode(graph, synthesesSoul, write.synthesis_id, synthesisSoul, state);
  linkNode(graph, synthesisSoul, 'epochs', epochsSoul, state);
  linkNode(graph, epochsSoul, String(write.epoch), epochSoul, state);
  linkNode(graph, epochSoul, 'voters', votersSoul, state);
  linkNode(graph, votersSoul, write.voter_id, voterSoul, state);
  linkNode(graph, voterSoul, write.node.point_id, pointSoul, state);

  for (const [key, value] of Object.entries(write.node)) {
    if (value === undefined) continue;
    graph[pointSoul] = stateNode(graph[pointSoul], key, state, value, pointSoul);
  }

  return graph;
}

function buildAggregatePointSnapshotGraph(snapshot) {
  const state = Gun.state();
  const topicRootSoul = `vh/aggregates/topics/${snapshot.topic_id}`;
  const synthesesSoul = `${topicRootSoul}/syntheses`;
  const synthesisSoul = `${synthesesSoul}/${snapshot.synthesis_id}`;
  const epochsSoul = `${synthesisSoul}/epochs`;
  const epochSoul = `${epochsSoul}/${snapshot.epoch}`;
  const pointsSoul = `${epochSoul}/points`;
  const pointSoul = `${pointsSoul}/${snapshot.point_id}`;
  const sourceWindowSoul = `${pointSoul}/source_window`;
  const graph = {};

  linkNode(graph, 'vh', 'aggregates', 'vh/aggregates', state);
  linkNode(graph, 'vh/aggregates', 'topics', 'vh/aggregates/topics', state);
  linkNode(graph, 'vh/aggregates/topics', snapshot.topic_id, topicRootSoul, state);
  linkNode(graph, topicRootSoul, 'syntheses', synthesesSoul, state);
  linkNode(graph, synthesesSoul, snapshot.synthesis_id, synthesisSoul, state);
  linkNode(graph, synthesisSoul, 'epochs', epochsSoul, state);
  linkNode(graph, epochsSoul, String(snapshot.epoch), epochSoul, state);
  linkNode(graph, epochSoul, 'points', pointsSoul, state);
  linkNode(graph, pointsSoul, snapshot.point_id, pointSoul, state);
  linkNode(graph, pointSoul, 'source_window', sourceWindowSoul, state);

  for (const [key, value] of Object.entries(snapshot)) {
    if (key === 'source_window' || value === undefined) continue;
    graph[pointSoul] = stateNode(graph[pointSoul], key, state, value, pointSoul);
  }

  graph[sourceWindowSoul] = stateNode(
    graph[sourceWindowSoul],
    'from_seq',
    state,
    snapshot.source_window.from_seq,
    sourceWindowSoul
  );
  graph[sourceWindowSoul] = stateNode(
    graph[sourceWindowSoul],
    'to_seq',
    state,
    snapshot.source_window.to_seq,
    sourceWindowSoul
  );

  return graph;
}

function injectGraph(gun, graph) {
  gun._.on('in', {
    '#': `vh-relay-http-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    put: graph,
    $: gun,
    _: { faith: true },
  });
}

async function pollThreadBack(threadChain, threadId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readThreadBack(threadChain, threadId);
    if (latest) return latest;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return latest;
}

async function readThreadBack(threadChain, threadId) {
  const direct = stripGunMetadata(await readOnce(threadChain));
  if (direct && typeof direct === 'object' && direct.id === threadId) {
    return direct;
  }
  const envelope = parseThreadEnvelope(await readOnce(threadChain.get('__thread_json')));
  if (envelope?.id === threadId) {
    return envelope;
  }
  return null;
}

async function readTopicSynthesisBack(gun, topicId, synthesisId) {
  const latestChain = gun.get('vh').get('topics').get(topicId).get('latest');
  const direct = stripGunMetadata(await readOnce(latestChain));
  const envelope = direct && typeof direct === 'object'
    ? parseTopicSynthesisEnvelope(direct.__topic_synthesis_json)
    : null;
  if (envelope?.topic_id === topicId && envelope?.synthesis_id === synthesisId) {
    return envelope;
  }
  const scalar = parseTopicSynthesisEnvelope(await readOnce(latestChain.get('__topic_synthesis_json')));
  if (scalar?.topic_id === topicId && scalar?.synthesis_id === synthesisId) {
    return scalar;
  }
  return null;
}

function readTopicSynthesisFromGraph(gun, topicId, synthesisId) {
  const latestSoul = `vh/topics/${topicId}/latest`;
  const node = gun?._?.graph?.[latestSoul];
  const envelope = parseTopicSynthesisEnvelope(node?.__topic_synthesis_json);
  return envelope?.topic_id === topicId && envelope?.synthesis_id === synthesisId ? envelope : null;
}

function sanitizeThread(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('thread-required');
  }
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) {
    throw new Error('thread-id-required');
  }
  const clean = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || key === '_') continue;
    if (
      raw === null ||
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean'
    ) {
      clean[key] = raw;
    }
  }
  clean.id = id;
  return clean;
}

function sanitizeComment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('comment-required');
  }
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const threadId = typeof value.threadId === 'string' ? value.threadId.trim() : '';
  if (!id) throw new Error('comment-id-required');
  if (!threadId) throw new Error('comment-thread-required');
  const clean = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || key === '_' || key === COMMENT_JSON_FIELD) continue;
    if (
      raw === null ||
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean'
    ) {
      clean[key] = raw;
    }
  }
  clean.id = id;
  clean.threadId = threadId;
  if (typeof clean.schemaVersion !== 'string') {
    clean.schemaVersion = 'hermes-comment-v1';
  }
  if (!Number.isFinite(clean.upvotes)) {
    clean.upvotes = 0;
  }
  if (!Number.isFinite(clean.downvotes)) {
    clean.downvotes = 0;
  }
  return clean;
}

function sanitizeTopicSynthesis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('synthesis-required');
  }
  const topicId = typeof value.topic_id === 'string' ? value.topic_id.trim() : '';
  const synthesisId = typeof value.synthesis_id === 'string' ? value.synthesis_id.trim() : '';
  if (!topicId) throw new Error('synthesis-topic-required');
  if (!synthesisId) throw new Error('synthesis-id-required');
  if (!Number.isFinite(value.epoch)) throw new Error('synthesis-epoch-required');
  return {
    ...value,
    topic_id: topicId,
    synthesis_id: synthesisId,
  };
}

function normalizeRequiredString(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${name}-required`);
  return normalized;
}

function normalizeFiniteNumber(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name}-required`);
  return value;
}

function normalizeFiniteNonNegativeInteger(value, name) {
  const normalized = normalizeFiniteNumber(value, name);
  if (normalized < 0) throw new Error(`${name}-non-negative-required`);
  return Math.floor(normalized);
}

function sanitizeAggregateVoterWrite(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('aggregate-voter-required');
  }
  const node = value.node;
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('aggregate-voter-node-required');
  }

  const agreement = normalizeFiniteNumber(node.agreement, 'agreement');
  if (![ -1, 0, 1 ].includes(agreement)) {
    throw new Error('agreement-invalid');
  }

  return {
    topic_id: normalizeRequiredString(value.topic_id, 'topic-id'),
    synthesis_id: normalizeRequiredString(value.synthesis_id, 'synthesis-id'),
    epoch: normalizeFiniteNonNegativeInteger(value.epoch, 'epoch'),
    voter_id: normalizeRequiredString(value.voter_id, 'voter-id'),
    node: {
      point_id: normalizeRequiredString(node.point_id, 'point-id'),
      agreement,
      weight: normalizeFiniteNumber(node.weight, 'weight'),
      updated_at: normalizeRequiredString(node.updated_at, 'updated-at'),
    },
  };
}

function sanitizeAggregatePointSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('aggregate-snapshot-required');
  }
  const sourceWindow = value.source_window;
  if (!sourceWindow || typeof sourceWindow !== 'object' || Array.isArray(sourceWindow)) {
    throw new Error('source-window-required');
  }

  return {
    schema_version: normalizeRequiredString(value.schema_version, 'schema-version'),
    topic_id: normalizeRequiredString(value.topic_id, 'topic-id'),
    synthesis_id: normalizeRequiredString(value.synthesis_id, 'synthesis-id'),
    epoch: normalizeFiniteNonNegativeInteger(value.epoch, 'epoch'),
    point_id: normalizeRequiredString(value.point_id, 'point-id'),
    agree: normalizeFiniteNonNegativeInteger(value.agree, 'agree'),
    disagree: normalizeFiniteNonNegativeInteger(value.disagree, 'disagree'),
    weight: normalizeFiniteNumber(value.weight, 'weight'),
    participants: normalizeFiniteNonNegativeInteger(value.participants, 'participants'),
    version: normalizeFiniteNonNegativeInteger(value.version, 'version'),
    computed_at: normalizeFiniteNonNegativeInteger(value.computed_at, 'computed-at'),
    source_window: {
      from_seq: normalizeFiniteNonNegativeInteger(sourceWindow.from_seq, 'source-window-from-seq'),
      to_seq: normalizeFiniteNonNegativeInteger(sourceWindow.to_seq, 'source-window-to-seq'),
    },
  };
}

async function writeForumThread(gun, thread) {
  const clean = sanitizeThread(thread);
  const threadChain = gun.get('vh').get('forum').get('threads').get(clean.id);
  const writes = [putWithTimeout(threadChain, clean)];
  for (const [key, value] of Object.entries(clean)) {
    writes.push(putWithTimeout(threadChain.get(key), value, 750));
  }
  await Promise.allSettled(writes);
  let readback = await pollThreadBack(threadChain, clean.id, 2_000);
  if (!readback) {
    injectGraph(gun, buildThreadGraph(clean));
    readback = await pollThreadBack(threadChain, clean.id, 5_000);
  }
  if (!readback) {
    throw new Error('thread-readback-failed');
  }
  return readback;
}

async function writeForumComment(gun, comment) {
  const clean = sanitizeComment(comment);
  injectGraph(gun, buildCommentGraph(clean));
  return clean;
}

async function writeTopicSynthesis(gun, synthesis) {
  const clean = sanitizeTopicSynthesis(synthesis);
  injectGraph(gun, buildTopicSynthesisGraph(clean));
  return clean;
}

async function writeAggregateVoter(gun, write) {
  const clean = sanitizeAggregateVoterWrite(write);
  injectGraph(gun, buildAggregateVoterGraph(clean));
  return clean;
}

async function writeAggregatePointSnapshot(gun, snapshot) {
  const clean = sanitizeAggregatePointSnapshot(snapshot);
  injectGraph(gun, buildAggregatePointSnapshotGraph(clean));
  return clean;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/vh/forum/thread') {
    readJsonBody(req)
      .then((body) => writeForumThread(gun, body.thread))
      .then((thread) => sendJson(res, 200, { ok: true, thread_id: thread.id }))
      .catch((error) => sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return;
  }

  if (req.method === 'POST' && req.url === '/vh/forum/comment') {
    readJsonBody(req)
      .then((body) => writeForumComment(gun, body.comment))
      .then((comment) => sendJson(res, 200, {
        ok: true,
        thread_id: comment.threadId,
        comment_id: comment.id
      }))
      .catch((error) => sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return;
  }

  if (req.method === 'POST' && req.url === '/vh/topics/synthesis') {
    readJsonBody(req)
      .then((body) => writeTopicSynthesis(gun, body.synthesis))
      .then((synthesis) => sendJson(res, 200, {
        ok: true,
        topic_id: synthesis.topic_id,
        synthesis_id: synthesis.synthesis_id
      }))
      .catch((error) => sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return;
  }

  if (req.method === 'POST' && req.url === '/vh/aggregates/voter') {
    readJsonBody(req)
      .then((body) => writeAggregateVoter(gun, body))
      .then((write) => sendJson(res, 200, {
        ok: true,
        topic_id: write.topic_id,
        synthesis_id: write.synthesis_id,
        epoch: write.epoch,
        voter_id: write.voter_id,
        point_id: write.node.point_id
      }))
      .catch((error) => sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return;
  }

  if (req.method === 'POST' && req.url === '/vh/aggregates/point-snapshot') {
    readJsonBody(req)
      .then((body) => writeAggregatePointSnapshot(gun, body.snapshot))
      .then((snapshot) => sendJson(res, 200, {
        ok: true,
        topic_id: snapshot.topic_id,
        synthesis_id: snapshot.synthesis_id,
        epoch: snapshot.epoch,
        point_id: snapshot.point_id
      }))
      .catch((error) => sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return;
  }

  res.end('vh relay alive\n');
});

// Minimal, stable Gun relay (no custom hooks)
const gun = Gun({
  web: server,
  radisk: radiskEnabled,
  file: gunFile,
  axe: false,
  peers: [] // explicit empty list to keep ws adapter happy
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`[vh:relay] Gun relay listening on ${host}:${port}`);
});
