import { describe, expect, it } from 'vitest';
import {
  classifyLifecycleAccountabilityStatus,
  isAcceptedFrameReady,
  isAcceptedSynthesisCurrentForStory,
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
  });
});
