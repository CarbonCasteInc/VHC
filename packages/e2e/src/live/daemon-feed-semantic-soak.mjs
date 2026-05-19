#!/usr/bin/env node

import { loadEnvFileFromEnv } from './envFile.mjs';
import { logDaemonFeedSemanticSoakFatal, runDaemonFeedSemanticSoak } from './daemon-feed-semantic-soak-core.mjs';

loadEnvFileFromEnv();

runDaemonFeedSemanticSoak().catch((error) => {
  logDaemonFeedSemanticSoakFatal(error);
  process.exit(1);
});
