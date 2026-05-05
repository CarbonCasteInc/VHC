import fs from 'node:fs';
import http from 'node:http';

const port = Number.parseInt(process.env.VH_MESH_SIGNED_CANARY_CONFIG_PORT ?? '0', 10);
const host = process.env.VH_MESH_SIGNED_CANARY_CONFIG_HOST ?? '127.0.0.1';
const fixturePath = process.env.VH_MESH_SIGNED_PEER_CONFIG_PATH;

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('VH_MESH_SIGNED_CANARY_CONFIG_PORT must be a positive integer');
}
if (!fixturePath) {
  throw new Error('VH_MESH_SIGNED_PEER_CONFIG_PATH is required');
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
}

const server = http.createServer((req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);
  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'vh-mesh-signed-peer-config' }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/mesh-peer-config.json') {
    try {
      const body = fs.readFileSync(fixturePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not-found' }));
});

server.listen(port, host, () => {
  console.log(`[vh:mesh-signed-peer-config] serving ${fixturePath} on http://${host}:${port}`);
});
