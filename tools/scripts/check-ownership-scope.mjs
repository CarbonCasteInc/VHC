import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const OWNERSHIP_MAP_PATH = path.resolve('.github/ownership-map.json');
const COORD_PREFIX = 'coord/';

function fail(message) {
  console.error(`Ownership Scope: FAIL - ${message}`);
  process.exit(1);
}

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(`unable to execute "${command}": ${msg}`);
  }
}

function readOwnershipMap() {
  try {
    const raw = readFileSync(OWNERSHIP_MAP_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('ownership map must be a JSON object');
    }
    return parsed;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(`unable to read ${OWNERSHIP_MAP_PATH}: ${msg}`);
  }
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

function resolveHeadRef() {
  const headRef = process.env.GITHUB_HEAD_REF || run('git rev-parse --abbrev-ref HEAD');
  if (!headRef || headRef === 'HEAD') {
    fail('unable to resolve PR head branch name');
  }
  return headRef;
}

function inferBaseRef(headRef) {
  // Wave-1 team branches target integration/wave-1 by default.
  // Coordinator or other branches default to main unless GITHUB_BASE_REF is set.
  if (/^team-[a-e]\//.test(headRef)) {
    return 'integration/wave-1';
  }
  return 'main';
}

function resolveMergeBase() {
  const headRef = process.env.GITHUB_HEAD_REF || run('git rev-parse --abbrev-ref HEAD');
  const baseRef = process.env.GITHUB_BASE_REF || inferBaseRef(headRef);
  if (!/^[A-Za-z0-9._/-]+$/.test(baseRef)) {
    fail(`invalid base ref: ${baseRef}`);
  }
  const originRef = `origin/${baseRef}`;
  return run(`git merge-base HEAD ${originRef}`);
}

function changedFilesSince(mergeBase) {
  const raw = run(`git diff --name-only --diff-filter=ACDMRTUXB ${mergeBase}...HEAD`);
  return raw ? raw.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

function matchingTeam(headRef, ownershipMap) {
  const entries = Object.entries(ownershipMap);
  return entries.find(([, config]) => {
    if (!config || typeof config !== 'object') return false;
    if (typeof config.branchPrefix !== 'string') return false;
    return headRef.startsWith(config.branchPrefix);
  });
}

function validateTeamConfig(teamId, config) {
  if (!config || typeof config !== 'object') {
    fail(`invalid ownership config for ${teamId}`);
  }
  if (!Array.isArray(config.paths) || config.paths.length === 0) {
    fail(`ownership config for ${teamId} must include non-empty "paths"`);
  }
}

function main() {
  const ownershipMap = readOwnershipMap();
  const headRef = resolveHeadRef();

  if (headRef.startsWith(COORD_PREFIX)) {
    console.log(`Ownership Scope: PASS - coordinator branch "${headRef}" bypass enabled.`);
    return;
  }

  const teamMatch = matchingTeam(headRef, ownershipMap);
  if (!teamMatch) {
    const validPrefixes = Object.values(ownershipMap)
      .map((config) => config?.branchPrefix)
      .filter((value) => typeof value === 'string')
      .join(', ');
    fail(`branch "${headRef}" does not match any team prefix (${validPrefixes}) or "${COORD_PREFIX}*"`);
  }

  const [teamId, teamConfig] = teamMatch;
  validateTeamConfig(teamId, teamConfig);

  const matchers = teamConfig.paths.map((glob) => globToRegExp(glob));
  const mergeBase = resolveMergeBase();
  const changedFiles = changedFilesSince(mergeBase);

  if (changedFiles.length === 0) {
    console.log(`Ownership Scope: PASS - no changed files for ${headRef}.`);
    return;
  }

  const violations = changedFiles.filter((filePath) => !matchers.some((regex) => regex.test(filePath)));
  if (violations.length > 0) {
    fail(
      [
        `branch "${headRef}" is mapped to "${teamId}" but changed out-of-scope files:`,
        ...violations.map((file) => `  - ${file}`)
      ].join('\n')
    );
  }

  console.log(
    `Ownership Scope: PASS - ${headRef} (${teamId}) changed ${changedFiles.length} file(s) within owned paths.`
  );
}

main();
