/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CellVoteControls } from './CellVoteControls';
import { useSentimentState } from '../../hooks/useSentimentState';
import * as identityProvider from '../../store/identityProvider';

vi.mock('../../store/identityProvider', () => ({
  getPublishedIdentity: vi.fn(),
  publishIdentity: vi.fn(),
  clearPublishedIdentity: vi.fn(),
}));

const mockGetPublishedIdentity = vi.mocked(identityProvider.getPublishedIdentity);

const BASE_PROPS = {
  topicId: 'topic-1',
  pointId: 'frame:0',
  analysisId: 'story-1:prov-1',
};

function seedIdentity(): void {
  mockGetPublishedIdentity.mockReturnValue({
    session: {
      nullifier: 'nullifier-abc',
      trustScore: 0.8,
      scaledTrustScore: 0.9,
      expiresAt: Date.now() + 3_600_000,
    },
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
    mockGetPublishedIdentity.mockReturnValue(null);
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders agree and disagree buttons', () => {
    render(<CellVoteControls {...BASE_PROPS} />);
    expect(screen.getByTestId('cell-vote-agree-frame:0')).toBeInTheDocument();
    expect(screen.getByTestId('cell-vote-disagree-frame:0')).toBeInTheDocument();
  });

  it('click agree calls setAgreement with desired=1 and constituency_proof', () => {
    seedIdentity();
    const spy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    render(<CellVoteControls {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('cell-vote-agree-frame:0'));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: 'topic-1',
        pointId: 'frame:0',
        analysisId: 'story-1:prov-1',
        desired: 1,
        constituency_proof: {
          district_hash: 'default-district',
          nullifier: 'nullifier-abc',
          merkle_root: 'default-merkle-root',
        },
      }),
    );
  });

  it('click agree twice toggles to 0 (retract)', () => {
    seedIdentity();
    const spy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    render(<CellVoteControls {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('cell-vote-agree-frame:0'));
    fireEvent.click(screen.getByTestId('cell-vote-agree-frame:0'));
    // Second call passes desired=1 again; the store toggles to 0 internally
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ desired: 1 }),
    );
  });

  it('click disagree calls setAgreement with desired=-1', () => {
    seedIdentity();
    const spy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    render(<CellVoteControls {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('cell-vote-disagree-frame:0'));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ desired: -1 }),
    );
  });

  it('budget exceeded shows "Daily vote limit reached"', () => {
    seedIdentity();
    vi.spyOn(useSentimentState.getState(), 'setAgreement').mockReturnValue({
      denied: true,
      reason: 'Daily limit reached for sentiment_votes/day',
    });
    render(<CellVoteControls {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('cell-vote-agree-frame:0'));
    expect(screen.getByTestId('cell-vote-denial-frame:0')).toHaveTextContent(
      'Daily vote limit reached',
    );
  });

  it('no constituency proof shows "Unweighted vote" indicator', () => {
    mockGetPublishedIdentity.mockReturnValue(null);
    render(<CellVoteControls {...BASE_PROPS} />);
    expect(screen.getByTestId('cell-vote-unweighted-frame:0')).toHaveTextContent(
      'Unweighted vote',
    );
  });

  it('with identity, no unweighted banner shown', () => {
    seedIdentity();
    render(<CellVoteControls {...BASE_PROPS} />);
    expect(screen.queryByTestId('cell-vote-unweighted-frame:0')).not.toBeInTheDocument();
  });

  it('missing constituency proof denial shows sign-in message', () => {
    mockGetPublishedIdentity.mockReturnValue(null);
    vi.spyOn(useSentimentState.getState(), 'setAgreement').mockReturnValue({
      denied: true,
      reason: 'Missing constituency proof',
    });
    render(<CellVoteControls {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('cell-vote-agree-frame:0'));
    expect(screen.getByTestId('cell-vote-denial-frame:0')).toHaveTextContent(
      'Sign in to make your vote count',
    );
  });

  it('disabled prop disables buttons', () => {
    render(<CellVoteControls {...BASE_PROPS} disabled />);
    expect(screen.getByTestId('cell-vote-agree-frame:0')).toBeDisabled();
    expect(screen.getByTestId('cell-vote-disagree-frame:0')).toBeDisabled();
  });

  it('aria-pressed reflects vote state', () => {
    seedIdentity();
    const { rerender } = render(<CellVoteControls {...BASE_PROPS} />);
    expect(screen.getByTestId('cell-vote-agree-frame:0')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('cell-vote-disagree-frame:0')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Simulate an agree state in the store
    useSentimentState.setState({
      agreements: { 'topic-1:frame:0': 1 },
    });
    rerender(<CellVoteControls {...BASE_PROPS} />);
    expect(screen.getByTestId('cell-vote-agree-frame:0')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('cell-vote-disagree-frame:0')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('persisted state shown on mount (reads from getAgreement)', () => {
    seedIdentity();
    useSentimentState.setState({
      agreements: { 'topic-1:frame:0': -1 },
    });
    render(<CellVoteControls {...BASE_PROPS} />);
    expect(screen.getByTestId('cell-vote-disagree-frame:0')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('cell-vote-agree-frame:0')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('displays aggregate counts from signals', () => {
    seedIdentity();
    useSentimentState.setState({
      signals: [
        { topic_id: 'topic-1', analysis_id: 'story-1:prov-1', point_id: 'frame:0', agreement: 1, weight: 1, constituency_proof: { district_hash: 'd', nullifier: 'n', merkle_root: 'm' }, emitted_at: Date.now() },
        { topic_id: 'topic-1', analysis_id: 'story-1:prov-1', point_id: 'frame:0', agreement: 1, weight: 1, constituency_proof: { district_hash: 'd', nullifier: 'n', merkle_root: 'm' }, emitted_at: Date.now() },
        { topic_id: 'topic-1', analysis_id: 'story-1:prov-1', point_id: 'frame:0', agreement: -1, weight: 1, constituency_proof: { district_hash: 'd', nullifier: 'n', merkle_root: 'm' }, emitted_at: Date.now() },
      ],
    });
    render(<CellVoteControls {...BASE_PROPS} />);
    expect(screen.getByTestId('cell-vote-agree-frame:0')).toHaveTextContent('+ 2');
    expect(screen.getByTestId('cell-vote-disagree-frame:0')).toHaveTextContent('- 1');
  });

  it('disabled prop prevents setAgreement call', () => {
    seedIdentity();
    const spy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    render(<CellVoteControls {...BASE_PROPS} disabled />);
    fireEvent.click(screen.getByTestId('cell-vote-agree-frame:0'));
    expect(spy).not.toHaveBeenCalled();
  });
});
