import { describe, expect, it } from 'vitest';
import { makeBenchmarkItem } from './benchmarkCorpusBuilders';
import { runStoryClusterLiveBenchmark } from './liveBenchmark';

describe('StoryCluster live benchmark fixture coverage', () => {
  it('handles fixture runners that omit bundles by normalizing to an empty response', async () => {
    const report = await runStoryClusterLiveBenchmark({
      now: () => 1_715_000_000_000,
      fixtureDatasets: [{
        dataset_id: 'fixture-empty-response',
        topic_id: 'fixture-empty-response',
        items: [
          makeBenchmarkItem(
            'fixture-empty-response',
            'fixture-empty-source',
            'Port crews inspect the eastern berth after the attack',
            'fx1',
            1_715_000_000_000,
          ),
        ],
      }],
      replayScenarios: [],
      remoteRunner: async (payload) => ({
        telemetry: { topic_id: (payload as { topic_id: string }).topic_id } as never,
      }) as never,
    });

    expect(report.fixture_results).toHaveLength(1);
    expect(report.fixture_results[0]?.total_bundles).toBe(0);
    expect(report.fixture_overall.failed_dataset_ids).toEqual(['fixture-empty-response']);
    expect(report.replay_results).toEqual([]);
  });
});
