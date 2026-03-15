import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_DISCOVERY_PROFILES = Object.freeze([
  'cbs-politics,guardian-us',
  'nypost-politics,pbs-politics',
  'nbc-politics,nypost-politics',
  'guardian-us,huffpost-us',
  'bbc-us-canada,huffpost-us',
  'nbc-politics,pbs-politics',
]);

const DISCOVERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'after', 'against', 'amid', 'be', 'by', 'for', 'from',
  'in', 'into', 'is', 'it', 'its', 'near', 'of', 'on', 'or', 'over', 'says', 'say', 'says',
  'says', 'saying', 'the', 'their', 'to', 'under', 'up', 'us', 'who', 'with',
  'watch', 'what', 'why', 'how', 'after', 'amid', 'will',
]);

export function splitDiscoveryProfiles(raw) {
  return raw
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function readDiscoveryProfiles(env = process.env) {
  const explicit = env.VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_PROFILES?.trim();
  if (explicit) {
    return splitDiscoveryProfiles(explicit);
  }
  return [...DEFAULT_DISCOVERY_PROFILES];
}

export function discoveryArtifactRoot(env = process.env, cwd = process.cwd()) {
  const explicit = env.VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_ARTIFACT_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  return path.join(cwd, '.tmp', 'daemon-feed-semantic-soak', `profile-discovery-${Date.now()}`);
}

function normalizeToken(token) {
  const compact = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact.length < 3 || DISCOVERY_STOPWORDS.has(compact)) {
    return '';
  }
  if (compact.endsWith('ies') && compact.length > 4) {
    return `${compact.slice(0, -3)}y`;
  }
  if (compact.endsWith('ing') && compact.length > 5) {
    return compact.slice(0, -3);
  }
  if (compact.endsWith('ed') && compact.length > 4) {
    return compact.slice(0, -2);
  }
  if (compact.endsWith('es') && compact.length > 4) {
    return compact.slice(0, -2);
  }
  if (compact.endsWith('s') && compact.length > 4) {
    return compact.slice(0, -1);
  }
  return compact;
}

export function headlineTerms(headline) {
  return [...new Set(
    String(headline ?? '')
      .split(/\s+/)
      .map(normalizeToken)
      .filter((value) => value.length > 0),
  )];
}

function hasSourceOverlap(leftIds, rightIds) {
  const left = new Set(leftIds);
  return rightIds.some((sourceId) => left.has(sourceId));
}

export function buildVisibleOverlapPairs(stories) {
  const visibleStories = (stories ?? [])
    .filter((story) => story?.is_dom_visible)
    .slice(0, 5);
  const overlaps = [];

  for (let index = 0; index < visibleStories.length; index += 1) {
    const left = visibleStories[index];
    const leftSourceIds = left.primary_source_ids ?? left.source_ids ?? [];
    const leftTerms = headlineTerms(left.headline);
    if (leftTerms.length === 0) {
      continue;
    }

    for (let next = index + 1; next < visibleStories.length; next += 1) {
      const right = visibleStories[next];
      const rightSourceIds = right.primary_source_ids ?? right.source_ids ?? [];
      if (hasSourceOverlap(leftSourceIds, rightSourceIds)) {
        continue;
      }

      const rightTerms = headlineTerms(right.headline);
      const sharedTerms = leftTerms.filter((term) => rightTerms.includes(term));
      const similarity = sharedTerms.length / Math.max(1, Math.min(leftTerms.length, rightTerms.length));
      if (sharedTerms.length < 2 || similarity < 0.4) {
        continue;
      }

      overlaps.push({
        left_story_id: left.story_id,
        right_story_id: right.story_id,
        left_headline: left.headline,
        right_headline: right.headline,
        left_source_ids: leftSourceIds,
        right_source_ids: rightSourceIds,
        shared_terms: sharedTerms,
        similarity,
      });
    }
  }

  return overlaps.sort((left, right) => right.shared_terms.length - left.shared_terms.length);
}

