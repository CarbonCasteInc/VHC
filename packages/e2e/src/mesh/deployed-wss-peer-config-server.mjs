#!/usr/bin/env node
import fs from 'node:fs';
import https from 'node:https';

const port = Number.parseInt(process.env.VH_MESH_DEPLOYED_WSS_CONFIG_PORT ?? '0', 10);
const host = process.env.VH_MESH_DEPLOYED_WSS_CONFIG_HOST ?? '127.0.0.1';
const positiveFixturePath = process.env.VH_MESH_DEPLOYED_WSS_PEER_CONFIG_PATH;
const rolloverFixturePath = process.env.VH_MESH_DEPLOYED_WSS_ROLLOVER_CONFIG_PATH;
const certPath = process.env.VH_MESH_TLS_CERT_PATH;
const keyPath = process.env.VH_MESH_TLS_KEY_PATH;
const controlToken = process.env.VH_MESH_DEPLOYED_WSS_CONTROL_TOKEN ?? '';
const optionalFixtureEnv = {
  rollback: process.env.VH_MESH_PEER_CONFIG_ROLLBACK_CONFIG_PATH,
  expired: process.env.VH_MESH_PEER_CONFIG_EXPIRED_CONFIG_PATH,
  unsigned: process.env.VH_MESH_PEER_CONFIG_UNSIGNED_CONFIG_PATH,
  bad_signature: process.env.VH_MESH_PEER_CONFIG_BAD_SIGNATURE_CONFIG_PATH,
  wrong_key: process.env.VH_MESH_PEER_CONFIG_WRONG_KEY_CONFIG_PATH,
  local_peers: process.env.VH_MESH_PEER_CONFIG_LOCAL_PEERS_CONFIG_PATH,
};

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('VH_MESH_DEPLOYED_WSS_CONFIG_PORT must be a positive integer');
}
if (!positiveFixturePath || !rolloverFixturePath) {
  throw new Error('VH_MESH_DEPLOYED_WSS_PEER_CONFIG_PATH and VH_MESH_DEPLOYED_WSS_ROLLOVER_CONFIG_PATH are required');
}
if (!certPath || !keyPath) {
  throw new Error('VH_MESH_TLS_CERT_PATH and VH_MESH_TLS_KEY_PATH are required');
}

const fixtures = new Map([
  ['positive', positiveFixturePath],
  ['rollover', rolloverFixturePath],
  ...Object.entries(optionalFixtureEnv).filter((entry) => Boolean(entry[1])),
]);
let activeFixtureLabel = 'positive';
let configHits = 0;
const configHitsByLabel = {};

function activeFixturePath() {
  return fixtures.get(activeFixtureLabel) ?? positiveFixturePath;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-vh-mesh-control-token');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = https.createServer(
  {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  },
  async (req, res) => {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', `https://${host}:${port}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true, service: 'vh-mesh-deployed-wss-peer-config' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__state') {
      sendJson(res, 200, {
        ok: true,
        active: activeFixtureLabel,
        available: Array.from(fixtures.keys()),
        config_hits: configHits,
        config_hits_by_label: configHitsByLabel,
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__control/rollover') {
      if (controlToken && req.headers['x-vh-mesh-control-token'] !== controlToken) {
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return;
      }
      activeFixtureLabel = 'rollover';
      sendJson(res, 200, { ok: true, active: 'rollover' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__control/select') {
      if (controlToken && req.headers['x-vh-mesh-control-token'] !== controlToken) {
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return;
      }
      let body;
      try {
        body = await readRequestBody(req);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const active = typeof body.active === 'string' ? body.active : '';
      if (!fixtures.has(active)) {
        sendJson(res, 400, { ok: false, error: `unknown fixture ${active || 'missing'}`, available: Array.from(fixtures.keys()) });
        return;
      }
      activeFixtureLabel = active;
      sendJson(res, 200, { ok: true, active: activeFixtureLabel });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/mesh-peer-config.json') {
      try {
        configHits += 1;
        configHitsByLabel[activeFixtureLabel] = (configHitsByLabel[activeFixtureLabel] ?? 0) + 1;
        const body = fs.readFileSync(activeFixturePath(), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not-found' });
  },
);

server.listen(port, host, () => {
  console.log(`[vh:mesh-deployed-wss-peer-config] serving https://${host}:${port}/mesh-peer-config.json`);
});
