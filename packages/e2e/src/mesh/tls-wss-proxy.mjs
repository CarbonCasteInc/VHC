#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const port = Number.parseInt(process.env.VH_MESH_TLS_PROXY_PORT ?? '0', 10);
const host = process.env.VH_MESH_TLS_PROXY_HOST ?? '127.0.0.1';
const backendHost = process.env.VH_MESH_TLS_PROXY_BACKEND_HOST ?? '127.0.0.1';
const backendPort = Number.parseInt(process.env.VH_MESH_TLS_PROXY_BACKEND_PORT ?? '0', 10);
const certPath = process.env.VH_MESH_TLS_CERT_PATH;
const keyPath = process.env.VH_MESH_TLS_KEY_PATH;
const relayId = process.env.VH_MESH_TLS_PROXY_RELAY_ID ?? `tls-proxy-${port}`;

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('VH_MESH_TLS_PROXY_PORT must be a positive integer');
}
if (!Number.isFinite(backendPort) || backendPort <= 0) {
  throw new Error('VH_MESH_TLS_PROXY_BACKEND_PORT must be a positive integer');
}
if (!certPath || !keyPath) {
  throw new Error('VH_MESH_TLS_CERT_PATH and VH_MESH_TLS_KEY_PATH are required');
}

function proxyHttpRequest(req, res) {
  const proxy = http.request(
    {
      host: backendHost,
      port: backendPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: `${backendHost}:${backendPort}`,
      },
    },
    (backendRes) => {
      res.writeHead(backendRes.statusCode ?? 502, backendRes.headers);
      backendRes.pipe(res);
    },
  );
  proxy.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, relay_id: relayId, error: error.message }));
  });
  req.pipe(proxy);
}

function proxyUpgrade(req, clientSocket, head) {
  const backendSocket = net.connect({ host: backendHost, port: backendPort }, () => {
    const headers = [
      `GET ${req.url ?? '/gun'} HTTP/${req.httpVersion}`,
      ...req.rawHeaders.reduce((lines, value, index, rawHeaders) => {
        if (index % 2 === 0) {
          const name = value;
          const headerValue = rawHeaders[index + 1];
          if (name.toLowerCase() === 'host') {
            lines.push(`Host: ${backendHost}:${backendPort}`);
          } else {
            lines.push(`${name}: ${headerValue}`);
          }
        }
        return lines;
      }, []),
      '',
      '',
    ].join('\r\n');
    backendSocket.write(headers);
    if (head.length > 0) {
      backendSocket.write(head);
    }
    backendSocket.pipe(clientSocket);
    clientSocket.pipe(backendSocket);
  });
  clientSocket.on('error', () => {
    backendSocket.destroy();
  });
  backendSocket.on('error', () => {
    clientSocket.destroy();
  });
}

const server = https.createServer(
  {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  },
  proxyHttpRequest,
);

server.on('upgrade', proxyUpgrade);
server.on('clientError', (_error, socket) => {
  socket.destroy();
});
server.on('tlsClientError', () => {
  // Browser contexts close speculative TLS/WebSocket sockets during test
  // teardown; those resets are not relay health failures.
});
server.listen(port, host, () => {
  console.log(`[vh:mesh-tls-wss-proxy] ${relayId} listening on https://${host}:${port} -> http://${backendHost}:${backendPort}`);
});
