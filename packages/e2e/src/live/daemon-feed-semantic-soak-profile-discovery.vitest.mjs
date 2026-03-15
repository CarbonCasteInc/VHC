import { describe, expect, it, vi } from 'vitest';
import {
  buildDerivedCandidateProfiles,
  buildVisibleOverlapPairs,
  DEFAULT_DISCOVERY_CENSUS_SOURCES,
  discoveryArtifactRoot,
  headlineTerms,
  readDiscoveryCensusSources,
  readDiscoveryProfiles,
  runProfileDiscovery,
  splitDiscoveryProfiles,
  splitDiscoverySources,
  summarizeDiscoveryProbe,
} from './daemon-feed-semantic-soak-profile-discovery.mjs';

describe('daemon-feed-semantic-soak-profile-discovery', () => {
  it('splits and resolves discovery profiles and census sources', () => {
    expect(splitDiscoveryProfiles('a,b; c,d ;; e,f')).toEqual(['a,b', 'c,d', 'e,f']);
    expect(splitDiscoverySources('a, b ,, c')).toEqual(['a', 'b', 'c']);
    expect(readDiscoveryProfiles({})).toEqual([]);
    expect(readDiscoveryProfiles({
      VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_PROFILES: '   ',
    })).toEqual([]);
    expect(readDiscoveryProfiles({
      VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_PROFILES: 'x,y;z,w',
    })).toEqual(['x,y', 'z,w']);
    expect(readDiscoveryCensusSources({})).toEqual(DEFAULT_DISCOVERY_CENSUS_SOURCES);
    expect(readDiscoveryCensusSources({
      VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_SOURCES: 'abc-politics,pbs-politics',
    })).toEqual(['abc-politics', 'pbs-politics']);
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

  it('handles null stories, null headlines, and source-id fallbacks without overlaps', () => {
    expect(headlineTerms(null)).toEqual([]);
    expect(buildVisibleOverlapPairs(null)).toEqual([]);
    expect(buildVisibleOverlapPairs([
      {
        story_id: 'story-0',
        headline: 'The and of in',
        source_ids: ['source-z'],
        primary_source_ids: ['source-z'],
        is_dom_visible: true,
      },
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

  it('derives candidate profiles from census probes instead of guessed pairs', () => {
    const candidates = buildDerivedCandidateProfiles([
      {
        profile: 'bbc-us-canada',
        visibleStories: [
          {
            story_id: 'story-1',
            headline: 'Teacher dies during toilet paper prank as charges are dropped against teens',
            source_ids: ['bbc-us-canada'],
            primary_source_ids: ['bbc-us-canada'],
            is_dom_visible: true,
          },
        ],
      },
      {
        profile: 'huffpost-us',
        visibleStories: [
          {
            story_id: 'story-2',
            headline: 'Prosecutor drops charge after teacher dies during prank mishap',
            source_ids: ['huffpost-us'],
            primary_source_ids: ['huffpost-us'],
            is_dom_visible: true,
          },
        ],
      },
      {
        profile: 'guardian-us',
        visibleStories: [
          {
            story_id: 'story-3',
            headline: 'Unrelated foreign policy headline',
            source_ids: ['guardian-us'],
            primary_source_ids: ['guardian-us'],
            is_dom_visible: true,
          },
        ],
      },
    ]);

    expect(candidates).toEqual([
      expect.objectContaining({
        profile: 'bbc-us-canada,huffpost-us',
        overlapCount: 1,
      }),
    ]);
  });

  it('skips derived candidates that still do not resolve to two distinct source ids', () => {
    expect(buildDerivedCandidateProfiles([
      {
        profile: 'source-a',
        visibleStories: [
          {
            story_id: 'story-1',
            headline: 'Teacher prank death charge dropped case update',
            source_ids: undefined,
            primary_source_ids: undefined,
            is_dom_visible: true,
          },
        ],
      },
      {
        profile: 'source-b',
        visibleStories: [
          {
            story_id: 'story-2',
            headline: 'Teacher prank death charge dropped case update',
            source_ids: undefined,
            primary_source_ids: undefined,
            is_dom_visible: true,
          },
        ],
      },
    ])).toEqual([]);
  });

  it('ranks derived candidates by overlap count, shared terms, similarity, then profile name', () => {
    const candidates = buildDerivedCandidateProfiles([
      {
        profile: 'source-a',
        visibleStories: [
          {
            story_id: 'story-1',
            headline: 'Jerome Powell subpoena ruling federal reserve probe update',
            source_ids: ['source-a'],
            primary_source_ids: ['source-a'],
            is_dom_visible: true,
          },
          {
            story_id: 'story-2',
            headline: 'Teacher prank death criminal charge dropped case',
            source_ids: ['source-a'],
            primary_source_ids: ['source-a'],
            is_dom_visible: true,
          },
        ],
      },
      {
        profile: 'source-b',
        visibleStories: [
          {
            story_id: 'story-3',
            headline: 'Jerome Powell subpoena ruling update on federal reserve probe',
            source_ids: ['source-b'],
            primary_source_ids: ['source-b'],
            is_dom_visible: true,
          },
        ],
      },
      {
        profile: 'source-c',
        visibleStories: [
          {
            story_id: 'story-4',
            headline: 'Teacher prank death charge dropped in criminal case',
            source_ids: ['source-c'],
            primary_source_ids: ['source-c'],
            is_dom_visible: true,
          },
        ],
      },
      {
        profile: 'source-d',
        visibleStories: [
          {
            story_id: 'story-5',
            headline: 'Teacher prank death charge dropped case update',
            source_ids: ['source-d'],
            primary_source_ids: ['source-d'],
            is_dom_visible: true,
          },
        ],
      },
    ]);

    expect(candidates.map((candidate) => candidate.profile)).toEqual([
      'source-a,source-b',
      'source-a,source-c',
      'source-a,source-d',
      'source-c,source-d',
    ]);
  });

  it('summarizes probes from audits and visible overlap snapshots', () => {
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

  it('runs census probes, derives candidates, probes surfaced candidates, and writes a ranked report', () => {
    const writes = new Map();
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: 'census-1', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: 'census-2', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'candidate-1', stderr: '' });

    const readFile = vi.fn((target) => {
      if (target.endsWith('census-1/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({
          sampled_story_count: 0,
          bundles: [],
          visible_story_ids: ['story-1'],
        });
      }
      if (target.endsWith('census-1/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-1'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-1',
              headline: 'Teacher dies during toilet paper prank as charges are dropped against teens',
              source_ids: ['bbc-us-canada'],
              primary_source_ids: ['bbc-us-canada'],
              is_dom_visible: true,
            },
          ],
        });
      }
      if (target.endsWith('census-2/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({
          sampled_story_count: 0,
          bundles: [],
          visible_story_ids: ['story-2'],
        });
      }
      if (target.endsWith('census-2/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-2'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-2',
              headline: 'Prosecutor drops charge after teacher dies during prank mishap',
              source_ids: ['huffpost-us'],
              primary_source_ids: ['huffpost-us'],
              is_dom_visible: true,
            },
          ],
        });
      }
      if (target.endsWith('candidate-1/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({
          sampled_story_count: 1,
          bundles: [{ headline: 'Teacher prank case headline' }],
          supply: {
            auditable_count: 1,
            visible_story_ids: ['story-1', 'story-2'],
          },
        });
      }
      if (target.endsWith('candidate-1/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-1', 'story-2'],
          auditable_count: 1,
          stories: [
            {
              story_id: 'story-1',
              headline: 'Teacher dies during toilet paper prank as charges are dropped against teens',
              source_ids: ['bbc-us-canada'],
              primary_source_ids: ['bbc-us-canada'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-2',
              headline: 'Prosecutor drops charge after teacher dies during prank mishap',
              source_ids: ['huffpost-us'],
              primary_source_ids: ['huffpost-us'],
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
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_SOURCES: 'bbc-us-canada,huffpost-us',
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
        VH_DAEMON_FEED_SOAK_SKIP_BUILD: 'true',
        VH_DAEMON_FEED_READY_TIMEOUT_MS: '60000',
        VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: 'bbc-us-canada',
      }),
    }));
    expect(spawn).toHaveBeenNthCalledWith(4, 'pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:semantic-soak'], expect.objectContaining({
      env: expect.objectContaining({
        VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: 'bbc-us-canada,huffpost-us',
      }),
    }));
    expect(result.report.derivedCandidates).toEqual([
      expect.objectContaining({
        profile: 'bbc-us-canada,huffpost-us',
      }),
    ]);
    expect(result.report.recommendedProfiles).toEqual(['bbc-us-canada,huffpost-us']);
    expect(JSON.parse(writes.get('/repo/.tmp/discovery/profile-discovery-report.json'))).toMatchObject({
      schemaVersion: 'daemon-feed-semantic-soak-profile-discovery-v2',
      recommendedProfiles: ['bbc-us-canada,huffpost-us'],
    });
  });

  it('uses explicit candidate profiles and tolerates missing build stdio', () => {
    const writes = new Map();
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: undefined, stderr: undefined })
      .mockReturnValueOnce({ status: 1, stdout: 'census', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'candidate', stderr: '' });

    const result = runProfileDiscovery({
      cwd: '/repo',
      env: {
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_ARTIFACT_DIR: '/repo/.tmp/discovery',
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_SOURCES: 'abc-politics',
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

    expect(spawn).toHaveBeenNthCalledWith(3, 'pnpm', ['--filter', '@vh/e2e', 'test:live:daemon-feed:semantic-soak'], expect.objectContaining({
      env: expect.objectContaining({
        VH_DAEMON_FEED_SOAK_SKIP_BUILD: 'true',
        VH_DAEMON_FEED_READY_TIMEOUT_MS: '45000',
        VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: 'nbc-politics,pbs-politics',
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '45000',
      }),
    }));
    expect(writes.get('/repo/.tmp/discovery/build.stdout.log')).toBe('');
    expect(writes.get('/repo/.tmp/discovery/build.stderr.log')).toBe('');
    expect(result.report.derivedCandidates).toEqual([]);
    expect(result.report.candidateProfiles).toEqual(['nbc-politics,pbs-politics']);
    expect(result.report.recommendedProfiles).toEqual([]);
  });

  it('tolerates missing probe stdio during census probes', () => {
    const writes = new Map();
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: undefined, stderr: undefined });

    const result = runProfileDiscovery({
      cwd: '/repo',
      env: {
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_ARTIFACT_DIR: '/repo/.tmp/discovery',
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_SOURCES: 'abc-politics',
      },
      spawn,
      mkdir: vi.fn(),
      readFile: vi.fn(() => {
        throw new Error('missing');
      }),
      writeFile: (target, content) => writes.set(target, String(content)),
      log: vi.fn(),
    });

    expect(writes.get('/repo/.tmp/discovery/census-1/probe.stdout.log')).toBe('');
    expect(writes.get('/repo/.tmp/discovery/census-1/probe.stderr.log')).toBe('');
    expect(result.report.candidateProfiles).toEqual([]);
  });

  it('ranks recommended candidate probes after census derives multiple candidates', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: 'census-1', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: 'census-2', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: 'census-3', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: 'candidate-1', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: 'candidate-2', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: 'candidate-3', stderr: '' });

    const readFile = vi.fn((target) => {
      if (target.endsWith('census-1/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({ sampled_story_count: 0, bundles: [], visible_story_ids: ['story-1'] });
      }
      if (target.endsWith('census-1/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-1'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-1',
              headline: 'Teacher prank death criminal charge dropped case',
              source_ids: ['source-a'],
              primary_source_ids: ['source-a'],
              is_dom_visible: true,
            },
          ],
        });
      }
      if (target.endsWith('census-2/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({ sampled_story_count: 0, bundles: [], visible_story_ids: ['story-2'] });
      }
      if (target.endsWith('census-2/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-2'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-2',
              headline: 'Teacher prank death charge dropped criminal case',
              source_ids: ['source-b'],
              primary_source_ids: ['source-b'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-3',
              headline: 'Teacher prank death charge dropped update',
              source_ids: ['source-c'],
              primary_source_ids: ['source-c'],
              is_dom_visible: true,
            },
          ],
        });
      }
      if (target.endsWith('candidate-1/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({
          sampled_story_count: 0,
          bundles: [],
          visible_story_ids: ['story-1', 'story-2', 'story-9'],
        });
      }
      if (target.endsWith('candidate-1/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-1', 'story-2', 'story-9'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-1',
              headline: 'Teacher prank death criminal charge dropped case',
              source_ids: ['source-a'],
              primary_source_ids: ['source-a'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-2',
              headline: 'Teacher prank death charge dropped criminal case',
              source_ids: ['source-b'],
              primary_source_ids: ['source-b'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-9',
              headline: 'Unrelated story stays visible',
              source_ids: ['source-a'],
              primary_source_ids: ['source-a'],
              is_dom_visible: true,
            },
          ],
        });
      }
      if (target.endsWith('candidate-2/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({
          sampled_story_count: 0,
          bundles: [],
          visible_story_ids: ['story-1', 'story-3'],
        });
      }
      if (target.endsWith('candidate-2/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-1', 'story-3'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-1',
              headline: 'Teacher prank death criminal charge dropped case',
              source_ids: ['source-a'],
              primary_source_ids: ['source-a'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-3',
              headline: 'Teacher prank death charge dropped update',
              source_ids: ['source-c'],
              primary_source_ids: ['source-c'],
              is_dom_visible: true,
            },
          ],
        });
      }
      if (target.endsWith('census-3/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({ sampled_story_count: 0, bundles: [], visible_story_ids: ['story-3'] });
      }
      if (target.endsWith('census-3/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-3'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-3',
              headline: 'Teacher prank death charge dropped update',
              source_ids: ['source-c'],
              primary_source_ids: ['source-c'],
              is_dom_visible: true,
            },
          ],
        });
      }
      if (target.endsWith('candidate-3/run-1.profile-1.semantic-audit.json')) {
        return JSON.stringify({
          sampled_story_count: 0,
          bundles: [],
          visible_story_ids: ['story-2', 'story-3'],
        });
      }
      if (target.endsWith('candidate-3/run-1.profile-1.semantic-audit-failure-snapshot.json')) {
        return JSON.stringify({
          visible_story_ids: ['story-2', 'story-3'],
          auditable_count: 0,
          stories: [
            {
              story_id: 'story-2',
              headline: 'Teacher prank death charge dropped criminal case',
              source_ids: ['source-b'],
              primary_source_ids: ['source-b'],
              is_dom_visible: true,
            },
            {
              story_id: 'story-3',
              headline: 'Teacher prank death charge dropped update',
              source_ids: ['source-c'],
              primary_source_ids: ['source-c'],
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
        VH_PUBLIC_SEMANTIC_SOAK_DISCOVERY_SOURCES: 'source-a,source-b,source-c',
      },
      spawn,
      mkdir: vi.fn(),
      readFile,
      writeFile: vi.fn(),
      log: vi.fn(),
    });

    expect(result.report.candidateProfiles).toEqual(['source-a,source-c', 'source-a,source-b', 'source-b,source-c']);
    expect(result.report.recommendedProfiles).toEqual(['source-a,source-c', 'source-a,source-b', 'source-b,source-c']);
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
