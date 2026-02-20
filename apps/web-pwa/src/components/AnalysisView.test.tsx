/* @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '../hooks/useFeedStore';
import AnalysisView from './AnalysisView';
import { useSentimentState } from '../hooks/useSentimentState';
import * as IdentityHook from '../hooks/useIdentity';

vi.mock('../hooks/useRegion', () => ({
  useRegion: () => ({
    proof: {
      district_hash: 'test-district',
      nullifier: 'test-nullifier',
      merkle_root: 'test-root'
    }
  })
}));

vi.mock('../hooks/useSynthesisPointIds', () => ({
  useSynthesisPointIds: () => ({}),
  perspectivePointMapKey: (perspectiveId: string, column: 'frame' | 'reframe') => `${perspectiveId}:${column}`,
}));

vi.mock('../hooks/usePointAggregate', () => ({
  usePointAggregate: () => ({
    aggregate: { point_id: 'p', agree: 0, disagree: 0, weight: 0, participants: 0 },
    status: 'success',
    error: null,
  }),
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
      pointIdAliases: {},
      lightbulb: {},
      eye: {},
      signals: []
    });
    vi.spyOn(IdentityHook, 'useIdentity').mockReturnValue({
      identity: {
        id: 'id',
        createdAt: Date.now(),
        attestation: { platform: 'web', integrityToken: 't', deviceKey: 'd', nonce: 'n' },
        session: { token: 't', trustScore: 1, scaledTrustScore: 10000, nullifier: 'n' }
      },
      status: 'ready'
    } as any);
    render(<AnalysisView item={sample} />);
    const [agree] = screen.getAllByLabelText('Agree frame');
    fireEvent.click(agree!);
    expect(useSentimentState.getState().getAgreement(sample.id, 'pa:frame')).toBe(1);

    fireEvent.click(agree!);
    expect(useSentimentState.getState().getAgreement(sample.id, 'pa:frame')).toBe(0);
  });
});
