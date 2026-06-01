import { describe, expect, it } from 'vitest';
import {
  classifyLifecycleLedgerStatus,
  classifySynthesisLifecycleFreshness,
  classifyLifecycleAccountabilityStatus,
  classifyProductIndexMetadata,
  isAcceptedFrameReady,
  isAcceptedSynthesisCurrentForStory,
  selectLifecycleSampleIds,
  sourceCount,
} from './public-feed-lifecycle-accountability.mjs';

describe('public feed lifecycle accountability helpers', () => {
  it('uses canonical primary sources when counting story composition', () => {
    expect(sourceCount({
      primary_sources: [{ publisher: 'A' }, { publisher: 'B' }],
      sources: [{ publisher: 'A' }],
      canonical_source_count: 1,
    })).toBe(2);
  });

  it('requires accepted synthesis facts and persisted frame/reframe point ids for frame readiness', () => {
    expect(isAcceptedFrameReady({
      facts_summary: 'Just the facts.',
      frames: [{
        frame: 'Frame',
        frame_point_id: 'frame-1',
        reframe: 'Reframe',
        reframe_point_id: 'reframe-1',
      }],
    })).toBe(true);
    expect(isAcceptedFrameReady({
      facts_summary: 'Just the facts.',
      frames: [{ frame: 'Frame', reframe: 'Reframe', frame_point_id: 'frame-1' }],
    })).toBe(false);
  });

  it('counts accepted synthesis only when it matches the current story source-set lifecycle', () => {
    const story = {
      story_id: 'story-current',
      provenance_hash: 'prov-current',
    };
    const lifecycle = {
      status: 'accepted_available',
      source_set_revision: 'prov-current',
      synthesis_id: 'synthesis-current',
      epoch: 2,
    };
    const synthesis = {
      synthesis_id: 'synthesis-current',
      epoch: 2,
      facts_summary: 'Just the facts.',
      inputs: {
        story_bundle_ids: ['story-current'],
      },
      frames: [{ frame: 'Frame', reframe: 'Reframe' }],
    };

    expect(isAcceptedSynthesisCurrentForStory({ story, lifecycle, synthesis })).toBe(true);
    expect(isAcceptedSynthesisCurrentForStory({
      story: { ...story, provenance_hash: 'prov-grown' },
      lifecycle,
      synthesis,
    })).toBe(false);
    expect(isAcceptedSynthesisCurrentForStory({
      story,
      lifecycle,
      synthesis: { ...synthesis, inputs: { story_bundle_ids: ['other-story'] } },
    })).toBe(false);
  });

  it('keeps hidden eligible raw stories as hard lifecycle failures even during source scarcity', () => {
    expect(classifyLifecycleAccountabilityStatus([
      { code: 'eligible_raw_story_hidden_without_allowed_reason' },
      { code: 'public_feed_composition_missing_multi_source' },
    ])).toBe('fail');
    expect(classifyLifecycleAccountabilityStatus([
      { code: 'relay_accepted_synthesis_not_current' },
      { code: 'public_feed_composition_missing_multi_source' },
    ])).toBe('fail');
    expect(classifyLifecycleAccountabilityStatus([
      { code: 'public_feed_composition_missing_multi_source' },
    ])).toBe('setup_scarcity');
    expect(classifyLifecycleAccountabilityStatus([
      { code: 'product_feed_hot_index_missing_for_visible_story' },
      { code: 'public_feed_composition_missing_multi_source' },
    ])).toBe('fail');
    expect(classifyLifecycleAccountabilityStatus([
      { code: 'hot_index_product_metadata_missing' },
    ])).toBe('fail');
    expect(classifyLifecycleAccountabilityStatus([
      { code: 'public_raw_story_mesh_missing_multi_source' },
      { code: 'public_feed_composition_missing_multi_source' },
    ])).toBe('fail');
    expect(classifyLifecycleAccountabilityStatus([
      { code: 'product_visible_synthesis_lifecycle_missing_or_stale' },
    ])).toBe('fail');
    expect(classifyLifecycleAccountabilityStatus([
      { code: 'product_visible_synthesis_lifecycle_pending_stale' },
    ])).toBe('fail');
  });

  it('preserves relay mixed-window backfill rows beyond the requested sample limit', () => {
    expect(selectLifecycleSampleIds({
      relayIds: ['story-singleton-a', 'story-singleton-b', 'story-multi-backfill'],
      latestIds: ['story-direct-latest'],
      hotIds: ['story-hot'],
      rawStoryIds: ['story-raw'],
      sampleLimit: 2,
    })).toEqual(['story-singleton-a', 'story-singleton-b', 'story-multi-backfill']);
  });

  it('uses the requested sample limit when relay does not backfill a wider window', () => {
    expect(selectLifecycleSampleIds({
      relayIds: ['story-relay'],
      latestIds: ['story-direct-latest', 'story-direct-latest-2'],
      hotIds: ['story-hot'],
      rawStoryIds: ['story-raw'],
      sampleLimit: 2,
    })).toEqual(['story-relay', 'story-direct-latest']);
  });

  it('requires product-visible stories to have a current synthesis lifecycle ledger row', () => {
    const story = {
      product_visible: true,
      source_count: 2,
      source_set_revision: 'source-set-1',
      lifecycle_status: 'pending',
      lifecycle_source_set_revision: 'source-set-1',
    };

    expect(classifyLifecycleLedgerStatus(story)).toBe('complete');
    expect(classifyLifecycleLedgerStatus({ ...story, lifecycle_status: null })).toBe('missing');
    expect(classifyLifecycleLedgerStatus({ ...story, lifecycle_status: 'bogus' })).toBe('invalid_status');
    expect(classifyLifecycleLedgerStatus({ ...story, lifecycle_source_set_revision: null })).toBe('missing_revision');
    expect(classifyLifecycleLedgerStatus({
      ...story,
      lifecycle_source_set_revision: 'source-set-old',
    })).toBe('source_set_mismatch');
    expect(classifyLifecycleLedgerStatus({ ...story, product_visible: false })).toBe('not_required');
  });

  it('fails stale or timestamp-less pending synthesis lifecycle rows', () => {
    const story = {
      product_visible: true,
      source_count: 1,
      lifecycle_status: 'pending',
      lifecycle_updated_at: 1_700_000_000_000,
    };
    const now = 1_700_000_100_000;

    expect(classifySynthesisLifecycleFreshness(story, now, 200_000)).toBe('fresh_pending');
    expect(classifySynthesisLifecycleFreshness(story, now, 50_000)).toBe('stale_pending');
    expect(classifySynthesisLifecycleFreshness({
      ...story,
      lifecycle_status: 'retryable_failure',
      lifecycle_updated_at: null,
    }, now, 50_000)).toBe('missing_updated_at');
    expect(classifySynthesisLifecycleFreshness({
      ...story,
      lifecycle_status: 'accepted_available',
    }, now, 50_000)).toBe('not_pending');
    expect(classifySynthesisLifecycleFreshness({
      ...story,
      product_visible: false,
    }, now, 50_000)).toBe('not_required');
  });

  it('classifies hot/latest product index metadata against current story source-set state', () => {
    const story = {
      story_id: 'story-1',
      topic_id: 'topic-1',
      provenance_hash: 'source-set-1',
      created_at: 100,
      cluster_window_start: 90,
      sources: [{ publisher: 'A' }, { publisher: 'B' }],
      primary_sources: [{ publisher: 'A' }],
    };

    expect(classifyProductIndexMetadata({
      story_id: 'story-1',
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: 'topic-1',
      source_set_revision: 'source-set-1',
      source_count: 2,
      canonical_source_count: 1,
      story_created_at: 100,
      cluster_window_start: 90,
    }, story)).toBe('complete');
    expect(classifyProductIndexMetadata({ hotness: 0.5 }, story)).toBe('missing');
    expect(classifyProductIndexMetadata({
      story_id: 'story-1',
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: 'topic-1',
      source_set_revision: 'source-set-old',
      source_count: 1,
      canonical_source_count: 1,
      story_created_at: 100,
      cluster_window_start: 90,
    }, story)).toBe('partial_or_mismatch');
  });
});
