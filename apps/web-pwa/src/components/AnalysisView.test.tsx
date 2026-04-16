/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '../hooks/useFeedStore';
import AnalysisView from './AnalysisView';
import { useSentimentState } from '../hooks/useSentimentState';

const useIdentityMock = vi.hoisted(() => vi.fn());
const useConstituencyProofMock = vi.hoisted(() => vi.fn());
const usePointAggregateMock = vi.hoisted(() => vi.fn());
const useSynthesisPointIdsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const forumStoreState = vi.hoisted(() => ({
  threads: new Map<string, { id: string; sourceSynthesisId?: string; sourceAnalysisId?: string }>(),
}));

vi.mock('../hooks/useIdentity', () => ({
  useIdentity: () => useIdentityMock(),
}));

vi.mock('../hooks/useConstituencyProof', () => ({
  useConstituencyProof: () => useConstituencyProofMock(),
}));

vi.mock('../hooks/useSynthesisPointIds', () => ({
  useSynthesisPointIds: (...args: unknown[]) => useSynthesisPointIdsMock(...args),
  perspectivePointMapKey: (perspectiveId: string, column: 'frame' | 'reframe') => `${perspectiveId}:${column}`,
}));

vi.mock('../hooks/usePointAggregate', () => ({
  usePointAggregate: (params: unknown) => usePointAggregateMock(params),
}));

vi.mock('../hooks/useViewTracking', () => ({
  useViewTracking: vi.fn(),
}));

vi.mock('../store/hermesForum', () => ({
  useForumStore: () => forumStoreState,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: navigateMock,
  }),
}));

vi.mock('./hermes/forum/ThreadView', () => ({
  ThreadView: ({ threadId }: { threadId: string }) => <div data-testid="thread-view">{threadId}</div>,
}));

vi.mock('./EngagementIcons', () => ({
  EngagementIcons: ({ eyeWeight, lightbulbWeight }: { eyeWeight: number; lightbulbWeight: number }) => (
    <div data-testid="engagement-icons">{`${eyeWeight}/${lightbulbWeight}`}</div>
  ),
}));

const sample: FeedItem = {
  id: 'analysis-1',
  title: 'Story',
  summary: 'Narrative summary',
  source: 'Test',
  timestamp: Date.now(),
  imageUrl: 'https://example.com/pic.png',
  engagementScore: 0.5,
  readCount: 1,
  perspectives: [{ id: 'pa', frame: 'frame text', reframe: 'reframe text' }],
};

function seedDefaults(): void {
  useIdentityMock.mockReturnValue({
    identity: {
      id: 'id-1',
      createdAt: Date.now(),
      attestation: { platform: 'web', integrityToken: 't', deviceKey: 'd', nonce: 'n' },
      session: { token: 'tok', trustScore: 1, scaledTrustScore: 10000, nullifier: 'null-1' },
    },
    status: 'ready',
  });

  useConstituencyProofMock.mockReturnValue({
    proof: {
      district_hash: 'district-1',
      nullifier: 'null-1',
      merkle_root: 'root-1',
    },
    error: null,
  });

  useSynthesisPointIdsMock.mockReturnValue({
    'pa:frame': 'synth-frame-1',
    'pa:reframe': 'synth-reframe-1',
  });

  usePointAggregateMock.mockImplementation(({ pointId }: { pointId: string }) => {
    if (pointId === 'synth-frame-1') {
      return {
        aggregate: { point_id: 'synth-frame-1', agree: 4, disagree: 2, weight: 1, participants: 6 },
        status: 'success',
        error: null,
      };
    }

    if (pointId === 'synth-reframe-1') {
      return {
        aggregate: { point_id: 'synth-reframe-1', agree: 1, disagree: 3, weight: 1, participants: 4 },
        status: 'success',
        error: null,
      };
    }

    return {
      aggregate: null,
      status: 'idle',
      error: null,
    };
  });
}

