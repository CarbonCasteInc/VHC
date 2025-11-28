/* Simple Gun relay for local/dev usage */
const http = require('http');
const Gun = require('gun/gun');
// Ensure Gun.text.random exists before loading the ws adapter
if (!Gun.text) {
  Gun.text = {};
}
if (!Gun.text.random) {
  Gun.text.random = (len = 6) => Math.random().toString(36).slice(2, 2 + len);
}
require('gun/lib/ws');
require('gun/lib/store');
require('gun/lib/rfs');

const port = process.env.GUN_PORT || 7777;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end('vh relay alive\n');
});

// Disable axe to keep CPU usage predictable; enable radisk for persistence.
Gun({
  web: server,
  radisk: true,
  file: 'data',
  axe: false,
});

server.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[vh:relay] Gun relay listening on ${port}`);
});
