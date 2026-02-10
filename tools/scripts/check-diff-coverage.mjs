import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function fail(message) {
  console.error(`Diff Coverage: FAIL - ${message}`);
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

function resolveHeadRef() {
  const headRef = process.env.GITHUB_HEAD_REF || run('git rev-parse --abbrev-ref HEAD');
  if (!headRef || headRef === 'HEAD') {
    fail('unable to resolve git head branch');
  }
  return headRef;
}

function inferBaseRef(headRef) {
  if (/^team-[a-e]\//.test(headRef)) {
    return 'integration/wave-1';
  }
  return 'main';
}

function resolveMergeBase() {
  const headRef = resolveHeadRef();
  const baseRef = process.env.GITHUB_BASE_REF || inferBaseRef(headRef);
  const originRef = `origin/${baseRef}`;
  if (!/^[A-Za-z0-9._/-]+$/.test(baseRef)) {
    fail(`invalid base ref: ${baseRef}`);
  }
  return run(`git merge-base HEAD ${originRef}`);
}

function changedFilesSince(mergeBase) {
  const raw = run(`git diff --name-only --diff-filter=ACMRTUXB ${mergeBase}...HEAD`);
  return raw ? raw.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

// Keep this deny-list intentionally small and shrinking over time.
// Any new exclusion should require explicit coordinator approval.
const COVERAGE_EXCLUDES = [
  /^apps\/web-pwa\/src\/main\.tsx$/,
  /^apps\/web-pwa\/src\/App\.tsx$/,
  /^apps\/web-pwa\/src\/routes\//,
  /^apps\/web-pwa\/src\/components\//,
  /^apps\/web-pwa\/src\/store\/chat\//,
  /^apps\/web-pwa\/src\/store\/forum\//,
  /^apps\/web-pwa\/src\/store\/index\.ts$/,
  /^apps\/web-pwa\/src\/hooks\/(useIdentity|useRegion|useFeedStore|useSentimentState)\.ts$/,
  /^apps\/web-pwa\/src\/utils\/markdown\.ts$/,
  /^packages\/e2e\//,
  /^packages\/gun-client\/src\/storage\//,
  /^packages\/gun-client\/src\/(types|hermesCrypto|topology|auth|chain|hermesAdapters)\.ts$/,
  /^packages\/gun-client\/src\/sync\/barrier\.ts$/,
  /^packages\/ai-engine\/src\/(index|schema|useAI|validation|worker|cache|prompts|localMlEngine)\.ts$/,
  /^packages\/types\/src\/(attestation|identity)\.ts$/,
  /^packages\/[^/]+\/src\/index\.ts$/
];

function isEligibleSourceFile(filePath) {
  if (!/^(packages\/[^/]+\/src\/|apps\/[^/]+\/src\/).+\.(ts|tsx)$/.test(filePath)) {
    return false;
  }
  if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) {
    return false;
  }
  if (/\.d\.ts$/.test(filePath)) {
    return false;
  }
  if (!existsSync(filePath)) {
    return false;
  }
  return !COVERAGE_EXCLUDES.some((pattern) => pattern.test(filePath));
}

function main() {
  const mergeBase = resolveMergeBase();
  const changedFiles = changedFilesSince(mergeBase);
  const includedFiles = changedFiles.filter(isEligibleSourceFile);

  if (includedFiles.length === 0) {
    console.log('Diff Coverage: PASS - no coverage-eligible source files changed.');
    return;
  }

  console.log(`Diff Coverage: running coverage for ${includedFiles.length} changed source file(s).`);
  includedFiles.forEach((filePath) => console.log(`  - ${filePath}`));

  const vitestArgs = ['vitest', 'run', '--coverage', '--coverage.reporter=text-summary'];
  for (const filePath of includedFiles) {
    vitestArgs.push(`--coverage.include=${filePath}`);
  }

  const result = spawnSync('pnpm', vitestArgs, { stdio: 'inherit' });
  if (result.error) {
    fail(`failed to execute vitest: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail('coverage check failed for changed source files');
  }

  console.log('Diff Coverage: PASS - changed source files met coverage gate.');
}

main();
