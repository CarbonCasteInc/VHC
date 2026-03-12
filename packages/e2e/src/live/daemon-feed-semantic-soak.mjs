#!/usr/bin/env node

import { logDaemonFeedSemanticSoakFatal, runDaemonFeedSemanticSoak } from './daemon-feed-semantic-soak-core.mjs';

runDaemonFeedSemanticSoak().catch((error) => {
  logDaemonFeedSemanticSoakFatal(error);
  process.exit(1);
});
