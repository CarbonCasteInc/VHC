import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

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

const COVERAGE_ALLOWLIST = [
  /^apps\/web-pwa\/src\/components\/feed\/CellVoteControls\.tsx$/,
  /^apps\/web-pwa\/src\/components\/AnalysisView\.tsx$/,
  /^apps\/web-pwa\/src\/hooks\/useSentimentState\.ts$/,
];

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
  /^apps\/web-pwa\/src\/store\/news\/types\.ts$/,
  /^apps\/web-pwa\/src\/store\/discovery\/types\.ts$/,
  /^apps\/web-pwa\/src\/hooks\/(useIdentity|useRegion|useFeedStore|useSentimentState)\.ts$/,
  /^apps\/web-pwa\/src\/utils\/markdown\.ts$/,
  /^packages\/e2e\//,
  /^packages\/gun-client\/src\/storage\//,
  /^packages\/gun-client\/src\/(types|hermesCrypto|topology|auth|chain|hermesAdapters)\.ts$/,
  /^packages\/gun-client\/src\/sync\/barrier\.ts$/,
  /^packages\/ai-engine\/src\/(index|schema|useAI|validation|worker|cache|prompts|localMlEngine)\.ts$/,
  /^packages\/types\/src\/(attestation|identity)\.ts$/,
  /^packages\/[^/]+\/src\/index\.ts$/,
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
  if (COVERAGE_ALLOWLIST.some((pattern) => pattern.test(filePath))) {
    return true;
  }
  return !COVERAGE_EXCLUDES.some((pattern) => pattern.test(filePath));
}

function runVitestCoverage(includedFiles) {
  const coverageDir = '.coverage-diff';
  rmSync(coverageDir, { recursive: true, force: true });

  const vitestArgs = [
    'vitest',
    'run',
    '--coverage',
    '--coverage.reporter=lcovonly',
    '--coverage.reporter=text-summary',
    `--coverage.reportsDirectory=${coverageDir}`,
    // Diff-aware policy: thresholds are enforced per changed file below.
    '--coverage.thresholds.lines=0',
    '--coverage.thresholds.functions=0',
    '--coverage.thresholds.statements=0',
    '--coverage.thresholds.branches=0',
  ];

  for (const filePath of includedFiles) {
    vitestArgs.push(`--coverage.include=${filePath}`);
  }

  const result = spawnSync('pnpm', vitestArgs, { stdio: 'inherit' });
  if (result.error) {
    fail(`failed to execute vitest: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail('coverage run failed before per-file threshold checks');
  }

  const lcovPath = path.join(coverageDir, 'lcov.info');
  if (!existsSync(lcovPath)) {
    fail(`coverage report not found at ${lcovPath}`);
  }

  return lcovPath;
}

function parseLcov(lcovPath) {
  const text = readFileSync(lcovPath, 'utf8');
  const records = text.split('end_of_record');
  const byFile = new Map();

  for (const record of records) {
    const lines = record.split('\n').map((line) => line.trim()).filter(Boolean);
    const sfLine = lines.find((line) => line.startsWith('SF:'));
    if (!sfLine) continue;

    const filePath = sfLine.slice(3).replace(/\\/g, '/');
    let linesTotal = 0;
    let linesCovered = 0;
    let branchesTotal = 0;
    let branchesCovered = 0;
    const uncoveredLines = [];
    const uncoveredBranchLines = new Set();

    for (const line of lines) {
      if (line.startsWith('DA:')) {
        const [lineNoRaw, hitsRaw] = line.slice(3).split(',');
        const lineNo = Number.parseInt(lineNoRaw, 10);
        const hits = Number.parseInt(hitsRaw, 10);
        if (Number.isNaN(lineNo) || Number.isNaN(hits)) continue;

        linesTotal += 1;
        if (hits > 0) {
          linesCovered += 1;
        } else {
          uncoveredLines.push(lineNo);
        }
      }

      if (line.startsWith('BRDA:')) {
        const [lineNoRaw, , , takenRaw] = line.slice(5).split(',');
        const lineNo = Number.parseInt(lineNoRaw, 10);
        const taken = takenRaw === '-' ? -1 : Number.parseInt(takenRaw, 10);
        if (Number.isNaN(lineNo) || Number.isNaN(taken)) continue;

        branchesTotal += 1;
        if (taken > 0) {
          branchesCovered += 1;
        } else {
          uncoveredBranchLines.add(lineNo);
        }
      }
    }

    byFile.set(filePath, {
      linesTotal,
      linesCovered,
      branchesTotal,
      branchesCovered,
      uncoveredLines,
      uncoveredBranchLines: [...uncoveredBranchLines].sort((a, b) => a - b),
    });
  }

  return byFile;
}

function resolveCoverageRecord(byFile, filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (byFile.has(normalized)) {
    return byFile.get(normalized);
  }

  for (const [coveredPath, record] of byFile.entries()) {
    if (coveredPath.endsWith(normalized)) {
      return record;
    }
  }

  return null;
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

  const lcovPath = runVitestCoverage(includedFiles);
  const coverageByFile = parseLcov(lcovPath);

  const failures = [];
  for (const filePath of includedFiles) {
    const record = resolveCoverageRecord(coverageByFile, filePath);
    if (!record) {
      failures.push(`${filePath}: missing coverage record`);
      continue;
    }

    const linePass = record.linesCovered === record.linesTotal;
    const branchPass = record.branchesCovered === record.branchesTotal;

    const linePct = record.linesTotal === 0
      ? 100
      : ((record.linesCovered / record.linesTotal) * 100).toFixed(2);
    const branchPct = record.branchesTotal === 0
      ? 100
      : ((record.branchesCovered / record.branchesTotal) * 100).toFixed(2);

    console.log(
      `Diff Coverage: ${filePath} lines ${record.linesCovered}/${record.linesTotal} (${linePct}%) | branches ${record.branchesCovered}/${record.branchesTotal} (${branchPct}%)`,
    );

    if (!linePass || !branchPass) {
      const details = [];
      if (!linePass) {
        details.push(`uncovered lines: ${record.uncoveredLines.join(', ') || 'n/a'}`);
      }
      if (!branchPass) {
        details.push(`uncovered branch lines: ${record.uncoveredBranchLines.join(', ') || 'n/a'}`);
      }
      failures.push(`${filePath}: ${details.join(' | ')}`);
    }
  }

  if (failures.length > 0) {
    fail(`per-file diff thresholds not met (100% lines + 100% branches):\n${failures.join('\n')}`);
  }

  console.log('Diff Coverage: PASS - changed source files met per-file 100% line + branch coverage.');
}

main();
