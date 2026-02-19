/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CellVoteControls } from './CellVoteControls';
import { useSentimentState } from '../../hooks/useSentimentState';

const useConstituencyProofMock = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useConstituencyProof', () => ({
  useConstituencyProof: () => useConstituencyProofMock(),
}));

const BASE_PROPS = {
  topicId: 'topic-1',
  pointId: 'point-abc',
  synthesisId: 'synth-1',
  epoch: 3,
  analysisId: 'story-1:prov-1',
};

function seedValidProof(): void {
  useConstituencyProofMock.mockReturnValue({
    proof: {
      district_hash: 'district-1',
      nullifier: 'nullifier-abc',
      merkle_root: 'root-1',
    },
    error: null,
  });
}

describe('CellVoteControls', () => {
  beforeEach(() => {
    useSentimentState.setState({
      agreements: {},
      lightbulb: {},
      eye: {},
      signals: [],
    });
    useConstituencyProofMock.mockReset();
    seedValidProof();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders agree and disagree buttons', () => {
    render(<CellVoteControls {...BASE_PROPS} />);
    expect(screen.getByTestId('cell-vote-agree-point-abc')).toBeInTheDocument();
    expect(screen.getByTestId('cell-vote-disagree-point-abc')).toBeInTheDocument();
  });

  it('click agree calls setAgreement with synthesis_id + epoch context', () => {
    const spy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    render(<CellVoteControls {...BASE_PROPS} />);

    fireEvent.click(screen.getByTestId('cell-vote-agree-point-abc'));

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: 'topic-1',
        pointId: 'point-abc',
        synthesisId: 'synth-1',
        epoch: 3,
        analysisId: 'story-1:prov-1',
        desired: 1,
        constituency_proof: {
          district_hash: 'district-1',
          nullifier: 'nullifier-abc',
          merkle_root: 'root-1',
        },
      }),
    );
  });

  it('click disagree calls setAgreement with desired=-1', () => {
    const spy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    render(<CellVoteControls {...BASE_PROPS} />);

    fireEvent.click(screen.getByTestId('cell-vote-disagree-point-abc'));

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ desired: -1 }),
    );
  });

  it('budget exceeded shows "Daily vote limit reached"', () => {
    vi.spyOn(useSentimentState.getState(), 'setAgreement').mockReturnValue({
      denied: true,
      reason: 'Daily limit reached for sentiment_votes/day',
    });

    render(<CellVoteControls {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('cell-vote-agree-point-abc'));

    expect(screen.getByTestId('cell-vote-denial-point-abc')).toHaveTextContent(
      'Daily vote limit reached',
    );
  });

  it('missing proof shows proof warning and sign-in denial text on vote', () => {
    useConstituencyProofMock.mockReturnValue({
      proof: null,
      error: 'Mock constituency proof detected; voting requires a verified proof source',
    });
    vi.spyOn(useSentimentState.getState(), 'setAgreement').mockReturnValue({
      denied: true,
      reason: 'Missing constituency proof',
    });

    render(<CellVoteControls {...BASE_PROPS} />);

    expect(screen.getByTestId('cell-vote-unweighted-point-abc')).toHaveTextContent(
      'Mock constituency proof detected; voting requires a verified proof source',
    );

    fireEvent.click(screen.getByTestId('cell-vote-agree-point-abc'));
    expect(screen.getByTestId('cell-vote-denial-point-abc')).toHaveTextContent(
      'Sign in to make your vote count',
    );
  });

  it('synthesis-context denial shows waiting message', () => {
    vi.spyOn(useSentimentState.getState(), 'setAgreement').mockReturnValue({
      denied: true,
      reason: 'Missing synthesis context',
    });

    render(<CellVoteControls {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('cell-vote-agree-point-abc'));

    expect(screen.getByTestId('cell-vote-denial-point-abc')).toHaveTextContent(
      'Waiting for synthesis context',
    );
  });

  it('disabled prop disables buttons and prevents writes', () => {
    const spy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    render(<CellVoteControls {...BASE_PROPS} disabled />);

    const agree = screen.getByTestId('cell-vote-agree-point-abc');
    const disagree = screen.getByTestId('cell-vote-disagree-point-abc');
    expect(agree).toBeDisabled();
    expect(disagree).toBeDisabled();

    fireEvent.click(agree);
    expect(spy).not.toHaveBeenCalled();
  });

  it('aria-pressed reflects contextual vote state', () => {
    const { rerender } = render(<CellVoteControls {...BASE_PROPS} />);

    expect(screen.getByTestId('cell-vote-agree-point-abc')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('cell-vote-disagree-point-abc')).toHaveAttribute('aria-pressed', 'false');

    useSentimentState.setState({
      agreements: { 'topic-1:synth-1:3:point-abc': 1 },
    });
    rerender(<CellVoteControls {...BASE_PROPS} />);

    expect(screen.getByTestId('cell-vote-agree-point-abc')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('cell-vote-disagree-point-abc')).toHaveAttribute('aria-pressed', 'false');
  });

  it('aggregate counts are filtered by synthesis_id + epoch', () => {
    useSentimentState.setState({
      signals: [
        {
          topic_id: 'topic-1',
          synthesis_id: 'synth-1',
          epoch: 3,
          point_id: 'point-abc',
          agreement: 1,
          weight: 1,
          constituency_proof: { district_hash: 'd', nullifier: 'n', merkle_root: 'm' },
          emitted_at: Date.now(),
        },
        {
          topic_id: 'topic-1',
          synthesis_id: 'synth-1',
          epoch: 3,
          point_id: 'point-abc',
          agreement: -1,
          weight: 1,
          constituency_proof: { district_hash: 'd', nullifier: 'n', merkle_root: 'm' },
          emitted_at: Date.now(),
        },
        {
          topic_id: 'topic-1',
          synthesis_id: 'synth-2',
          epoch: 3,
          point_id: 'point-abc',
          agreement: 1,
          weight: 1,
          constituency_proof: { district_hash: 'd', nullifier: 'n', merkle_root: 'm' },
          emitted_at: Date.now(),
        },
      ] as any,
    });

    render(<CellVoteControls {...BASE_PROPS} />);

    expect(screen.getByTestId('cell-vote-agree-point-abc')).toHaveTextContent('+ 1');
    expect(screen.getByTestId('cell-vote-disagree-point-abc')).toHaveTextContent('- 1');
  });
});
