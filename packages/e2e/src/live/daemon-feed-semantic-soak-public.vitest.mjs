import { describe, expect, it } from 'vitest';
import {
  aggregatePublicSemanticSoakSubruns,
  resolvePublicSemanticSoakProfiles,
  resolvePublicSemanticSoakSpawnEnv,
} from './daemon-feed-semantic-soak-public.mjs';

function makeBundle(storyId, topicId, label = 'duplicate') {
  return {
    story_id: storyId,
    topic_id: topicId,
    headline: `Headline ${storyId}`,
    canonical_source_count: 2,
    pairs: [{ label }],
    has_related_topic_only_pair: label === 'related_topic_only',
  };
}

function makeSubrun(profileIndex, sourceIds, bundles, overrides = {}) {
  return {
    profileIndex,
    sourceIds,
    procStatus: overrides.procStatus ?? 1,
    reportPath: `/tmp/run-${profileIndex}.playwright.json`,
    reportParseError: overrides.reportParseError ?? null,
    audit: {
      requested_sample_count: 4,
      sampled_story_count: bundles.length,
      visible_story_ids: bundles.map((bundle) => bundle.story_id),
      supply: {
        story_count: bundles.length,
        auditable_count: bundles.length,
        visible_story_ids: bundles.map((bundle) => bundle.story_id),
        top_story_ids: bundles.map((bundle) => bundle.story_id),
        top_auditable_story_ids: bundles.map((bundle) => bundle.story_id),
        sample_fill_rate: bundles.length / 4,
        sample_shortfall: Math.max(4 - bundles.length, 0),
      },
      bundles,
      overall: {
        audited_pair_count: bundles.length,
        related_topic_only_pair_count: bundles.filter((bundle) => bundle.has_related_topic_only_pair).length,
        sample_fill_rate: bundles.length / 4,
        sample_shortfall: Math.max(4 - bundles.length, 0),
        pass: bundles.length >= 4,
      },
    },
    auditError: overrides.auditError ?? null,
    auditPath: `/tmp/run-${profileIndex}.semantic-audit.json`,
    failureSnapshot: {
      story_count: bundles.length,
      auditable_count: bundles.length,
      visible_story_ids: bundles.map((bundle) => bundle.story_id),
      top_story_ids: bundles.map((bundle) => bundle.story_id),
      top_auditable_story_ids: bundles.map((bundle) => bundle.story_id),
    },
    failureSnapshotPath: `/tmp/run-${profileIndex}.failure.json`,
    runtimeLogs: {
      browserLogs: [`profile-${profileIndex}-log`],
    },
    runtimeLogsPath: `/tmp/run-${profileIndex}.runtime.json`,
  };
}

