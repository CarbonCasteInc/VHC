#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(repoRoot, 'packages/e2e/node_modules/@playwright/test'));

const DEFAULT_OUTPUT_DIR = path.join(
  repoRoot,
  'docs/reports/evidence/2026-02-21-canary-rerun',
);

const TARGET = (process.env.CANARY_TARGET || 'https://ccibootstrap.tail6cc9b5.ts.net').replace(/\/$/, '');
const OUTPUT_DIR = process.env.CANARY_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;

const PHASES = [
  { name: '5%', count: 20, forceClientUnavailable: false, nullifier: 'canary-nf-05' },
  { name: '25%', count: 40, forceClientUnavailable: false, nullifier: 'canary-nf-25' },
  { name: '50%', count: 60, forceClientUnavailable: false, nullifier: 'canary-nf-50' },
  { name: '100%', count: 80, forceClientUnavailable: false, nullifier: 'canary-nf-100' },
  { name: 'breach-sim', count: 40, forceClientUnavailable: true, nullifier: 'canary-breach' },
];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function summarizeMetrics(phaseName, metrics) {
  const identityReason = 'Identity nullifier unavailable; create/sign in before voting';
  const admission = metrics.admission || [];
  const mesh = metrics.mesh || [];

  const effectiveAdmission = admission.filter(
    (e) => !(e.admitted === false && e.reason === identityReason),
  );
  const denied = effectiveAdmission.filter((e) => e.admitted === false);
  const denialRate = effectiveAdmission.length > 0 ? (denied.length / effectiveAdmission.length) * 100 : 0;

  const meshTotal = mesh.length;
  const meshSuccess = mesh.filter((e) => e.success === true).length;
  const meshSuccessRate = meshTotal > 0 ? (meshSuccess / meshTotal) * 100 : 0;
  const latencies = mesh.map((e) => Number(e.latency_ms)).filter((n) => Number.isFinite(n));
  const p95 = quantile(latencies, 0.95);

  return {
    phaseName,
    admissionTotal: admission.length,
    effectiveAdmissionTotal: effectiveAdmission.length,
    deniedCount: denied.length,
    denialRatePct: Number(denialRate.toFixed(4)),
    meshTotal,
    meshSuccess,
    meshSuccessRatePct: Number(meshSuccessRate.toFixed(4)),
    latencyP95Ms: p95,
    hasIdentity: Boolean(metrics.meta?.hasIdentity),
    hasClientBeforePhase: Boolean(metrics.meta?.hasClientBeforePhase),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createLogger(logPath) {
  const stream = fs.createWriteStream(logPath, { flags: 'a' });
  return {
    log(...parts) {
      const line = `${nowIso()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
      stream.write(line + '\n');
      process.stdout.write(line + '\n');
    },
    close() {
      stream.end();
    },
  };
}

async function ensureIdentity(page, logger) {
  await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });

  const userLink = page.getByTestId('user-link');
  await userLink.waitFor({ state: 'visible', timeout: 45000 });
  await userLink.click();
  await page.waitForURL('**/dashboard', { timeout: 45000 });

  const createBtn = page.getByTestId('create-identity-btn');
  if (await createBtn.count()) {
    logger.log('identity:create:start');
    const username = `Canary${Date.now().toString().slice(-5)}`;
    const handle = username.toLowerCase();
    const nameInput = page.locator('input[placeholder="Choose a username"]');
    const handleInput = page.locator('input[placeholder="Choose a handle (letters, numbers, _)"]');
    if (await nameInput.count()) await nameInput.fill(username);
    if (await handleInput.count()) await handleInput.fill(handle);
    await createBtn.click();
    await page.waitForTimeout(5000);
    logger.log('identity:create:done', username, handle);
  } else {
    logger.log('identity:already-present');
  }
}

async function runPhase(context, phaseCfg, logger) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const page = await context.newPage();
    try {
      logger.log(`phase:${phaseCfg.name}:attempt:${attempt}:start`);
      await page.goto(`${TARGET}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(1200);

      const metrics = await page.evaluate(async (phase) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const metrics = { admission: [], mesh: [], meta: {}, voteCalls: [] };

        const originalInfo = console.info.bind(console);
        const originalWarn = console.warn.bind(console);

        console.info = (...args) => {
          if (args[0] === '[vh:vote:admission]' && typeof args[1] === 'object') {
            metrics.admission.push({ ...args[1], ts: Date.now(), level: 'info' });
          }
          if (args[0] === '[vh:vote:mesh-write]' && typeof args[1] === 'object') {
            metrics.mesh.push({ ...args[1], ts: Date.now(), level: 'info' });
          }
          originalInfo(...args);
        };

        console.warn = (...args) => {
          if (args[0] === '[vh:vote:mesh-write]' && typeof args[1] === 'object') {
            metrics.mesh.push({ ...args[1], ts: Date.now(), level: 'warn' });
          }
          originalWarn(...args);
        };

        try {
          const { useAppStore, authenticateGunUser, publishDirectoryEntry } = await import('/src/store/index.ts');
          const { loadIdentityRecord } = await import('/src/utils/vaultTyped.ts');
          const { useSentimentState } = await import('/src/hooks/useSentimentState.ts');
          const { getRealConstituencyProof } = await import('/src/store/bridge/realConstituencyProof.ts');
          const { getConfiguredDistrict } = await import('/src/store/bridge/districtConfig.ts');

          if (typeof useAppStore.getState().init === 'function') {
            await useAppStore.getState().init();
          }

          let retries = 0;
          while (!useAppStore.getState().client && retries < 120) {
            await sleep(250);
            retries += 1;
          }

          const originalClient = useAppStore.getState().client;
          const identity = await loadIdentityRecord();
          metrics.meta.hasClientBeforePhase = Boolean(originalClient);
          metrics.meta.hasIdentity = Boolean(identity);

          if (!phase.forceClientUnavailable && !originalClient) {
            throw new Error('client-unavailable-before-phase');
          }

          if (originalClient && identity?.devicePair) {
            try {
              await authenticateGunUser(originalClient, identity.devicePair);
              await publishDirectoryEntry(originalClient, identity);
            } catch {
              // best-effort
            }
          }

          if (phase.forceClientUnavailable) {
            useAppStore.setState({ client: null });
          }

          const district = getConfiguredDistrict();
          const proof = getRealConstituencyProof(phase.nullifier, district);
          const topicId = `canary-topic-${new Date().toISOString().slice(0, 10)}`;
          const synthesisId = `canary-synthesis-${new Date().toISOString().slice(0, 10)}`;
          const epoch = 1;
          const points = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

          for (let i = 0; i < phase.count; i += 1) {
            const pointId = points[i % points.length];
            const desired = i % 2 === 0 ? 1 : -1;
            const result = useSentimentState.getState().setAgreement({
              topicId,
              pointId,
              synthesisPointId: pointId,
              synthesisId,
              epoch,
              analysisId: synthesisId,
              desired,
              constituency_proof: proof,
            });
            metrics.voteCalls.push({
              idx: i,
              pointId,
              desired,
              denied: Boolean(result?.denied),
              reason: result?.reason ?? null,
              ts: Date.now(),
            });
            await sleep(60);
          }

          await sleep(8000);

          if (phase.forceClientUnavailable) {
            useAppStore.setState({ client: originalClient });
          }

          return metrics;
        } finally {
          console.info = originalInfo;
          console.warn = originalWarn;
        }
      }, phaseCfg);

      await page.close();
      logger.log(`phase:${phaseCfg.name}:attempt:${attempt}:ok`);
      return metrics;
    } catch (error) {
      lastError = error;
      logger.log(`phase:${phaseCfg.name}:attempt:${attempt}:error`, String(error?.message || error));
      try {
        await page.close();
      } catch {
        // noop
      }
      await sleep(1500);
    }
  }

  throw lastError;
}

function buildVoteReliability(phaseResults) {
  const rows = [];
  for (const result of phaseResults) {
    const phaseName = result.phase.name;
    const admission = result.metrics.admission || [];
    const mesh = result.metrics.mesh || [];

    const maxLen = Math.max(admission.length, mesh.length);
    for (let i = 0; i < maxLen; i += 1) {
      const a = admission[i] || null;
      const m = mesh[i] || null;
      rows.push({
        phase: phaseName,
        index: i,
        admitted: a ? Boolean(a.admitted) : null,
        admissionReason: a?.reason ?? null,
        meshWriteSuccess: m ? Boolean(m.success) : null,
        meshWriteLatencyMs: m?.latency_ms ?? null,
        error: m?.error ?? null,
        terminalOutcome: Boolean(m),
        point_id: m?.point_id ?? a?.point_id ?? null,
        topic_id: m?.topic_id ?? a?.topic_id ?? null,
      });
    }
  }

  const admittedRows = rows.filter((r) => r.admitted === true);
  const terminalRows = admittedRows.filter((r) => r.terminalOutcome === true);
  const meshSuccessRows = terminalRows.filter((r) => r.meshWriteSuccess === true);
  const latencies = terminalRows
    .map((r) => Number(r.meshWriteLatencyMs))
    .filter((n) => Number.isFinite(n));

  return {
    generatedAt: nowIso(),
    perVote: rows,
    summary: {
      totalRows: rows.length,
      admittedRows: admittedRows.length,
      terminalOutcomeRows: terminalRows.length,
      silentDrops: admittedRows.length - terminalRows.length,
      meshWriteSuccessRows: meshSuccessRows.length,
      terminalSuccessRatePct:
        terminalRows.length > 0 ? Number(((meshSuccessRows.length / terminalRows.length) * 100).toFixed(4)) : 0,
      p95LatencyMs: quantile(latencies, 0.95),
    },
  };
}

(async () => {
  ensureDir(OUTPUT_DIR);
  const logger = createLogger(path.join(OUTPUT_DIR, 'canary-run.log'));
  logger.log('canary:start', { target: TARGET, outputDir: OUTPUT_DIR });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    const identityPage = await context.newPage();
    await ensureIdentity(identityPage, logger);
    await identityPage.close();

    const phaseResults = [];
    for (const phase of PHASES) {
      const metrics = await runPhase(context, phase, logger);
      phaseResults.push({ phase, metrics, summary: summarizeMetrics(phase.name, metrics) });
    }

    const healthy = phaseResults.filter((r) => !r.phase.forceClientUnavailable);
    const healthySummaries = healthy.map((r) => r.summary);
    const breach = phaseResults.find((r) => r.phase.forceClientUnavailable);
    const breachSummary = breach?.summary ?? null;

    const healthyDenied = healthySummaries.reduce((acc, s) => acc + (s.deniedCount || 0), 0);
    const healthyEffectiveAdmission = healthySummaries.reduce((acc, s) => acc + (s.effectiveAdmissionTotal || 0), 0);
    const healthyMeshSuccess = healthySummaries.reduce((acc, s) => acc + (s.meshSuccess || 0), 0);
    const healthyMeshTotal = healthySummaries.reduce((acc, s) => acc + (s.meshTotal || 0), 0);
    const healthyLatencies = healthy.flatMap((r) =>
      (r.metrics.mesh || [])
        .map((m) => Number(m.latency_ms))
        .filter((n) => Number.isFinite(n)),
    );

    const aggregateDenialRatePct =
      healthyEffectiveAdmission > 0 ? Number(((healthyDenied / healthyEffectiveAdmission) * 100).toFixed(4)) : 0;
    const aggregateMeshSuccessRatePct =
      healthyMeshTotal > 0 ? Number(((healthyMeshSuccess / healthyMeshTotal) * 100).toFixed(4)) : 0;
    const aggregateP95LatencyMs = quantile(healthyLatencies, 0.95);

    const slo = {
      denialRatePct: aggregateDenialRatePct,
      meshWriteSuccessRatePct: aggregateMeshSuccessRatePct,
      p95LatencyMs: aggregateP95LatencyMs,
      targets: {
        denialRateLtPct: 2,
        meshWriteSuccessGtPct: 98,
        p95LatencyLtMs: 3000,
      },
      pass: {
        denialRate: aggregateDenialRatePct < 2,
        meshWriteSuccess: aggregateMeshSuccessRatePct > 98,
        p95Latency: typeof aggregateP95LatencyMs === 'number' && aggregateP95LatencyMs < 3000,
      },
    };

    const breachDistinctFromHealthy =
      breachSummary != null
        ? breachSummary.meshSuccessRatePct < aggregateMeshSuccessRatePct ||
          breachSummary.hasClientBeforePhase !== true
        : false;

    const summary = {
      generatedAt: nowIso(),
      target: TARGET,
      outputDir: OUTPUT_DIR,
      phaseResults: phaseResults.map((r) => ({ phase: r.phase, summary: r.summary })),
      healthySummaries,
      breachSummary,
      aggregate: {
        healthy: {
          denied: healthyDenied,
          effectiveAdmission: healthyEffectiveAdmission,
          meshSuccess: healthyMeshSuccess,
          meshTotal: healthyMeshTotal,
          hasClientBeforePhaseAllTrue: healthySummaries.every((s) => s.hasClientBeforePhase === true),
        },
      },
      slo,
      acceptance: {
        healthyMeshSuccessNonZero: healthyMeshSuccess > 0,
        breachSimDistinguishable: breachDistinctFromHealthy,
        autoAbortTriggered: !(slo.pass.denialRate && slo.pass.meshWriteSuccess && slo.pass.p95Latency),
      },
    };

    const voteReliability = buildVoteReliability(phaseResults);
    const breachEvidence = {
      generatedAt: nowIso(),
      target: TARGET,
      breachPhase: breach?.phase ?? null,
      breachSummary,
      healthyAggregateMeshSuccessRatePct: aggregateMeshSuccessRatePct,
      healthyAggregateDenialRatePct: aggregateDenialRatePct,
      healthyHasClientBeforePhaseAllTrue: healthySummaries.every((s) => s.hasClientBeforePhase === true),
      distinguishableFromHealthy: breachDistinctFromHealthy,
      rationale: breachDistinctFromHealthy
        ? 'Breach-sim differs from healthy aggregate behavior.'
        : 'Breach-sim not sufficiently distinct from healthy behavior.',
    };

    fs.writeFileSync(path.join(OUTPUT_DIR, 'canary-summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'breach-sim-evidence.json'), JSON.stringify(breachEvidence, null, 2));
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'vote-reliability-report.json'),
      JSON.stringify(voteReliability, null, 2),
    );

    logger.log('canary:summary', summary.aggregate.healthy, summary.slo.pass, summary.acceptance);
    logger.log('canary:done');

    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    logger.close();
  }
})().catch((error) => {
  process.stderr.write(`CANARY_FATAL ${error?.stack || error}\n`);
  process.exit(1);
});