export function summarizeDiscoveryProbe({
  artifactDir,
  profile,
  exitStatus,
  audit,
  snapshot,
}) {
  const visibleStories = snapshot?.stories?.filter((story) => story.is_dom_visible).slice(0, 5) ?? [];
  const overlaps = buildVisibleOverlapPairs(visibleStories);
  const auditableCount = snapshot?.auditable_count ?? audit?.supply?.auditable_count ?? 0;
  const sampledStoryCount = audit?.sampled_story_count ?? 0;

  return {
    profile,
    exitStatus,
    artifactDir,
    sampledStoryCount,
    auditableCount,
    visibleStoryCount: snapshot?.visible_story_ids?.length ?? audit?.visible_story_ids?.length ?? 0,
    visibleStories,
    visibleOverlapPairs: overlaps,
    auditableBundleHeadlines: (audit?.bundles ?? []).map((bundle) => bundle.headline),
    hasVisibleCooccurrence: auditableCount > 0 || overlaps.length > 0,
  };
}

function readJsonIfExists(filePath, readFile = readFileSync) {
  try {
    return JSON.parse(readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function runProfileDiscovery({
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  log = console.log,
} = {}) {
  const artifactRoot = discoveryArtifactRoot(env, cwd);
  const profiles = readDiscoveryProfiles(env);
  const probeTimeoutMs = env.VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_TIMEOUT_MS?.trim() || '60000';
  mkdir(artifactRoot, { recursive: true });

  log(`[vh:daemon-soak:discover] build starting (${profiles.length} profiles)`);
  const build = spawn('pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:build'], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFile(path.join(artifactRoot, 'build.stdout.log'), build.stdout ?? '', 'utf8');
  writeFile(path.join(artifactRoot, 'build.stderr.log'), build.stderr ?? '', 'utf8');
  if (build.status !== 0) {
    throw new Error(`profile-discovery-build-failed:${build.status}`);
  }

  const probes = [];

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const probeDir = path.join(artifactRoot, `profile-${index + 1}`);
    mkdir(probeDir, { recursive: true });
    log(`[vh:daemon-soak:discover] profile ${index + 1}/${profiles.length}: ${profile}`);
    const probe = spawn('pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:semantic-soak'], {
      cwd,
      env: {
        ...env,
        VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: profile,
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: probeDir,
        VH_DAEMON_FEED_SOAK_RUNS: '1',
        VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
        VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: probeTimeoutMs,
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    writeFile(path.join(probeDir, 'probe.stdout.log'), probe.stdout ?? '', 'utf8');
    writeFile(path.join(probeDir, 'probe.stderr.log'), probe.stderr ?? '', 'utf8');

    const audit = readJsonIfExists(path.join(probeDir, 'run-1.profile-1.semantic-audit.json'), readFile);
    const snapshot = readJsonIfExists(
      path.join(probeDir, 'run-1.profile-1.semantic-audit-failure-snapshot.json'),
      readFile,
    );
    const summary = summarizeDiscoveryProbe({
      artifactDir: probeDir,
      profile,
      exitStatus: probe.status,
      audit,
      snapshot,
    });
    probes.push(summary);
  }

  const recommendedProfiles = probes
    .filter((probe) => probe.hasVisibleCooccurrence)
    .sort((left, right) =>
      (right.auditableCount - left.auditableCount)
      || (right.visibleOverlapPairs.length - left.visibleOverlapPairs.length)
      || (right.visibleStoryCount - left.visibleStoryCount));

  const report = {
    schemaVersion: 'daemon-feed-semantic-soak-profile-discovery-v1',
    generatedAt: new Date().toISOString(),
    artifactRoot,
    profiles,
    recommendedProfiles: recommendedProfiles.map((probe) => probe.profile),
    probes,
  };

  const reportPath = path.join(artifactRoot, 'profile-discovery-report.json');
  writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  log(`[vh:daemon-soak:discover] report: ${reportPath}`);
  return { artifactRoot, reportPath, report };
}

/* c8 ignore start */
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const result = runProfileDiscovery();
    console.log(JSON.stringify({
      reportPath: result.reportPath,
      recommendedProfiles: result.report.recommendedProfiles,
    }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[vh:daemon-soak:discover] fatal: ${message}`);
    process.exit(1);
  }
}
/* c8 ignore stop */
