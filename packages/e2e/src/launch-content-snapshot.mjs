#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT_SCHEMA_VERSION = 'vh-launch-content-validated-snapshot-v1';
export const REPORT_SCHEMA_VERSION = 'launch-content-snapshot-report-v1';
export const VALID_STATUSES = ['pass', 'fail'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const defaultSnapshotPath = path.join(
  repoRoot,
  'packages/e2e/fixtures/launch-content/validated-snapshot.json',
);
const latestDir = path.join(repoRoot, '.tmp/launch-content-snapshot/latest');
const latestReportPath = path.join(latestDir, 'launch-content-snapshot-report.json');

const REQUIRED_COVERAGE = [
  'singleton_story',
  'bundled_story',
  'preference_ranking_filtering',
  'accepted_synthesis',
  'frame_reframe_stance_targets',
  'analyzed_sources_and_related_links',
  'deterministic_story_thread',
  'persisted_reply',
  'synthesis_correction',
  'comment_moderation_hidden',
  'comment_moderation_restored',
];

function nowIso() {
  return new Date().toISOString();
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function validUrl(value) {
  if (!nonEmptyString(value)) {
    return false;
  }
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function pushFailure(failures, code, message, details = {}) {
  failures.push({
    classification: 'missing_required_coverage',
    code,
    message,
    details,
  });
}

function validateSource(source) {
  return isRecord(source)
    && nonEmptyString(source.source_id)
    && nonEmptyString(source.publisher)
    && validUrl(source.url)
    && nonEmptyString(source.url_hash)
    && nonEmptyString(source.title);
}

function validateStory(story) {
  return isRecord(story)
    && story.schemaVersion === 'story-bundle-v0'
    && nonEmptyString(story.story_id)
    && nonEmptyString(story.topic_id)
    && nonEmptyString(story.headline)
    && finiteNonNegativeNumber(story.cluster_window_start)
    && finiteNonNegativeNumber(story.cluster_window_end)
    && finiteNonNegativeNumber(story.created_at)
    && isRecord(story.cluster_features)
    && Array.isArray(story.cluster_features.entity_keys)
    && story.cluster_features.entity_keys.every(nonEmptyString)
    && nonEmptyString(story.cluster_features.time_bucket)
    && nonEmptyString(story.cluster_features.semantic_signature)
    && nonEmptyString(story.provenance_hash)
    && asArray(story.sources).length > 0
    && asArray(story.sources).every(validateSource)
    && asArray(story.primary_sources).every(validateSource)
    && asArray(story.related_links).every(validateSource);
}

function validateStoryline(storyline, storyIds) {
  return isRecord(storyline)
    && storyline.schemaVersion === 'storyline-group-v0'
    && nonEmptyString(storyline.storyline_id)
    && nonEmptyString(storyline.topic_id)
    && nonEmptyString(storyline.canonical_story_id)
    && storyIds.has(storyline.canonical_story_id)
    && asArray(storyline.story_ids).length > 0
    && asArray(storyline.story_ids).every((storyId) => nonEmptyString(storyId) && storyIds.has(storyId))
    && nonEmptyString(storyline.headline)
    && asArray(storyline.related_coverage).every(validateSource)
    && asArray(storyline.entity_keys).every(nonEmptyString)
    && nonEmptyString(storyline.time_bucket)
    && finiteNonNegativeNumber(storyline.created_at)
    && finiteNonNegativeNumber(storyline.updated_at);
}

function validateFrame(frame) {
  return isRecord(frame)
    && nonEmptyString(frame.frame_point_id)
    && nonEmptyString(frame.frame)
    && nonEmptyString(frame.reframe_point_id)
    && nonEmptyString(frame.reframe);
}

function validateSynthesis(synthesis, storyIds) {
  const storyBundleIds = asArray(synthesis?.inputs?.story_bundle_ids);
  return isRecord(synthesis)
    && synthesis.schemaVersion === 'topic-synthesis-v2'
    && nonEmptyString(synthesis.topic_id)
    && Number.isInteger(synthesis.epoch)
    && synthesis.epoch >= 0
    && nonEmptyString(synthesis.synthesis_id)
    && isRecord(synthesis.inputs)
    && storyBundleIds.length > 0
    && storyBundleIds.every((storyId) => nonEmptyString(storyId) && storyIds.has(storyId))
    && isRecord(synthesis.quorum)
    && synthesis.quorum.selection_rule === 'deterministic'
    && finiteNonNegativeNumber(synthesis.quorum.reached_at)
    && nonEmptyString(synthesis.facts_summary)
    && asArray(synthesis.frames).length > 0
    && asArray(synthesis.frames).every(validateFrame)
    && isRecord(synthesis.divergence_metrics)
    && isRecord(synthesis.provenance)
    && asArray(synthesis.provenance.candidate_ids).length > 0
    && asArray(synthesis.provenance.provider_mix).length > 0
    && finiteNonNegativeNumber(synthesis.created_at);
}

function validateCorrection(correction, synthesisByKey) {
  if (
    !isRecord(correction)
    || correction.schemaVersion !== 'topic-synthesis-correction-v1'
    || !nonEmptyString(correction.correction_id)
    || !nonEmptyString(correction.topic_id)
    || !nonEmptyString(correction.synthesis_id)
    || !Number.isInteger(correction.epoch)
    || correction.epoch < 0
    || !['suppressed', 'unavailable'].includes(correction.status)
    || !nonEmptyString(correction.reason_code)
    || !nonEmptyString(correction.operator_id)
    || !finiteNonNegativeNumber(correction.created_at)
    || !isRecord(correction.audit)
    || correction.audit.action !== 'synthesis_correction'
  ) {
    return false;
  }
  return synthesisByKey.has(`${correction.topic_id}|${correction.synthesis_id}|${correction.epoch}`);
}

function validateThread(thread, storyById) {
  if (
    !isRecord(thread)
    || thread.schemaVersion !== 'hermes-thread-v0'
    || !nonEmptyString(thread.id)
    || !thread.id.startsWith('news-story:')
    || !nonEmptyString(thread.title)
    || !nonEmptyString(thread.content)
    || !nonEmptyString(thread.author)
    || !finiteNonNegativeNumber(thread.timestamp)
    || !Array.isArray(thread.tags)
    || !thread.tags.every(nonEmptyString)
    || !Number.isInteger(thread.upvotes)
    || !Number.isInteger(thread.downvotes)
    || typeof thread.score !== 'number'
  ) {
    return false;
  }
  const decodedStoryId = decodeURIComponent(thread.id.slice('news-story:'.length));
  return storyById.has(decodedStoryId);
}

function validateComment(comment, threadIds) {
  return isRecord(comment)
    && comment.schemaVersion === 'hermes-comment-v1'
    && nonEmptyString(comment.id)
    && nonEmptyString(comment.threadId)
    && threadIds.has(comment.threadId)
    && (comment.parentId === null || nonEmptyString(comment.parentId))
    && nonEmptyString(comment.content)
    && nonEmptyString(comment.author)
    && finiteNonNegativeNumber(comment.timestamp)
    && ['concur', 'counter', 'discuss'].includes(comment.stance)
    && Number.isInteger(comment.upvotes)
    && Number.isInteger(comment.downvotes);
}

function validateCommentModeration(moderation, commentByKey) {
  if (
    !isRecord(moderation)
    || moderation.schemaVersion !== 'hermes-comment-moderation-v1'
    || !nonEmptyString(moderation.moderation_id)
    || !nonEmptyString(moderation.thread_id)
    || !nonEmptyString(moderation.comment_id)
    || !['hidden', 'restored'].includes(moderation.status)
    || !nonEmptyString(moderation.reason_code)
    || !nonEmptyString(moderation.operator_id)
    || !finiteNonNegativeNumber(moderation.created_at)
    || !isRecord(moderation.audit)
    || moderation.audit.action !== 'comment_moderation'
  ) {
    return false;
  }
  return commentByKey.has(`${moderation.thread_id}|${moderation.comment_id}`);
}

function normalizeList(values) {
  return asArray(values).filter(nonEmptyString).map((value) => value.trim().toLowerCase());
}

function rankPreferenceItems(feedItems, personalization) {
  const preferredCategories = new Set(normalizeList(personalization?.preferredCategories));
  const preferredTopics = new Set(normalizeList(personalization?.preferredTopics));
  const mutedCategories = new Set(normalizeList(personalization?.mutedCategories));
  const mutedTopics = new Set(normalizeList(personalization?.mutedTopics));

  return asArray(feedItems)
    .filter((item) => isRecord(item) && nonEmptyString(item.topic_id))
    .filter((item) => {
      const topicId = item.topic_id.trim().toLowerCase();
      const categories = normalizeList(item.categories);
      return !mutedTopics.has(topicId) && !categories.some((category) => mutedCategories.has(category));
    })
    .map((item) => {
      const topicId = item.topic_id.trim().toLowerCase();
      const categories = normalizeList(item.categories);
      const preferredScore =
        (preferredTopics.has(topicId) ? 1_000 : 0)
        + (categories.some((category) => preferredCategories.has(category)) ? 1_000 : 0);
      const hotness = typeof item.hotness === 'number' && Number.isFinite(item.hotness) ? item.hotness : 0;
      return { item, score: preferredScore + hotness };
    })
    .sort((left, right) =>
      right.score - left.score
      || String(left.item.topic_id).localeCompare(String(right.item.topic_id)),
    )
    .map(({ item }) => item.topic_id);
}

function validatePreferenceProbe(preferenceProbe, failures) {
  if (!isRecord(preferenceProbe)) {
    pushFailure(failures, 'invalid_preference_probe', 'launchContent.preferenceProbe is required.');
    return false;
  }

  const feedItems = asArray(preferenceProbe.feedItems);
  const scenarios = asArray(preferenceProbe.scenarios);
  if (feedItems.length < 2 || scenarios.length < 3) {
    pushFailure(
      failures,
      'invalid_preference_probe',
      'preferenceProbe must include at least two feed items and baseline/preferred/muted scenarios.',
      { feedItemCount: feedItems.length, scenarioCount: scenarios.length },
    );
    return false;
  }

  let allExpectedOrdersMatch = true;
  for (const scenario of scenarios) {
    if (!isRecord(scenario) || !nonEmptyString(scenario.id) || !Array.isArray(scenario.expectedTopicOrder)) {
      allExpectedOrdersMatch = false;
      pushFailure(failures, 'invalid_preference_scenario', 'Preference scenario is missing id or expectedTopicOrder.');
      continue;
    }
    const actual = rankPreferenceItems(feedItems, scenario.personalization ?? {});
    if (JSON.stringify(actual) !== JSON.stringify(scenario.expectedTopicOrder)) {
      allExpectedOrdersMatch = false;
      pushFailure(
        failures,
        'preference_scenario_mismatch',
        `Preference scenario ${scenario.id} does not match deterministic ranking/filtering.`,
        { expected: scenario.expectedTopicOrder, actual },
      );
    }
  }

  const baseline = scenarios.find((scenario) => scenario?.id === 'baseline');
  const baselineOrder = Array.isArray(baseline?.expectedTopicOrder) ? baseline.expectedTopicOrder : [];
  const hasPreferredChange = scenarios.some((scenario) => {
    const prefs = scenario?.personalization ?? {};
    const hasPreference = normalizeList(prefs.preferredCategories).length > 0 || normalizeList(prefs.preferredTopics).length > 0;
    return hasPreference && JSON.stringify(scenario.expectedTopicOrder) !== JSON.stringify(baselineOrder);
  });
  const hasMutedFilter = scenarios.some((scenario) => {
    const prefs = scenario?.personalization ?? {};
    const hasMuted = normalizeList(prefs.mutedCategories).length > 0 || normalizeList(prefs.mutedTopics).length > 0;
    return hasMuted && asArray(scenario.expectedTopicOrder).length < feedItems.length;
  });

  return allExpectedOrdersMatch && hasPreferredChange && hasMutedFilter;
}

export function validateLaunchContentSnapshot(snapshot) {
  const failures = [];
  const coverage = Object.fromEntries(REQUIRED_COVERAGE.map((key) => [key, false]));

  if (!isRecord(snapshot)) {
    pushFailure(failures, 'invalid_snapshot', 'Snapshot payload must be an object.');
    return { ok: false, coverage, failures, summary: { storyCount: 0 } };
  }

  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    pushFailure(
      failures,
      'invalid_schema_version',
      `Snapshot schemaVersion must be ${SNAPSHOT_SCHEMA_VERSION}.`,
      { received: snapshot.schemaVersion ?? null },
    );
  }

  const stories = asArray(snapshot.stories);
  const storyIds = new Set(stories.filter(validateStory).map((story) => story.story_id));
  const storyById = new Map(stories.filter(validateStory).map((story) => [story.story_id, story]));
  const invalidStoryCount = stories.length - storyIds.size;
  if (stories.length === 0 || invalidStoryCount > 0) {
    pushFailure(
      failures,
      'invalid_stories',
      'Snapshot stories must be valid story-bundle-v0 records.',
      { storyCount: stories.length, invalidStoryCount },
    );
  }

  coverage.singleton_story = stories.some((story) => validateStory(story) && asArray(story.sources).length === 1);

  const storylines = asArray(snapshot.storylines);
  const validStorylines = storylines.filter((storyline) => validateStoryline(storyline, storyIds));
  if (storylines.length !== validStorylines.length) {
    pushFailure(
      failures,
      'invalid_storylines',
      'Snapshot storylines must reference committed story ids.',
      { storylineCount: storylines.length, validStorylineCount: validStorylines.length },
    );
  }
  coverage.bundled_story =
    stories.some((story) => validateStory(story) && asArray(story.sources).length >= 2)
    && validStorylines.some((storyline) => asArray(storyline.story_ids).length >= 2);

  const latestIndex = isRecord(snapshot.latestIndex) ? snapshot.latestIndex : {};
  const hotIndex = isRecord(snapshot.hotIndex) ? snapshot.hotIndex : {};
  const missingLatestIds = [...storyIds].filter((storyId) => !finiteNonNegativeNumber(latestIndex[storyId]));
  const missingHotIds = [...storyIds].filter((storyId) => !finiteNonNegativeNumber(hotIndex[storyId]));
  if (missingLatestIds.length > 0 || missingHotIds.length > 0) {
    pushFailure(
      failures,
      'invalid_indexes',
      'latestIndex and hotIndex must include every committed story id.',
      { missingLatestIds, missingHotIds },
    );
  }

  const launchContent = isRecord(snapshot.launchContent) ? snapshot.launchContent : {};
  coverage.preference_ranking_filtering = validatePreferenceProbe(launchContent.preferenceProbe, failures);

  const syntheses = asArray(launchContent.syntheses);
  const validSyntheses = syntheses.filter((synthesis) => validateSynthesis(synthesis, storyIds));
  const synthesisByKey = new Map(
    validSyntheses.map((synthesis) => [`${synthesis.topic_id}|${synthesis.synthesis_id}|${synthesis.epoch}`, synthesis]),
  );
  if (syntheses.length === 0 || syntheses.length !== validSyntheses.length) {
    pushFailure(
      failures,
      'invalid_syntheses',
      'launchContent.syntheses must contain valid accepted TopicSynthesisV2-like records that reference story bundles.',
      { synthesisCount: syntheses.length, validSynthesisCount: validSyntheses.length },
    );
  }
  coverage.accepted_synthesis = validSyntheses.length > 0;
  coverage.frame_reframe_stance_targets = validSyntheses.some((synthesis) =>
    asArray(synthesis.frames).some(validateFrame),
  );

  coverage.analyzed_sources_and_related_links = stories.some((story) => {
    if (!validateStory(story) || asArray(story.primary_sources).length === 0 || asArray(story.related_links).length === 0) {
      return false;
    }
    const analyzedUrls = new Set(asArray(story.primary_sources).map((source) => source.url));
    return asArray(story.related_links).some((link) => !analyzedUrls.has(link.url));
  });

  const corrections = asArray(launchContent.synthesisCorrections);
  const validCorrections = corrections.filter((correction) => validateCorrection(correction, synthesisByKey));
  if (corrections.length !== validCorrections.length) {
    pushFailure(
      failures,
      'invalid_synthesis_corrections',
      'launchContent.synthesisCorrections must validate and match an accepted synthesis by topic, synthesis id, and epoch.',
      { correctionCount: corrections.length, validCorrectionCount: validCorrections.length },
    );
  }
  coverage.synthesis_correction = validCorrections.some((correction) =>
    ['suppressed', 'unavailable'].includes(correction.status),
  );

  const forum = isRecord(launchContent.forum) ? launchContent.forum : {};
  const threads = asArray(forum.threads);
  const validThreads = threads.filter((thread) => validateThread(thread, storyById));
  const threadIds = new Set(validThreads.map((thread) => thread.id));
  if (threads.length === 0 || threads.length !== validThreads.length) {
    pushFailure(
      failures,
      'invalid_story_threads',
      'launchContent.forum.threads must include deterministic news-story:* threads that map to snapshot stories.',
      { threadCount: threads.length, validThreadCount: validThreads.length },
    );
  }
  coverage.deterministic_story_thread = validThreads.length > 0;

  const comments = asArray(forum.comments);
  const validComments = comments.filter((comment) => validateComment(comment, threadIds));
  const commentByKey = new Set(validComments.map((comment) => `${comment.threadId}|${comment.id}`));
  if (comments.length === 0 || comments.length !== validComments.length) {
    pushFailure(
      failures,
      'invalid_story_thread_comments',
      'launchContent.forum.comments must include valid persisted replies attached to deterministic story threads.',
      { commentCount: comments.length, validCommentCount: validComments.length },
    );
  }
  coverage.persisted_reply = validComments.length > 0;

  const commentModerations = asArray(forum.commentModerations);
  const validCommentModerations = commentModerations.filter((moderation) =>
    validateCommentModeration(moderation, commentByKey),
  );
  if (commentModerations.length !== validCommentModerations.length) {
    pushFailure(
      failures,
      'invalid_comment_moderations',
      'launchContent.forum.commentModerations must validate and match a comment path by thread id and comment id.',
      { moderationCount: commentModerations.length, validModerationCount: validCommentModerations.length },
    );
  }
  coverage.comment_moderation_hidden = validCommentModerations.some((moderation) => moderation.status === 'hidden');
  coverage.comment_moderation_restored = validCommentModerations.some((moderation) => moderation.status === 'restored');

  for (const key of REQUIRED_COVERAGE) {
    if (!coverage[key]) {
      pushFailure(failures, `missing_${key}`, `Launch content snapshot is missing required coverage: ${key}.`);
    }
  }

  const uniqueSourceIds = new Set(
    stories
      .flatMap((story) => asArray(story.sources))
      .filter(validateSource)
      .map((source) => source.source_id),
  );

  return {
    ok: failures.length === 0,
    coverage,
    failures,
    summary: {
      storyCount: stories.length,
      storylineCount: storylines.length,
      synthesisCount: syntheses.length,
      correctionCount: corrections.length,
      threadCount: threads.length,
      commentCount: comments.length,
      commentModerationCount: commentModerations.length,
      uniqueSourceCount: uniqueSourceIds.size,
      uniqueSourceIds: [...uniqueSourceIds].sort(),
    },
  };
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandToString(command) {
  const [bin, args] = command;
  return [bin, ...args].map(shellQuote).join(' ');
}

function runCommand(command) {
  const [bin, args] = command;
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: repoRoot,
      env: { ...process.env, CI: process.env.CI ?? 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.stack ?? error.message}` });
    });
    child.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

async function gitValue(args) {
  const result = await new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (exitCode) => resolve(exitCode === 0 ? stdout.trim() : null));
  });
  return result;
}

async function readSnapshot(snapshotPath) {
  return JSON.parse(await readFile(snapshotPath, 'utf8'));
}

async function writeReport(report) {
  await rm(latestDir, { recursive: true, force: true });
  await mkdir(latestDir, { recursive: true });
  await writeFile(latestReportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function runLaunchContentSnapshotGate({
  snapshotPath = process.env.VH_LAUNCH_CONTENT_SNAPSHOT_PATH?.trim() || defaultSnapshotPath,
} = {}) {
  const startedAt = nowIso();
  const branch = await gitValue(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = await gitValue(['rev-parse', 'HEAD']);
  const gates = [];

  const validationStartedAt = nowIso();
  const validationStart = Date.now();
  let validation;
  try {
    validation = validateLaunchContentSnapshot(await readSnapshot(snapshotPath));
  } catch (error) {
    validation = {
      ok: false,
      coverage: Object.fromEntries(REQUIRED_COVERAGE.map((key) => [key, false])),
      failures: [{
        classification: 'snapshot_read_error',
        code: 'snapshot_read_error',
        message: error instanceof Error ? error.message : String(error),
      }],
      summary: { storyCount: 0 },
    };
  }
  gates.push({
    id: 'snapshot_schema_coverage',
    label: 'Curated launch-content snapshot schema and coverage',
    status: validation.ok ? 'pass' : 'fail',
    startedAt: validationStartedAt,
    endedAt: nowIso(),
    durationMs: Date.now() - validationStart,
    command: `node packages/e2e/src/launch-content-snapshot.mjs --validate ${shellQuote(snapshotPath)}`,
    artifactRefs: [snapshotPath],
    failureClassification: validation.ok ? null : 'missing_required_coverage',
    summary: validation.ok
      ? 'Curated snapshot includes every required launch-content coverage category.'
      : validation.failures.map((failure) => `${failure.code}: ${failure.message}`).join('\n'),
  });

  if (validation.ok) {
    const smokeCommand = [
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        'apps/web-pwa/src/store/newsSnapshotBootstrap.launchContent.test.tsx',
        '--reporter=verbose',
      ],
    ];
    const smokeStartedAt = nowIso();
    const smokeStart = Date.now();
    const smokeResult = await runCommand(smokeCommand);
    const output = `${smokeResult.stdout}\n${smokeResult.stderr}`;
    gates.push({
      id: 'web_pwa_snapshot_smoke',
      label: 'Web PWA launch-content snapshot hydration and render smoke',
      status: smokeResult.exitCode === 0 ? 'pass' : 'fail',
      startedAt: smokeStartedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - smokeStart,
      exitCode: smokeResult.exitCode,
      command: commandToString(smokeCommand),
      artifactRefs: [
        snapshotPath,
        'apps/web-pwa/src/store/newsSnapshotBootstrap.launchContent.test.tsx',
      ],
      failureClassification: smokeResult.exitCode === 0 ? null : 'product_regression',
      summary: smokeResult.exitCode === 0
        ? 'Web PWA hydrated and rendered launch-content snapshot states.'
        : output.split('\n').filter(Boolean).slice(-10).join('\n'),
    });
  }

  const failing = gates.filter((gate) => gate.status !== 'pass');
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: nowIso(),
    startedAt,
    endedAt: nowIso(),
    reportPath: latestReportPath,
    repo: {
      root: repoRoot,
      branch,
      commit,
    },
    snapshot: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      path: snapshotPath,
      coverage: validation.coverage,
      summary: validation.summary,
      failures: validation.failures,
    },
    statuses: VALID_STATUSES,
    overallStatus: failing.length === 0 ? 'pass' : 'fail',
    gates,
  };

  await writeReport(report);
  console.info(`[launch-content-snapshot] wrote ${latestReportPath}`);
  return report;
}

async function main() {
  const validateOnlyIndex = process.argv.indexOf('--validate');
  if (validateOnlyIndex !== -1) {
    const snapshotPath = process.argv[validateOnlyIndex + 1] || defaultSnapshotPath;
    const validation = validateLaunchContentSnapshot(await readSnapshot(snapshotPath));
    console.log(JSON.stringify(validation, null, 2));
    if (!validation.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const report = await runLaunchContentSnapshotGate();
  if (report.overallStatus !== 'pass') {
    process.exitCode = 1;
  }
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error('[launch-content-snapshot] fatal:', error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
