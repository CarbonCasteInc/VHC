#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import {
  buildPromotionDecision,
  loadPromotionDecisionArtifacts,
  writePromotionDecision,
} from './daemon-feed-semantic-soak-decision.mjs';

export function runDaemonFeedSemanticSoakReadiness({
  env = process.env,
  log = console.log,
  writeFile = writeFileSync,
} = {}) {
  const artifacts = loadPromotionDecisionArtifacts({
    artifactRoot: env.VH_DAEMON_FEED_SOAK_ARTIFACT_ROOT?.trim(),
    artifactDir: env.VH_DAEMON_FEED_SOAK_ARTIFACT_DIR?.trim(),
  });
  const decision = buildPromotionDecision(artifacts);
  writePromotionDecision(decision, writeFile);
  log(JSON.stringify(decision, null, 2));
  return decision;
}

/* v8 ignore next 10 */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runDaemonFeedSemanticSoakReadiness();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[vh:daemon-soak:readiness] fatal: ${message}`);
    process.exit(1);
  }
}
