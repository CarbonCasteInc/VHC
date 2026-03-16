import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readDiscoveryVisibleStoryLimit,
  runSemanticSoakProbe,
} from './daemon-feed-semantic-soak-profile-discovery.mjs';

const DEFAULT_SURVEY_RUNS = 3;
const DEFAULT_MIN_VISIBLE_RUN_RATE = 0.67;
const DEFAULT_TOP_HEADLINE_LIMIT = 5;

function isFeedSource(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.name === 'string'
    && value.name.trim().length > 0
    && typeof value.displayName === 'string'
    && value.displayName.trim().length > 0
    && typeof value.rssUrl === 'string'
    && value.rssUrl.trim().length > 0
    && typeof value.perspectiveTag === 'string'
    && value.perspectiveTag.trim().length > 0
    && typeof value.iconKey === 'string'
    && value.iconKey.trim().length > 0
    && typeof value.enabled === 'boolean';
}

function parseSurveySources(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('source-survey-sources-must-be-an-array');
  }

  const sources = parsed.filter(isFeedSource);
  if (sources.length === 0) {
    throw new Error('source-survey-sources-empty');
  }
  return sources;
}

export function readSurveySources(env = process.env, readFile = readFileSync) {
  const inline = env.VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON?.trim();
  if (inline) {
    return parseSurveySources(inline);
  }

  const filePath = env.VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_FILE?.trim();
  if (filePath) {
    return parseSurveySources(readFile(filePath, 'utf8'));
  }

  throw new Error(
    'source-survey-sources-required: set VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_JSON or VH_PUBLIC_SEMANTIC_SOAK_SURVEY_SOURCES_FILE',
  );
}

export function surveyArtifactRoot(env = process.env, cwd = process.cwd()) {
  const explicit = env.VH_PUBLIC_SEMANTIC_SOAK_SURVEY_ARTIFACT_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  return path.join(cwd, '.tmp', 'daemon-feed-semantic-soak', `source-survey-${Date.now()}`);
}

export function readSurveyRunCount(env = process.env) {
  const parsed = Number.parseInt(env.VH_PUBLIC_SEMANTIC_SOAK_SURVEY_RUNS?.trim() ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SURVEY_RUNS;
  }
  return parsed;
}

export function readSurveyMinVisibleRunRate(env = process.env) {
  const parsed = Number.parseFloat(env.VH_PUBLIC_SEMANTIC_SOAK_SURVEY_MIN_VISIBLE_RUN_RATE?.trim() ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_MIN_VISIBLE_RUN_RATE;
  }
  return parsed;
}

function collectTopVisibleHeadlines(probes) {
  const headlineCounts = new Map();

  for (const probe of probes) {
    for (const story of probe.visibleStories ?? []) {
      const headline = String(story?.headline ?? '').trim();
      if (!headline) {
        continue;
      }
      headlineCounts.set(headline, (headlineCounts.get(headline) ?? 0) + 1);
    }
  }

  return [...headlineCounts.entries()]
    .sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0]))
    .slice(0, DEFAULT_TOP_HEADLINE_LIMIT)
    .map(([headline, count]) => ({ headline, count }));
}

export function summarizeSurveySource(source, probes, minVisibleRunRate = DEFAULT_MIN_VISIBLE_RUN_RATE) {
  const totalRuns = probes.length;
  const visibleRunCount = probes.filter((probe) => probe.visibleStoryCount > 0).length;
  const auditableRunCount = probes.filter((probe) => probe.auditableCount > 0).length;
  const totalVisibleStoryCount = probes.reduce((sum, probe) => sum + probe.visibleStoryCount, 0);
  const maxVisibleStoryCount = probes.reduce((max, probe) => Math.max(max, probe.visibleStoryCount), 0);
  const visibleRunRate = totalRuns > 0 ? visibleRunCount / totalRuns : 0;

  return {
    source,
    totalRuns,
    visibleRunCount,
    visibleRunRate,
    auditableRunCount,
    averageVisibleStoryCount: totalRuns > 0 ? totalVisibleStoryCount / totalRuns : 0,
    maxVisibleStoryCount,
    topVisibleHeadlines: collectTopVisibleHeadlines(probes),
    recommended: visibleRunRate >= minVisibleRunRate,
    probes,
  };
}

export function runSourceSurvey({
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  log = console.log,
  runProbe = runSemanticSoakProbe,
} = {}) {
  const sources = readSurveySources(env, readFile);
  const artifactRoot = surveyArtifactRoot(env, cwd);
  const runCount = readSurveyRunCount(env);
  const minVisibleRunRate = readSurveyMinVisibleRunRate(env);
  const probeTimeoutMs = env.VH_PUBLIC_SEMANTIC_SOAK_SURVEY_TIMEOUT_MS?.trim() || '60000';
  const visibleStoryLimit = readDiscoveryVisibleStoryLimit(env);

  mkdir(artifactRoot, { recursive: true });

  log(`[vh:daemon-soak:survey] build starting (${sources.length} sources x ${runCount} runs)`);
  const build = spawn('pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:build'], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFile(path.join(artifactRoot, 'build.stdout.log'), build.stdout ?? '', 'utf8');
  writeFile(path.join(artifactRoot, 'build.stderr.log'), build.stderr ?? '', 'utf8');
  if (build.status !== 0) {
    throw new Error(`source-survey-build-failed:${build.status}`);
  }

  const sourceSummaries = sources.map((source, sourceIndex) => {
    const sourceDir = path.join(artifactRoot, `source-${sourceIndex + 1}-${source.id}`);
    const probeEnvOverrides = {
      VH_LIVE_DEV_FEED_SOURCES_JSON: JSON.stringify([source]),
      VH_LIVE_DEV_FEED_SOURCE_IDS: '',
      VITE_NEWS_FEED_SOURCES: '',
    };
    const probes = [];

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const runLabel = `${runIndex + 1}/${runCount}`;
      log(`[vh:daemon-soak:survey] source ${sourceIndex + 1}/${sources.length} run ${runLabel}: ${source.id}`);
      probes.push(runProbe({
        cwd,
        env,
        profile: source.id,
        probeDir: path.join(sourceDir, `run-${runIndex + 1}`),
        probeTimeoutMs,
        probeEnvOverrides,
        spawn,
        mkdir,
        readFile,
        writeFile,
        visibleStoryLimit,
      }));
    }

    return summarizeSurveySource(source, probes, minVisibleRunRate);
  });

  const recommendedSources = sourceSummaries
    .filter((summary) => summary.recommended)
    .sort((left, right) =>
      (right.visibleRunRate - left.visibleRunRate)
      || (right.averageVisibleStoryCount - left.averageVisibleStoryCount)
      || left.source.id.localeCompare(right.source.id))
    .map((summary) => summary.source);

  const report = {
    schemaVersion: 'daemon-feed-semantic-soak-source-survey-v1',
    generatedAt: new Date().toISOString(),
    artifactRoot,
    runCount,
    minVisibleRunRate,
    visibleStoryLimit,
    sources,
    recommendedSourceIds: recommendedSources.map((source) => source.id),
    sourceSummaries,
  };

  const reportPath = path.join(artifactRoot, 'source-survey-report.json');
  writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  log(`[vh:daemon-soak:survey] report: ${reportPath}`);
  return { artifactRoot, reportPath, report };
}

/* c8 ignore start */
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const result = runSourceSurvey();
    console.log(JSON.stringify({
      reportPath: result.reportPath,
      recommendedSourceIds: result.report.recommendedSourceIds,
    }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[vh:daemon-soak:survey] fatal: ${message}`);
    process.exit(1);
  }
}
/* c8 ignore stop */
