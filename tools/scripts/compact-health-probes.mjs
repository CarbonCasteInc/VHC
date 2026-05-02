#!/usr/bin/env node
import Gun from 'gun';

const peer = process.env.VH_GUN_PEER ?? process.env.VITE_GUN_PEERS?.split(',')[0] ?? 'http://127.0.0.1:7777/gun';
const settleMs = Number.parseInt(process.env.VH_HEALTH_COMPACTION_SETTLE_MS ?? '5000', 10);
const prefixes = ['__vh_health_probe_', 'vh_health_probe_'];

const gun = Gun({
  peers: [peer],
  localStorage: false,
  radisk: false,
  file: false,
  axe: false,
});

const healthRoot = gun.get('vh').get('__health');
let scanned = 0;
let tombstoned = 0;

const shouldTombstone = (key) => prefixes.some((prefix) => key.startsWith(prefix));

healthRoot.map().once((_data, key) => {
  if (typeof key !== 'string') {
    return;
  }
  scanned += 1;
  if (!shouldTombstone(key)) {
    return;
  }
  tombstoned += 1;
  healthRoot.get(key).put(null);
});

setTimeout(() => {
  console.log(JSON.stringify({ peer, scanned, tombstoned }, null, 2));
  gun.off();
  process.exit(0);
}, Number.isFinite(settleMs) && settleMs > 0 ? settleMs : 5000);
