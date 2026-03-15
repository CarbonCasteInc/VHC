import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_DISCOVERY_CENSUS_SOURCES = Object.freeze([
  'abc-politics',
  'bbc-us-canada',
  'cbs-politics',
  'guardian-us',
  'huffpost-us',
  'nbc-politics',
  'nypost-politics',
  'pbs-politics',
]);

const DISCOVERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'after', 'against', 'amid', 'be', 'by', 'for', 'from',
  'in', 'into', 'is', 'it', 'its', 'near', 'of', 'on', 'or', 'over', 'says', 'say', 'saying',
  'the', 'their', 'to', 'under', 'up', 'us', 'who', 'with', 'watch', 'what', 'why', 'how', 'will',
]);

const DEFAULT_CANDIDATE_LIMIT = 6;

export function splitDiscoveryProfiles(raw) {
  return raw
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function splitDiscoverySources(raw) {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function readDiscoveryProfiles(env = process.env) {
  const explicit = env.VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_PROFILES?.trim();
  if (explicit) {
    return splitDiscoveryProfiles(explicit);
  }
  return [];
}

export function readDiscoveryCensusSources(env = process.env) {
  const explicit = env.VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_SOURCES?.trim();
  if (explicit) {
    return splitDiscoverySources(explicit);
  }
  return [...DEFAULT_DISCOVERY_CENSUS_SOURCES];
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

function storySourceIds(story) {
  return story?.primary_source_ids ?? story?.source_ids ?? [];
}

function hasSourceOverlap(leftIds, rightIds) {
  const left = new Set(leftIds);
  return rightIds.some((sourceId) => left.has(sourceId));
}

function compareStories(left, right) {
  const leftSourceIds = storySourceIds(left);
  const rightSourceIds = storySourceIds(right);
  if (hasSourceOverlap(leftSourceIds, rightSourceIds)) {
    return null;
  }

  const leftTerms = headlineTerms(left?.headline);
  if (leftTerms.length === 0) {
    return null;
  }
  const rightTerms = headlineTerms(right?.headline);
  const sharedTerms = leftTerms.filter((term) => rightTerms.includes(term));
  const similarity = sharedTerms.length / Math.max(1, Math.min(leftTerms.length, rightTerms.length));
  if (sharedTerms.length < 2 || similarity < 0.4) {
    return null;
  }

  return {
    sharedTerms,
    similarity,
    leftSourceIds,
    rightSourceIds,
  };
}

export function buildVisibleOverlapPairs(stories) {
  const visibleStories = (stories ?? [])
    .filter((story) => story?.is_dom_visible)
    .slice(0, 5);
  const overlaps = [];

  for (let index = 0; index < visibleStories.length; index += 1) {
    const left = visibleStories[index];
    for (let next = index + 1; next < visibleStories.length; next += 1) {
      const right = visibleStories[next];
      const comparison = compareStories(left, right);
      if (!comparison) {
        continue;
      }

      overlaps.push({
        left_story_id: left.story_id,
        right_story_id: right.story_id,
        left_headline: left.headline,
        right_headline: right.headline,
        left_source_ids: comparison.leftSourceIds,
        right_source_ids: comparison.rightSourceIds,
        shared_terms: comparison.sharedTerms,
        similarity: comparison.similarity,
      });
    }
  }

  return overlaps.sort((left, right) => right.shared_terms.length - left.shared_terms.length);
}

function probeVisibleStories(snapshot) {
  return snapshot?.stories?.filter((story) => story.is_dom_visible).slice(0, 5) ?? [];
}

export function buildDerivedCandidateProfiles(censusProbes, limit = DEFAULT_CANDIDATE_LIMIT) {
  const visibleStories = censusProbes.flatMap((probe) =>
    probe.visibleStories.map((story) => ({
      ...story,
      probeProfile: probe.profile,
    })),
  );
  const candidates = new Map();

  for (let index = 0; index < visibleStories.length; index += 1) {
    const left = visibleStories[index];
    for (let next = index + 1; next < visibleStories.length; next += 1) {
      const right = visibleStories[next];
      if (left.probeProfile === right.probeProfile) {
        continue;
      }

      const comparison = compareStories(left, right);
      if (!comparison) {
        continue;
      }

      const profileSourceIds = [...new Set([
        ...comparison.leftSourceIds,
        ...comparison.rightSourceIds,
      ])].sort();
      if (profileSourceIds.length < 2) {
        continue;
      }

      const profile = profileSourceIds.join(',');
      const existing = candidates.get(profile) ?? {
        profile,
        sourceIds: profileSourceIds,
        overlapCount: 0,
        maxSimilarity: 0,
        maxSharedTermCount: 0,
        examples: [],
      };

      existing.overlapCount += 1;
      existing.maxSimilarity = Math.max(existing.maxSimilarity, comparison.similarity);
      existing.maxSharedTermCount = Math.max(existing.maxSharedTermCount, comparison.sharedTerms.length);
      if (existing.examples.length < 3) {
        existing.examples.push({
          left_headline: left.headline,
          right_headline: right.headline,
          shared_terms: comparison.sharedTerms,
          similarity: comparison.similarity,
        });
      }
      candidates.set(profile, existing);
    }
  }

  return [...candidates.values()]
    .sort((left, right) =>
      (right.overlapCount - left.overlapCount)
      || (right.maxSharedTermCount - left.maxSharedTermCount)
      || (right.maxSimilarity - left.maxSimilarity)
      || left.profile.localeCompare(right.profile))
    .slice(0, limit);
}

export function summarizeDiscoveryProbe({
  artifactDir,
  profile,
  exitStatus,
  audit,
  snapshot,
}) {
  const visibleStories = probeVisibleStories(snapshot);
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

function runSemanticSoakProbe({
  cwd,
  env,
  profile,
  probeDir,
  probeTimeoutMs,
  spawn,
  mkdir,
  readFile,
  writeFile,
}) {
  mkdir(probeDir, { recursive: true });
  const probe = spawn('pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:semantic-soak'], {
    cwd,
    env: {
      ...env,
      VH_DAEMON_FEED_SOAK_SKIP_BUILD: 'true',
      VH_DAEMON_FEED_READY_TIMEOUT_MS: probeTimeoutMs,
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
  return summarizeDiscoveryProbe({
    artifactDir: probeDir,
    profile,
    exitStatus: probe.status,
    audit,
    snapshot,
  });
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
  const censusSources = readDiscoveryCensusSources(env);
  const explicitCandidateProfiles = readDiscoveryProfiles(env);
  const probeTimeoutMs = env.VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_TIMEOUT_MS?.trim() || '60000';
  mkdir(artifactRoot, { recursive: true });

  log(`[vh:daemon-soak:discover] build starting (${censusSources.length} census sources)`);
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

  const censusProbes = [];
  for (let index = 0; index < censusSources.length; index += 1) {
    const sourceId = censusSources[index];
    log(`[vh:daemon-soak:discover] census ${index + 1}/${censusSources.length}: ${sourceId}`);
    censusProbes.push(runSemanticSoakProbe({
      cwd,
      env,
      profile: sourceId,
      probeDir: path.join(artifactRoot, `census-${index + 1}`),
      probeTimeoutMs,
      spawn,
      mkdir,
      readFile,
      writeFile,
    }));
  }

  const derivedCandidates = buildDerivedCandidateProfiles(censusProbes);
  const candidateProfiles = explicitCandidateProfiles.length > 0
    ? explicitCandidateProfiles
    : derivedCandidates.map((candidate) => candidate.profile);
  const candidateProbes = [];

  for (let index = 0; index < candidateProfiles.length; index += 1) {
    const profile = candidateProfiles[index];
    log(`[vh:daemon-soak:discover] candidate ${index + 1}/${candidateProfiles.length}: ${profile}`);
    candidateProbes.push(runSemanticSoakProbe({
      cwd,
      env,
      profile,
      probeDir: path.join(artifactRoot, `candidate-${index + 1}`),
      probeTimeoutMs,
      spawn,
      mkdir,
      readFile,
      writeFile,
    }));
  }

  const recommendedProfiles = candidateProbes
    .filter((probe) => probe.hasVisibleCooccurrence)
    .sort((left, right) =>
      (right.auditableCount - left.auditableCount)
      || (right.visibleOverlapPairs.length - left.visibleOverlapPairs.length)
      || (right.visibleStoryCount - left.visibleStoryCount))
    .map((probe) => probe.profile);

  const report = {
    schemaVersion: 'daemon-feed-semantic-soak-profile-discovery-v2',
    generatedAt: new Date().toISOString(),
    artifactRoot,
    censusSources,
    explicitCandidateProfiles,
    derivedCandidates,
    candidateProfiles,
    recommendedProfiles,
    censusProbes,
    candidateProbes,
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
