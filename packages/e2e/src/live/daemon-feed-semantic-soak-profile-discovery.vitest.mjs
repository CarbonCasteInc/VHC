import { describe, expect, it, vi } from 'vitest';
import {
  buildVisibleOverlapPairs,
  DEFAULT_DISCOVERY_PROFILES,
  discoveryArtifactRoot,
  headlineTerms,
  readDiscoveryProfiles,
  runProfileDiscovery,
  splitDiscoveryProfiles,
  summarizeDiscoveryProbe,
} from './daemon-feed-semantic-soak-profile-discovery.mjs';

describe('daemon-feed-semantic-soak-profile-discovery', () => {
  it('splits and resolves discovery profiles', () => {
    expect(splitDiscoveryProfiles('a,b; c,d ;; e,f')).toEqual(['a,b', 'c,d', 'e,f']);
    expect(readDiscoveryProfiles({})).toEqual(DEFAULT_DISCOVERY_PROFILES);
    expect(readDiscoveryProfiles({
      VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_PROFILES: '   ',
    })).toEqual(DEFAULT_DISCOVERY_PROFILES);
    expect(readDiscoveryProfiles({
      VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_PROFILES: 'x,y;z,w',
    })).toEqual(['x,y', 'z,w']);
  });

  it('derives artifact roots from env or cwd', () => {
    expect(discoveryArtifactRoot({
      VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_ARTIFACT_DIR: '/tmp/custom',
    }, '/repo')).toBe('/tmp/custom');
    expect(discoveryArtifactRoot({}, '/repo')).toMatch(/^\/repo\/\.tmp\/daemon-feed-semantic-soak\/profile-discovery-/);
  });

  it('normalizes headline terms and finds visible overlap only across distinct sources', () => {
    expect(headlineTerms('DOJ drops case against veteran arrested after burning U.S. flag near White House'))
      .toEqual(expect.arrayContaining(['doj', 'drop', 'case', 'veteran', 'arrest', 'burn', 'flag', 'white', 'house']));

    const overlaps = buildVisibleOverlapPairs([
      {
        story_id: 'story-1',
        headline: 'DOJ drops case against veteran arrested after burning U.S. flag near White House',
        source_ids: ['nbc-politics'],
        primary_source_ids: ['nbc-politics'],
        is_dom_visible: true,
      },
      {
        story_id: 'story-2',
        headline: 'DOJ moves to drop charges against man who burned American flag outside White House',
        source_ids: ['ap-politics'],
        primary_source_ids: ['ap-politics'],
        is_dom_visible: true,
      },
      {
        story_id: 'story-3',
        headline: 'Unrelated sports headline',
        source_ids: ['fox-latest'],
        primary_source_ids: ['fox-latest'],
        is_dom_visible: true,
      },
      {
        story_id: 'story-4',
        headline: 'Duplicate source should not count',
        source_ids: ['ap-politics'],
        primary_source_ids: ['ap-politics'],
        is_dom_visible: true,
      },
    ]);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({
      left_story_id: 'story-1',
      right_story_id: 'story-2',
      left_source_ids: ['nbc-politics'],
      right_source_ids: ['ap-politics'],
    });
    expect(overlaps[0].shared_terms).toEqual(expect.arrayContaining(['doj', 'drop', 'flag', 'white', 'house']));
  });

  it('skips stopword-only headlines when building visible overlaps', () => {
    expect(buildVisibleOverlapPairs([
      {
        story_id: 'story-1',
        headline: 'The and of in',
        source_ids: ['source-a'],
        primary_source_ids: ['source-a'],
        is_dom_visible: true,
      },
      {
        story_id: 'story-2',
        headline: 'Another unrelated story',
        source_ids: ['source-b'],
        primary_source_ids: ['source-b'],
        is_dom_visible: true,
      },
    ])).toEqual([]);
  });

  it('handles null stories, null headlines, and source-id fallbacks without overlaps', () => {
    expect(headlineTerms(null)).toEqual([]);
    expect(buildVisibleOverlapPairs(null)).toEqual([]);
    expect(buildVisibleOverlapPairs([
      {
        story_id: 'story-1',
        headline: 'White House legal filing update',
        source_ids: ['source-a'],
        primary_source_ids: undefined,
        is_dom_visible: true,
      },
      {
        story_id: 'story-2',
        headline: 'White House legal filing response',
        source_ids: undefined,
        primary_source_ids: undefined,
        is_dom_visible: true,
      },
    ])).toEqual([
      expect.objectContaining({
        left_story_id: 'story-1',
        right_story_id: 'story-2',
        left_source_ids: ['source-a'],
        right_source_ids: [],
      }),
    ]);
  });

  it('normalizes plural ies headline terms into a shared stem', () => {
    expect(headlineTerms('Policies stories')).toEqual(expect.arrayContaining(['policy', 'story']));
  });

  it('summarizes discovery probes from audits and visible overlap snapshots', () => {
    const summary = summarizeDiscoveryProbe({
      artifactDir: '/tmp/probe',
      profile: 'nbc-politics,nypost-politics',
      exitStatus: 1,
      audit: {
        sampled_story_count: 1,
        supply: {
          auditable_count: 1,
          visible_story_ids: ['story-1', 'story-2'],
        },
        bundles: [{ headline: 'Powell subpoenas headline' }],
      },
      snapshot: {
        visible_story_ids: ['story-1', 'story-2'],
        stories: [
          {
            story_id: 'story-1',
            headline: 'Pirro slams activist judge for blocking DOJ subpoenas against Fed Chair Jerome Powell',
            source_ids: ['nypost-politics'],
            primary_source_ids: ['nypost-politics'],
            is_dom_visible: true,
          },
          {
            story_id: 'story-2',
            headline: 'DOJ Blasts Judge for Blocking Subpoenas of Jerome Powell',
            source_ids: ['nbc-politics'],
            primary_source_ids: ['nbc-politics'],
            is_dom_visible: true,
          },
        ],
      },
    });

    expect(summary).toMatchObject({
      profile: 'nbc-politics,nypost-politics',
      sampledStoryCount: 1,
      auditableCount: 1,
      visibleStoryCount: 2,
      hasVisibleCooccurrence: true,
      auditableBundleHeadlines: ['Powell subpoenas headline'],
    });
    expect(summary.visibleOverlapPairs).toHaveLength(1);
  });

  it('falls back to audit visibility when no failure snapshot exists', () => {
    const summary = summarizeDiscoveryProbe({
      artifactDir: '/tmp/probe',
      profile: 'cbs-politics,guardian-us',
      exitStatus: 0,
      audit: {
        sampled_story_count: 1,
        visible_story_ids: ['story-1', 'story-2', 'story-3'],
        bundles: [],
      },
      snapshot: null,
    });

    expect(summary).toMatchObject({
      visibleStoryCount: 3,
      hasVisibleCooccurrence: false,
      visibleStories: [],
      visibleOverlapPairs: [],
    });
  });

  it('runs the build once, probes each profile, and writes a ranked report', () => {
    const writes = new Map();
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: undefined, stderr: undefined })
      .mockReturnValueOnce({ status: 1, stdout: 'probe-2', stderr: '' });

    const readFile = vi.fn((target) => {
      if (target.endsWith('profile-1/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-1', 'story-2'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-1',
              headline: 'DOJ drops case against veteran arrested after burning U.S. flag near White House',
              source_ids: ['guardian-us'],
              primary_source_ids: ['guardian-us'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-2',
              headline: 'DOJ moves to drop charges against man who burned American flag outside White House',
              source_ids: ['huffpost-us'],
              primary_source_ids: ['huffpost-us'],
              is_dom_visible: true,
            },
          ],
        });
      }
      if (target.endsWith('profile-2/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({
          sampled_story_count: 0,
          bundles: [{ headline: 'Nathan Wade headline' }],
          supply: {
            auditable_count: 0,
            visible_story_ids: ['story-3', 'story-4', 'story-5'],
          },
        });
      }
      if (target.endsWith('profile-2/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-3', 'story-4', 'story-5'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-3',
              headline: 'DOJ Blasts Judge for Blocking Subpoenas of Jerome Powell',
              source_ids: ['nbc-politics'],
              primary_source_ids: ['nbc-politics'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-4',
              headline: 'Pirro slams activist judge for blocking DOJ subpoenas against Fed Chair Jerome Powell',
              source_ids: ['nypost-politics'],
              primary_source_ids: ['nypost-politics'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-5',
              headline: 'Unrelated Texas Senate headline',
              source_ids: ['nypost-politics'],
              primary_source_ids: ['nypost-politics'],
              is_dom_visible: true,
            },
          ],
        });
      }
      throw new Error(`missing:${target}`);
    });

    const result = runProfileDiscovery({
      cwd: '/repo',
      env: {
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_ARTIFACT_DIR: '/repo/.tmp/discovery',
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_PROFILES: 'guardian-us,huffpost-us;abc-politics,pbs-politics',
      },
      spawn,
      mkdir: vi.fn(),
      readFile,
      writeFile: (target, content) => writes.set(target, String(content)),
      log: vi.fn(),
    });

    expect(spawn).toHaveBeenNthCalledWith(1, 'pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:build'], expect.any(Object));
    expect(spawn).toHaveBeenNthCalledWith(2, 'pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:semantic-soak'], expect.objectContaining({
      env: expect.objectContaining({
        VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: 'guardian-us,huffpost-us',
        VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
      }),
    }));
    expect(result.report.recommendedProfiles).toEqual([
      'abc-politics,pbs-politics',
      'guardian-us,huffpost-us',
    ]);
    expect(JSON.parse(writes.get('/repo/.tmp/discovery/profile-discovery-report.json'))).toMatchObject({
      schemaVersion: 'daemon-feed-semantic-soak-profile-discovery-v1',
      recommendedProfiles: ['abc-politics,pbs-politics', 'guardian-us,huffpost-us'],
    });
  });

  it('uses explicit probe timeout and tolerates missing build stdio', () => {
    const writes = new Map();
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: undefined, stderr: undefined })
      .mockReturnValueOnce({ status: 0, stdout: 'probe ok', stderr: '' });

    const result = runProfileDiscovery({
      cwd: '/repo',
      env: {
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_ARTIFACT_DIR: '/repo/.tmp/discovery',
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_PROFILES: 'nbc-politics,pbs-politics',
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_TIMEOUT_MS: '45000',
      },
      spawn,
      mkdir: vi.fn(),
      readFile: vi.fn(() => {
        throw new Error('missing');
      }),
      writeFile: (target, content) => writes.set(target, String(content)),
      log: vi.fn(),
    });

    expect(spawn).toHaveBeenNthCalledWith(2, 'pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:semantic-soak'], expect.objectContaining({
      env: expect.objectContaining({
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '45000',
      }),
    }));
    expect(writes.get('/repo/.tmp/discovery/build.stdout.log')).toBe('');
    expect(writes.get('/repo/.tmp/discovery/build.stderr.log')).toBe('');
    expect(result.report.recommendedProfiles).toEqual([]);
  });

  it('fails fast when the discovery build fails', () => {
    const spawn = vi.fn().mockReturnValue({ status: 2, stdout: '', stderr: 'boom' });

    expect(() => runProfileDiscovery({
      cwd: '/repo',
      env: { VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_ARTIFACT_DIR: '/repo/.tmp/discovery' },
      spawn,
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    })).toThrow('profile-discovery-build-failed:2');
  });
});
