/* Minimal Gun relay for local/dev usage */
const http = require('http');
const path = require('path');
const { createRequire } = require('module');

// Load Gun from the workspace package that owns the dependency.
// Root workspace does not declare `gun`, so plain require('gun') fails.
const gunRequire = createRequire(
  path.resolve(__dirname, '../../packages/gun-client/node_modules/gun/gun.js')
);
const Gun = gunRequire('gun');

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

const port = process.env.GUN_PORT || 7777;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end('vh relay alive\n');
});

// Minimal, stable Gun relay (no custom hooks)
Gun({
  web: server,
  radisk: true,
  file: 'data',
  axe: false,
  peers: [] // explicit empty list to keep ws adapter happy
});

server.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[vh:relay] Gun relay listening on ${port}`);
});
