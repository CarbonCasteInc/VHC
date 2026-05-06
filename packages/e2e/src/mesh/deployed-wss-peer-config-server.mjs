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

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('VH_MESH_DEPLOYED_WSS_CONFIG_PORT must be a positive integer');
}
if (!positiveFixturePath || !rolloverFixturePath) {
  throw new Error('VH_MESH_DEPLOYED_WSS_PEER_CONFIG_PATH and VH_MESH_DEPLOYED_WSS_ROLLOVER_CONFIG_PATH are required');
}
if (!certPath || !keyPath) {
  throw new Error('VH_MESH_TLS_CERT_PATH and VH_MESH_TLS_KEY_PATH are required');
}

let activeFixturePath = positiveFixturePath;
let configHits = 0;

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
  (req, res) => {
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
        active: activeFixturePath === rolloverFixturePath ? 'rollover' : 'positive',
        config_hits: configHits,
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__control/rollover') {
      if (controlToken && req.headers['x-vh-mesh-control-token'] !== controlToken) {
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return;
      }
      activeFixturePath = rolloverFixturePath;
      sendJson(res, 200, { ok: true, active: 'rollover' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/mesh-peer-config.json') {
      try {
        configHits += 1;
        const body = fs.readFileSync(activeFixturePath, 'utf8');
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
