import { startStoryClusterServer } from '../../services/storycluster-engine/dist/server.js';
import { FileClusterStore } from '../../services/storycluster-engine/dist/clusterStore.js';

const host = process.env.VH_STORYCLUSTER_SERVER_HOST?.trim() || '127.0.0.1';
const port = Number.parseInt(process.env.VH_STORYCLUSTER_SERVER_PORT?.trim() || '4310', 10);
const authToken = process.env.VH_STORYCLUSTER_SERVER_AUTH_TOKEN?.trim() || undefined;
const stateDir = process.env.VH_STORYCLUSTER_STATE_DIR?.trim() || undefined;

const server = startStoryClusterServer({
  host,
  port,
  authToken,
  store: stateDir ? new FileClusterStore(stateDir) : undefined,
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[vh:local-storycluster] started', {
  host,
  port,
  stateDir,
  testProvider: process.env.VH_STORYCLUSTER_USE_TEST_PROVIDER === 'true',
});
