/**
 * Ownership Preflight Simulation
 *
 * Validates that a list of planned file paths are covered by the ownership map
 * for a given team/workstream before dispatch.
 *
 * Usage:
 *   node tools/scripts/check-ownership-preflight.mjs <team-id> <paths-file>
 *
 * Where:
 *   <team-id>    is a key in .github/ownership-map.json (e.g., "w2g", "team-a")
 *   <paths-file> is a text file with one planned file path per line
 *
 * Example:
 *   echo "apps/web-pwa/src/store/bridge/index.ts" > /tmp/gamma-paths.txt
 *   echo "packages/data-model/src/schemas/hermes/elevation.ts" >> /tmp/gamma-paths.txt
 *   node tools/scripts/check-ownership-preflight.mjs w2g /tmp/gamma-paths.txt
 *
 * Exit codes:
 *   0 = all paths covered
 *   1 = unmapped paths found (dispatch should not proceed)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const OWNERSHIP_MAP_PATH = path.resolve('.github/ownership-map.json');

function fail(message) {
  console.error(`Ownership Preflight: FAIL — ${message}`);
  process.exit(1);
}

function escapeRegex(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(glob) {
  const normalized = glob.endsWith('/') ? `${glob}**` : glob;
  const withSentinel = normalized.replace(/\*\*/g, '__DOUBLE_STAR__');
  const escaped = escapeRegex(withSentinel);
  // Replace single-star BEFORE expanding double-star sentinel,
  // so the `*` inside the expanded `.*` is not clobbered.
  const singleExpanded = escaped.replace(/\*/g, '[^/]*');
  const wildcardExpanded = singleExpanded.replace(/__DOUBLE_STAR__/g, '.*');
  return new RegExp(`^${wildcardExpanded}$`);
}

function main() {
  const [teamId, pathsFile] = process.argv.slice(2);

  if (!teamId || !pathsFile) {
    fail('Usage: check-ownership-preflight.mjs <team-id> <paths-file>');
  }

  // Read ownership map
  let ownershipMap;
  try {
    const raw = readFileSync(OWNERSHIP_MAP_PATH, 'utf8');
    ownershipMap = JSON.parse(raw);
  } catch (error) {
    fail(`Unable to read ${OWNERSHIP_MAP_PATH}: ${error.message}`);
  }

  // Validate team exists
  const teamConfig = ownershipMap[teamId];
  if (!teamConfig || !Array.isArray(teamConfig.paths) || teamConfig.paths.length === 0) {
    fail(`Team "${teamId}" not found in ownership map or has no paths defined.`);
  }

  // Read planned paths
  let plannedPaths;
  try {
    const raw = readFileSync(pathsFile, 'utf8');
    plannedPaths = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch (error) {
    fail(`Unable to read paths file "${pathsFile}": ${error.message}`);
  }

  if (plannedPaths.length === 0) {
    console.log('Ownership Preflight: PASS — no planned paths to check.');
    return;
  }

  // Build matchers from team's ownership globs
  const matchers = teamConfig.paths.map((glob) => globToRegExp(glob));

  // Check each planned path
  const covered = [];
  const unmapped = [];

  for (const filePath of plannedPaths) {
    const isCovered = matchers.some((regex) => regex.test(filePath));
    if (isCovered) {
      covered.push(filePath);
    } else {
      unmapped.push(filePath);
    }
  }

  // Report
  console.log(`Ownership Preflight: checking ${plannedPaths.length} path(s) for team "${teamId}"`);
  console.log(`  Covered: ${covered.length}`);
  console.log(`  Unmapped: ${unmapped.length}`);

  if (unmapped.length > 0) {
    console.log('');
    console.log('Unmapped paths (dispatch blocked until these are added to ownership map):');
    for (const p of unmapped) {
      console.log(`  ✗ ${p}`);
    }
    console.log('');
    fail(`${unmapped.length} planned path(s) are not covered by team "${teamId}" ownership rules.`);
  }

  console.log('');
  console.log(`Ownership Preflight: PASS — all ${plannedPaths.length} path(s) covered for team "${teamId}".`);
}

main();
