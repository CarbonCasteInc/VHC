import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_STATUSES,
  validateLaunchContentSnapshot,
} from './launch-content-snapshot.mjs';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/launch-content/validated-snapshot.json',
);

function readFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

describe('launch-content snapshot gate helpers', () => {
  it('publishes stable report and snapshot schema versions', () => {
    expect(REPORT_SCHEMA_VERSION).toBe('launch-content-snapshot-report-v1');
    expect(SNAPSHOT_SCHEMA_VERSION).toBe('vh-launch-content-validated-snapshot-v1');
    expect(VALID_STATUSES).toEqual(['pass', 'fail']);
  });

  it('accepts the committed curated launch-content snapshot with full MVP coverage', () => {
    const validation = validateLaunchContentSnapshot(readFixture());

    expect(validation.ok).toBe(true);
    expect(validation.failures).toEqual([]);
    expect(validation.coverage).toMatchObject({
      singleton_story: true,
      bundled_story: true,
      preference_ranking_filtering: true,
      accepted_synthesis: true,
      frame_reframe_stance_targets: true,
      analyzed_sources_and_related_links: true,
      deterministic_story_thread: true,
      persisted_reply: true,
      synthesis_correction: true,
      comment_moderation_hidden: true,
      comment_moderation_restored: true,
    });
    expect(validation.summary).toMatchObject({
      storyCount: 4,
      storylineCount: 1,
      synthesisCount: 3,
      correctionCount: 1,
      threadCount: 1,
      commentCount: 3,
      commentModerationCount: 2,
    });
  });

  it('rejects missing required coverage with actionable classifications', () => {
    const snapshot = readFixture();
    snapshot.stories = snapshot.stories.filter((story) => story.story_id !== 'launch-singleton-transit-20260425');
    snapshot.launchContent.forum.commentModerations = snapshot.launchContent.forum.commentModerations.filter(
      (moderation) => moderation.status !== 'restored',
    );

    const validation = validateLaunchContentSnapshot(snapshot);

    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'missing_required_coverage',
          code: 'missing_singleton_story',
        }),
        expect.objectContaining({
          classification: 'missing_required_coverage',
          code: 'missing_comment_moderation_restored',
        }),
      ]),
    );
  });

  it('rejects preference scenarios whose expected order no longer matches deterministic ranking', () => {
    const snapshot = readFixture();
    snapshot.launchContent.preferenceProbe.scenarios.find((scenario) => scenario.id === 'preferred-transit')
      .expectedTopicOrder.reverse();

    const validation = validateLaunchContentSnapshot(snapshot);

    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'missing_required_coverage',
          code: 'preference_scenario_mismatch',
        }),
        expect.objectContaining({
          classification: 'missing_required_coverage',
          code: 'missing_preference_ranking_filtering',
        }),
      ]),
    );
  });

  it('rejects cross-path synthesis correction and moderation records', () => {
    const snapshot = readFixture();
    snapshot.launchContent.synthesisCorrections[0].epoch = 999;
    snapshot.launchContent.forum.commentModerations[0].comment_id = 'other-comment';

    const validation = validateLaunchContentSnapshot(snapshot);

    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'missing_required_coverage',
          code: 'invalid_synthesis_corrections',
        }),
        expect.objectContaining({
          classification: 'missing_required_coverage',
          code: 'invalid_comment_moderations',
        }),
      ]),
    );
  });
});
