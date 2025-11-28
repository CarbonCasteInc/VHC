/* @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '../hooks/useFeedStore';
import AnalysisView from './AnalysisView';
import { useSentimentState } from '../hooks/useSentimentState';

vi.mock('../hooks/useRegion', () => ({
  useRegion: () => ({
    proof: {
      district_hash: 'test-district',
      nullifier: 'test-nullifier',
      merkle_root: 'test-root'
    }
  })
}));

const sample: FeedItem = {
  id: 'analysis-1',
  title: 'Story',
  summary: 'Narrative summary',
  source: 'Test',
  timestamp: Date.now(),
  imageUrl: undefined,
  engagementScore: 0.5,
  readCount: 1,
  perspectives: [
    { id: 'pa', frame: 'frame text', reframe: 'reframe text' }
  ]
};

describe('AnalysisView', () => {
  it('renders perspectives and updates per-cell sentiment', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {},
      lightbulb: {},
      eye: {},
      signals: []
    });
    render(<AnalysisView item={sample} />);
    const agree = screen.getByLabelText('Agree frame');
    fireEvent.click(agree);
    expect(useSentimentState.getState().getAgreement(sample.id, 'pa:frame')).toBe(1);

    fireEvent.click(agree);
    expect(useSentimentState.getState().getAgreement(sample.id, 'pa:frame')).toBe(0);
  });
});
