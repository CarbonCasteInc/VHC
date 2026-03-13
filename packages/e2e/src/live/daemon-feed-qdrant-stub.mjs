import { createServer } from 'node:http';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = Number.parseInt(process.env.VH_DAEMON_FEED_QDRANT_PORT ?? '6333', 10);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseUrl(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = Number(left[index] ?? 0);
    const b = Number(right[index] ?? 0);
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm <= 0 || rightNorm <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function matchesTopic(point, filter) {
  const must = filter?.must;
  if (!Array.isArray(must) || must.length === 0) {
    return true;
  }
  return must.every((entry) => {
    if (entry?.key !== 'topic_id') {
      return true;
    }
    return point.payload?.topic_id === entry?.match?.value;
  });
}

function createCollectionStore() {
  return new Map();
}

function collectionFromPath(pathname) {
  const match = pathname.match(/^\/collections\/([^/]+)(?:\/(points(?:\/search\/batch|\/scroll|\/delete)?))?$/);
  if (!match) {
    return null;
  }
  return {
    name: decodeURIComponent(match[1]),
    suffix: match[2] ?? '',
  };
}

function normalizePoints(points = []) {
  return points.map((point) => ({
    id: String(point.id),
    vector: Array.isArray(point.vector) ? point.vector.map((value) => Number(value)) : [],
    payload: point.payload ?? {},
  }));
}

export function createQdrantStubServer() {
  const collections = createCollectionStore();

  return createServer(async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    const parsed = parseUrl(req);
    if (!parsed) {
      json(res, 400, { status: 'error', result: null, error: 'invalid-url' });
      return;
    }

    if (parsed.pathname === '/readyz') {
      json(res, 200, { status: 'ok' });
      return;
    }

    const target = collectionFromPath(parsed.pathname);
    if (!target) {
      json(res, 404, { status: 'error', result: null, error: 'not-found' });
      return;
    }

    if (!target.suffix && method === 'GET') {
      const collection = collections.get(target.name);
      if (!collection) {
        json(res, 404, { status: 'error', result: null, error: 'collection-not-found' });
        return;
      }
      json(res, 200, { status: 'ok', result: { status: 'green', vectors_count: collection.points.size } });
      return;
    }

    if (!target.suffix && method === 'PUT') {
      const body = await readJson(req);
      collections.set(target.name, {
        vectors: body?.vectors ?? {},
        points: new Map(),
      });
      json(res, 200, { status: 'ok', result: true });
      return;
    }

    const collection = collections.get(target.name);
    if (!collection) {
      json(res, 404, { status: 'error', result: null, error: 'collection-not-found' });
      return;
    }

    if (target.suffix === 'points' && method === 'PUT') {
      const body = await readJson(req);
      for (const point of normalizePoints(body?.points)) {
        collection.points.set(point.id, point);
      }
      json(res, 200, { status: 'ok', result: { status: 'acknowledged' } });
      return;
    }

    if (target.suffix === 'points/delete' && method === 'POST') {
      const body = await readJson(req);
      for (const pointId of body?.points ?? []) {
        collection.points.delete(String(pointId));
      }
      json(res, 200, { status: 'ok', result: { status: 'acknowledged' } });
      return;
    }

    if (target.suffix === 'points/scroll' && method === 'POST') {
      const body = await readJson(req);
      const limit = Math.max(1, Number(body?.limit ?? 32));
      const offset = Number(body?.offset ?? 0);
      const matching = [...collection.points.values()].filter((point) => matchesTopic(point, body?.filter));
      const page = matching.slice(offset, offset + limit);
      const nextPageOffset = offset + limit < matching.length ? offset + limit : null;
      json(res, 200, {
        status: 'ok',
        result: {
          points: page.map((point) => ({ id: point.id })),
          next_page_offset: nextPageOffset,
        },
      });
      return;
    }

    if (target.suffix === 'points/search/batch' && method === 'POST') {
      const body = await readJson(req);
      const searches = Array.isArray(body?.searches) ? body.searches : [];
      const results = searches.map((search) => {
        const limit = Math.max(1, Number(search?.limit ?? 8));
        return [...collection.points.values()]
          .filter((point) => matchesTopic(point, search?.filter))
          .map((point) => ({
            score: Number(cosine(search?.vector ?? [], point.vector).toFixed(6)),
            payload: point.payload,
          }))
          .sort((left, right) => right.score - left.score)
          .slice(0, limit);
      });
      json(res, 200, { status: 'ok', result: results });
      return;
    }

    json(res, 405, { status: 'error', result: null, error: 'method-not-allowed' });
  });
}

export function startQdrantStubServer({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  const server = createQdrantStubServer();
  server.listen(port, host);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = startQdrantStubServer();
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log('[vh:e2e-qdrant] started', {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
  });
}