describe('AnalysisView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forumStoreState.threads = new Map();
    seedDefaults();

    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {},
      pointIdAliases: {},
      lightbulb: { 'analysis-1': 1.25 },
      eye: { 'analysis-1': 1.5 },
      signals: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('submits votes with validated constituency proof from useConstituencyProof', () => {
    const setAgreementSpy = vi.spyOn(useSentimentState.getState(), 'setAgreement');

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByLabelText('Agree frame'));

    expect(setAgreementSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: 'analysis-1',
        pointId: 'pa:frame',
        synthesisPointId: 'synth-frame-1',
        synthesisId: 'analysis-1',
        epoch: 0,
        desired: 1,
        constituency_proof: {
          district_hash: 'district-1',
          nullifier: 'null-1',
          merkle_root: 'root-1',
        },
      }),
    );

    expect(screen.queryByText('Create an account to cast votes')).not.toBeInTheDocument();
  });

  it('submits reframe votes using synthesis reframe point IDs', () => {
    const setAgreementSpy = vi.spyOn(useSentimentState.getState(), 'setAgreement');

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByLabelText('Agree reframe'));

    expect(setAgreementSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: 'analysis-1',
        pointId: 'pa:reframe',
        synthesisPointId: 'synth-reframe-1',
        synthesisId: 'analysis-1',
        epoch: 0,
        desired: 1,
      }),
    );
  });

  it('falls back to legacy point IDs when synthesis point map is missing', () => {
    const setAgreementSpy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    useSynthesisPointIdsMock.mockReturnValue({});

    render(<AnalysisView item={sample} />);

    expect(usePointAggregateMock).toHaveBeenCalledWith(
      expect.objectContaining({ pointId: 'pa:frame' }),
    );
    expect(usePointAggregateMock).toHaveBeenCalledWith(
      expect.objectContaining({ pointId: 'pa:reframe' }),
    );

    fireEvent.click(screen.getByLabelText('Agree frame'));
    fireEvent.click(screen.getByLabelText('Agree reframe'));

    expect(setAgreementSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        pointId: 'pa:frame',
        synthesisPointId: undefined,
      }),
    );
    expect(setAgreementSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        pointId: 'pa:reframe',
        synthesisPointId: undefined,
      }),
    );
  });

  it('toggles agree votes back to neutral for frame/reframe', () => {
    const setAgreementSpy = vi.spyOn(useSentimentState.getState(), 'setAgreement');

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByLabelText('Agree frame'));
    fireEvent.click(screen.getByLabelText('Agree frame'));
    fireEvent.click(screen.getByLabelText('Agree reframe'));
    fireEvent.click(screen.getByLabelText('Agree reframe'));

    expect(setAgreementSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pointId: 'pa:frame', desired: 0 }),
    );
    expect(setAgreementSpy).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ pointId: 'pa:reframe', desired: 0 }),
    );
  });

  it('submits disagree votes and toggles frame/reframe back to neutral', () => {
    const setAgreementSpy = vi.spyOn(useSentimentState.getState(), 'setAgreement');

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByLabelText('Disagree frame'));
    fireEvent.click(screen.getByLabelText('Disagree frame'));
    fireEvent.click(screen.getByLabelText('Disagree reframe'));
    fireEvent.click(screen.getByLabelText('Disagree reframe'));

    expect(setAgreementSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        topicId: 'analysis-1',
        pointId: 'pa:frame',
        synthesisPointId: 'synth-frame-1',
        desired: -1,
      }),
    );
    expect(setAgreementSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        topicId: 'analysis-1',
        pointId: 'pa:frame',
        synthesisPointId: 'synth-frame-1',
        desired: 0,
      }),
    );
    expect(setAgreementSpy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        topicId: 'analysis-1',
        pointId: 'pa:reframe',
        synthesisPointId: 'synth-reframe-1',
        desired: -1,
      }),
    );
    expect(setAgreementSpy).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        topicId: 'analysis-1',
        pointId: 'pa:reframe',
        synthesisPointId: 'synth-reframe-1',
        desired: 0,
      }),
    );
  });

  it('blocks disagree votes when identity/proof is unavailable', () => {
    const setAgreementSpy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    useIdentityMock.mockReturnValue({ identity: null, status: 'ready' });
    useConstituencyProofMock.mockReturnValue({
      proof: null,
      error: 'Identity nullifier unavailable; create/sign in before voting',
    });

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByLabelText('Disagree frame'));
    fireEvent.click(screen.getByLabelText('Disagree reframe'));

    expect(setAgreementSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Create an account to cast votes')).toBeInTheDocument();
  });

  it('clears prior warning timer on repeated blocked vote attempts', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    useIdentityMock.mockReturnValue({ identity: null, status: 'ready' });
    useConstituencyProofMock.mockReturnValue({
      proof: null,
      error: 'Identity nullifier unavailable; create/sign in before voting',
    });

    try {
      render(<AnalysisView item={sample} />);

      fireEvent.click(screen.getByLabelText('Agree reframe'));
      fireEvent.click(screen.getByLabelText('Agree reframe'));

      expect(screen.getByText('Create an account to cast votes')).toBeInTheDocument();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });

  it('shows identity-specific vote block message when identity is missing', () => {
    useIdentityMock.mockReturnValue({ identity: null, status: 'ready' });
    useConstituencyProofMock.mockReturnValue({
      proof: null,
      error: 'Identity nullifier unavailable; create/sign in before voting',
    });

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByLabelText('Agree frame'));

    expect(screen.getByText('Create an account to cast votes')).toBeInTheDocument();
  });

  it('shows proof-specific vote block message when proof validation fails', () => {
    useConstituencyProofMock.mockReturnValue({
      proof: null,
      error: 'Mock constituency proof detected; voting requires a verified proof source',
    });

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByLabelText('Agree frame'));

    expect(screen.getByText('Proof verification required to cast votes')).toBeInTheDocument();
  });

  it('forwards undefined proof payload when hook returns undefined proof', () => {
    const setAgreementSpy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    useConstituencyProofMock.mockReturnValue({ proof: undefined, error: null });

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByLabelText('Agree frame'));

    expect(setAgreementSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        pointId: 'pa:frame',
        constituency_proof: undefined,
      }),
    );
  });

  it('renders zero aggregate fallback when mesh aggregates are unavailable', () => {
    usePointAggregateMock.mockReturnValue({
      aggregate: null,
      status: 'idle',
      error: null,
    });

    render(<AnalysisView item={sample} />);

    expect(screen.getByTestId('perspective-frame-aggregate-pa')).toHaveTextContent('0/0');
    expect(screen.getByTestId('perspective-reframe-aggregate-pa')).toHaveTextContent('0/0');
  });

  it('renders aggregate counts from usePointAggregate for frame and reframe', () => {
    render(<AnalysisView item={sample} />);

    expect(screen.getByTestId('perspective-frame-aggregate-pa')).toHaveTextContent('4/2');
    expect(screen.getByTestId('perspective-reframe-aggregate-pa')).toHaveTextContent('1/3');
    expect(screen.getByTestId('engagement-icons')).toHaveTextContent('1.5/1.25');
    expect(screen.getByAltText('Story')).toBeInTheDocument();
  });

  it('renders linked forum thread on the back face when one exists', () => {
    forumStoreState.threads = new Map([
      ['thread-1', { id: 'thread-1', sourceSynthesisId: 'analysis-1' }],
    ]);

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByTestId('flip-to-forum'));

    expect(screen.getByTestId('thread-view')).toHaveTextContent('thread-1');
    expect(screen.queryByText('No forum thread yet')).not.toBeInTheDocument();
  });

  it('renders linked forum thread when matched by source analysis id', () => {
    forumStoreState.threads = new Map([
      ['thread-analysis', { id: 'thread-analysis', sourceAnalysisId: 'analysis-1' }],
    ]);

    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByTestId('flip-to-forum'));

    expect(screen.getByTestId('thread-view')).toHaveTextContent('thread-analysis');
  });

  it('navigates to create thread when no linked thread exists', () => {
    render(<AnalysisView item={sample} />);

    fireEvent.click(screen.getByTestId('flip-to-forum'));
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }));

    expect(screen.getByText('No forum thread yet')).toBeInTheDocument();
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/hermes',
      search: { sourceSynthesisId: 'analysis-1', title: 'Story' },
    });
  });
});