describe('daemon-feed-semantic-soak-public', () => {
  it('returns curated default public smoke profiles when unset', () => {
    expect(resolvePublicSemanticSoakProfiles({})).toEqual([
      'abc-politics,pbs-politics',
      'cbs-politics,guardian-us',
      'bbc-us-canada,nbc-politics,pbs-politics',
    ]);
  });

  it('prefers explicit source ids over profile lists and suppresses profiles for fixture feed', () => {
    expect(resolvePublicSemanticSoakProfiles({
      VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: 'a,b;c,d',
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'x,y',
    })).toEqual(['x,y']);
    expect(resolvePublicSemanticSoakProfiles({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: 'a,b;c,d',
    })).toEqual([]);
  });

  it('uses explicit profile lists when direct source ids are absent', () => {
    expect(resolvePublicSemanticSoakProfiles({
      VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: 'a,b;c,d',
    })).toEqual(['a,b', 'c,d']);
  });

  it('injects the selected public source ids and smoke-only limits', () => {
    expect(resolvePublicSemanticSoakSpawnEnv({}, 'run-1', 4, 180000, 'a,b')).toEqual(expect.objectContaining({
      VH_RUN_DAEMON_FIRST_FEED: 'true',
      VH_DAEMON_FEED_RUN_ID: 'run-1',
      VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT: '4',
      VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS: '180000',
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'a,b',
      VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE: '4',
      VH_DAEMON_FEED_MAX_ITEMS_TOTAL: '20',
    }));
  });

  it('falls back to default smoke-only limits when explicit overrides are blank', () => {
    expect(resolvePublicSemanticSoakSpawnEnv({
      VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE: '   ',
      VH_DAEMON_FEED_MAX_ITEMS_TOTAL: '   ',
    }, 'run-blank', 3, 999, 'a,b')).toEqual(expect.objectContaining({
      VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE: '4',
      VH_DAEMON_FEED_MAX_ITEMS_TOTAL: '20',
    }));
  });

  it('uses env-provided live source ids when a subrun does not pass source ids directly', () => {
    expect(resolvePublicSemanticSoakSpawnEnv({
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,pbs-politics',
    }, 'run-env', 3, 999)).toEqual(expect.objectContaining({
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,pbs-politics',
    }));
  });

  it('falls back to the default public smoke profile when no direct or env source ids exist', () => {
    expect(resolvePublicSemanticSoakSpawnEnv({}, 'run-default', 3, 999)).toEqual(expect.objectContaining({
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'abc-politics,pbs-politics',
    }));
  });

  it('keeps fixture-mode spawn env free of smoke-only source overrides', () => {
    expect(resolvePublicSemanticSoakSpawnEnv({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'x,y',
    }, 'run-fixture', 2, 5000, 'a,b')).toEqual(expect.objectContaining({
      VH_RUN_DAEMON_FIRST_FEED: 'true',
      VH_DAEMON_FEED_RUN_ID: 'run-fixture',
      VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT: '2',
      VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS: '5000',
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'x,y',
    }));
  });

  it('aggregates unique bundles across subruns and passes once the sample is filled', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 4,
      sourceProfiles: ['profile-a', 'profile-b'],
      subruns: [
        makeSubrun(1, 'profile-a', [
          makeBundle('story-1', 'topic-1'),
          makeBundle('story-2', 'topic-2'),
        ]),
        makeSubrun(2, 'profile-b', [
          makeBundle('story-3', 'topic-3'),
          makeBundle('story-4', 'topic-4'),
        ]),
      ],
    });

    expect(aggregate.status).toBe(0);
    expect(aggregate.audit.sampled_story_count).toBe(4);
    expect(aggregate.audit.overall.pass).toBe(true);
    expect(aggregate.audit.supply.auditable_count).toBe(4);
    expect(aggregate.failureSnapshot.top_auditable_story_ids).toEqual(['story-1', 'story-2', 'story-3', 'story-4']);
    expect(aggregate.runtimeLogs.browserLogs).toEqual(['profile-1-log', 'profile-2-log']);
  });

  it('deduplicates matching topics across profiles and surfaces parser errors', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 4,
      sourceProfiles: ['profile-a', 'profile-b'],
      subruns: [
        makeSubrun(1, 'profile-a', [
          makeBundle('story-1', 'topic-1'),
          makeBundle('story-2', 'topic-2'),
        ], { reportParseError: 'bad-json' }),
        makeSubrun(2, 'profile-b', [
          makeBundle('story-99', 'topic-1'),
          makeBundle('story-3', 'topic-3'),
        ]),
      ],
    });

    expect(aggregate.status).toBe(1);
    expect(aggregate.audit.sampled_story_count).toBe(3);
    expect(aggregate.audit.supply.auditable_count).toBe(3);
    expect(aggregate.reportParseError).toBe('bad-json');
    expect(aggregate.audit.bundles.map((bundle) => bundle.story_id)).toEqual(['story-1', 'story-2', 'story-3']);
  });

  it('falls back to story ids, ignores keyless bundles, and prefers higher-quality duplicates', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 3,
      sourceProfiles: ['profile-a', 'profile-b'],
      subruns: [
        makeSubrun(1, 'profile-a', [
          { ...makeBundle('story-1', null), canonical_source_count: 1, pairs: [{ label: 'same_incident' }] },
          { headline: 'missing ids', pairs: [] },
        ]),
        makeSubrun(2, 'profile-b', [
          { ...makeBundle('story-99', null), story_id: 'story-1', canonical_source_count: 3, pairs: [{ label: 'duplicate' }, { label: 'same_incident' }] },
          makeBundle('story-2', 'topic-2'),
        ]),
      ],
    });

    expect(aggregate.audit.supply.auditable_count).toBe(2);
    expect(aggregate.audit.bundles.map((bundle) => bundle.story_id)).toEqual(['story-1', 'story-2']);
    expect(aggregate.audit.bundles[0].pairs).toHaveLength(2);
  });

  it('handles zero-sample aggregates and bundles that only expose canonical_sources metadata', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 0,
      sourceProfiles: ['profile-a'],
      subruns: [
        makeSubrun(1, 'profile-a', [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'Headline story-1',
          canonical_sources: [{ source_id: 'source-a' }],
        }]),
      ],
    });

    expect(aggregate.status).toBe(0);
    expect(aggregate.audit.sampled_story_count).toBe(0);
    expect(aggregate.audit.supply.auditable_count).toBe(1);
    expect(aggregate.audit.overall.audited_pair_count).toBe(0);
    expect(aggregate.audit.overall.sample_fill_rate).toBeNull();
  });

  it('counts bundles with missing pairs and resolves duplicate scoring through canonical_sources length', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 1,
      sourceProfiles: ['profile-a', 'profile-b'],
      subruns: [
        makeSubrun(1, 'profile-a', [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'story-1',
          canonical_sources: [{ source_id: 'a' }],
        }]),
        makeSubrun(2, 'profile-b', [{
          story_id: 'story-2',
          topic_id: 'topic-1',
          headline: 'story-2',
          canonical_sources: [{ source_id: 'a' }, { source_id: 'b' }],
        }]),
      ],
    });

    expect(aggregate.audit.bundles).toHaveLength(1);
    expect(aggregate.audit.bundles[0].story_id).toBe('story-2');
    expect(aggregate.audit.overall.audited_pair_count).toBe(0);
    expect(aggregate.audit.overall.related_topic_only_pair_count).toBe(0);
  });

  it('falls back to audit supply diagnostics and surfaces audit errors when failure snapshots are absent', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 2,
      sourceProfiles: ['profile-a'],
      subruns: [{
        profileIndex: 1,
        sourceIds: 'profile-a',
        procStatus: 1,
        reportPath: '/tmp/run-1.playwright.json',
        reportParseError: null,
        audit: {
          requested_sample_count: 2,
          sampled_story_count: 1,
          visible_story_ids: ['story-1'],
          supply: {
            story_count: 1,
            auditable_count: 1,
            visible_story_ids: ['story-1'],
            top_story_ids: ['story-1'],
            top_auditable_story_ids: ['story-1'],
            sample_fill_rate: 0.5,
            sample_shortfall: 1,
          },
          bundles: [makeBundle('story-1', 'topic-1')],
          overall: {
            audited_pair_count: 1,
            related_topic_only_pair_count: 0,
            sample_fill_rate: 0.5,
            sample_shortfall: 1,
            pass: false,
          },
        },
        auditError: 'audit-missing-text',
        auditPath: '/tmp/run-1.semantic-audit.json',
        failureSnapshot: null,
        failureSnapshotPath: null,
        runtimeLogs: null,
        runtimeLogsPath: null,
      }],
    });

    expect(aggregate.audit.supply.status).toBe('partial');
    expect(aggregate.failureSnapshot.top_story_ids).toEqual(['story-1']);
    expect(aggregate.runtimeLogs.browserLogs).toEqual([]);
    expect(aggregate.auditError).toBe('audit-missing-text');
  });

  it('marks aggregate supply empty when no auditable bundles are recovered', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 2,
      sourceProfiles: ['profile-a'],
      subruns: [
        makeSubrun(1, 'profile-a', [], { auditError: 'no-auditable-bundles' }),
      ],
    });

    expect(aggregate.audit.supply.status).toBe('empty');
    expect(aggregate.audit.sampled_story_count).toBe(0);
    expect(aggregate.auditError).toBe('no-auditable-bundles');
    expect(aggregate.status).toBe(1);
  });

  it('falls back from blank topic ids to story ids and tolerates subruns with missing diagnostics', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 1,
      sourceProfiles: ['profile-a', 'profile-b'],
      subruns: [
        {
          profileIndex: 1,
          sourceIds: 'profile-a',
          procStatus: 1,
          reportPath: '/tmp/run-1.playwright.json',
          reportParseError: null,
          audit: {
            requested_sample_count: 1,
            sampled_story_count: 1,
            visible_story_ids: ['story-1'],
            supply: {
              story_count: 1,
              auditable_count: 1,
              visible_story_ids: ['story-1'],
              top_story_ids: ['story-1'],
              top_auditable_story_ids: ['story-1'],
              sample_fill_rate: 1,
              sample_shortfall: 0,
            },
            bundles: [{
              story_id: 'story-1',
              topic_id: '   ',
              headline: 'story-1',
              pairs: [{ label: 'duplicate' }],
            }],
            overall: {
              audited_pair_count: 1,
              related_topic_only_pair_count: 0,
              sample_fill_rate: 1,
              sample_shortfall: 0,
              pass: true,
            },
          },
          auditError: null,
          auditPath: '/tmp/run-1.semantic-audit.json',
          failureSnapshot: null,
          failureSnapshotPath: null,
          runtimeLogs: null,
          runtimeLogsPath: null,
        },
        {
          profileIndex: 2,
          sourceIds: 'profile-b',
          procStatus: 1,
          reportPath: '/tmp/run-2.playwright.json',
          reportParseError: null,
          audit: null,
          auditError: null,
          auditPath: null,
          failureSnapshot: null,
          failureSnapshotPath: null,
          runtimeLogs: null,
          runtimeLogsPath: null,
        },
      ],
    });

    expect(aggregate.audit.bundles.map((bundle) => bundle.story_id)).toEqual(['story-1']);
    expect(aggregate.audit.visible_story_ids).toEqual(['story-1']);
    expect(aggregate.failureSnapshot.top_story_ids).toEqual(['story-1']);
  });

  it('falls back to pair length and then zero when duplicate bundles omit explicit source counts', () => {
    const aggregate = aggregatePublicSemanticSoakSubruns({
      sampleCount: 2,
      sourceProfiles: ['profile-a', 'profile-b', 'profile-c'],
      subruns: [
        makeSubrun(1, 'profile-a', [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'story-1',
          pairs: [{ label: 'duplicate' }],
        }]),
        makeSubrun(2, 'profile-b', [{
          story_id: 'story-2',
          topic_id: 'topic-1',
          headline: 'story-2',
          pairs: [{ label: 'duplicate' }, { label: 'same_incident' }],
        }]),
        makeSubrun(3, 'profile-c', [{
          story_id: 'story-3',
          topic_id: 'topic-2',
          headline: 'story-3',
        }, {
          story_id: 'story-4',
          topic_id: 'topic-2',
          headline: 'story-4',
        }]),
      ],
    });

    expect(aggregate.audit.bundles.map((bundle) => bundle.story_id)).toEqual(['story-2', 'story-3']);
    expect(aggregate.audit.overall.audited_pair_count).toBe(2);
  });
});
