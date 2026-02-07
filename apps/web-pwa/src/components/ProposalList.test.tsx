/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '../hooks/useGovernance';
import ProposalList from './ProposalList';
import { useXpLedger } from '../store/xpLedger';

const mockUseGovernance = vi.fn();
const mockUseIdentity = vi.fn();

vi.mock('../hooks/useGovernance', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseGovernance(...args),
  MIN_TRUST_TO_VOTE: 0.7
}));

vi.mock('../hooks/useIdentity', () => ({
  useIdentity: (...args: unknown[]) => mockUseIdentity(...args)
}));

interface ProposalCardStubProps {
  proposal: Proposal;
  canVote?: boolean;
  votedDirection?: 'for' | 'against';
}

vi.mock('./ProposalCard', () => ({
  __esModule: true,
  default: ({ proposal, canVote, votedDirection }: ProposalCardStubProps) => (
    <article
      data-testid={`proposal-card-${proposal.id}`}
      data-can-vote={String(canVote)}
      data-voted-direction={votedDirection ?? ''}
    >
      <h3>{proposal.title}</h3>
    </article>
  )
}));

const mockProposals: Proposal[] = [
  {
    id: 'proposal-1',
    title: 'Expand EV Charging Network',
    summary: 'Fund community-owned charging hubs in underserved areas.',
    author: '0xabc',
    fundingRequest: 1500,
    recipient: '0xrecipient1',
    votesFor: 12,
    votesAgainst: 3
  },
  {
    id: 'proposal-2',
    title: 'Civic Data Trust',
    summary: 'Create a public data trust for local governance metrics.',
    author: '0xdef',
    fundingRequest: 2300,
    recipient: '0xrecipient2',
    votesFor: 8,
    votesAgainst: 1
  }
];

function makeGovernanceMock(overrides: Record<string, unknown> = {}) {
  return {
    proposals: mockProposals,
    loading: false,
    error: null,
    submitVote: vi.fn(),
    lastAction: null,
    votedDirections: {},
    ...overrides
  };
}

function makeIdentityMock(overrides: Record<string, unknown> = {}) {
  return {
    identity: {
      session: {
        nullifier: 'voter-1',
        trustScore: 0.95,
        ...overrides
      }
    }
  };
}

describe('ProposalList', () => {
  beforeEach(() => {
    mockUseGovernance.mockReset();
    mockUseIdentity.mockReset();
    mockUseGovernance.mockReturnValue(makeGovernanceMock());
    mockUseIdentity.mockReturnValue(makeIdentityMock());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('PL-1: renders "Loading proposals..." when loading=true', () => {
    mockUseGovernance.mockReturnValue(makeGovernanceMock({ loading: true }));

    render(<ProposalList />);

    expect(screen.getByText('Loading proposals...')).toBeInTheDocument();
  });

  it('PL-2: renders error message when error is set', () => {
    mockUseGovernance.mockReturnValue(makeGovernanceMock({ error: 'Failed to load proposals' }));

    render(<ProposalList />);

    expect(screen.getByText('Failed to load proposals')).toBeInTheDocument();
  });

  it('PL-3: renders "No proposals yet." when proposals=[]', () => {
    mockUseGovernance.mockReturnValue(makeGovernanceMock({ proposals: [] }));

    render(<ProposalList />);

    expect(screen.getByText('No proposals yet.')).toBeInTheDocument();
  });

  it('PL-4: renders proposal cards with titles', () => {
    render(<ProposalList />);

    expect(screen.getByText('Expand EV Charging Network')).toBeInTheDocument();
    expect(screen.getByText('Civic Data Trust')).toBeInTheDocument();
  });

  it('PL-5: renders lastAction banner when lastAction is set', () => {
    mockUseGovernance.mockReturnValue(makeGovernanceMock({ lastAction: 'Vote recorded!' }));

    render(<ProposalList />);

    expect(screen.getByText('Vote recorded!')).toBeInTheDocument();
  });

  it('PL-6: does NOT render lastAction banner when null', () => {
    mockUseGovernance.mockReturnValue(makeGovernanceMock({ lastAction: null }));

    render(<ProposalList />);

    expect(screen.queryByText('Vote recorded!')).not.toBeInTheDocument();
  });

  it('PL-7: canVote=false when voterId is null (no identity)', () => {
    mockUseIdentity.mockReturnValue({ identity: null });

    render(<ProposalList />);

    expect(screen.getByTestId('proposal-card-proposal-1')).toHaveAttribute('data-can-vote', 'false');
  });

  it('PL-8: canVote=false when trustScore < MIN_TRUST_TO_VOTE', () => {
    mockUseIdentity.mockReturnValue(makeIdentityMock({ trustScore: undefined, scaledTrustScore: 6999 }));

    render(<ProposalList />);

    expect(screen.getByTestId('proposal-card-proposal-1')).toHaveAttribute('data-can-vote', 'false');
    expect(mockUseGovernance).toHaveBeenCalledWith('voter-1', 0.6999);
  });

  it('PL-9: canVote=true when voterId present and trustScore >= 0.7', () => {
    mockUseIdentity.mockReturnValue(makeIdentityMock({ trustScore: undefined, scaledTrustScore: 7000 }));

    render(<ProposalList />);

    expect(screen.getByTestId('proposal-card-proposal-1')).toHaveAttribute('data-can-vote', 'true');
    expect(mockUseGovernance).toHaveBeenCalledWith('voter-1', 0.7);
  });

  it('PL-10: useXpLedger.setActiveNullifier is NOT called on render', () => {
    const setActiveNullifierSpy = vi.spyOn(useXpLedger.getState(), 'setActiveNullifier');

    render(<ProposalList />);

    expect(setActiveNullifierSpy).not.toHaveBeenCalled();
  });

  it('PL-11: passes votedDirection to ProposalCard correctly', () => {
    mockUseGovernance.mockReturnValue(
      makeGovernanceMock({
        votedDirections: {
          'proposal-1': 'for',
          'proposal-2': 'against'
        }
      })
    );

    render(<ProposalList />);

    expect(screen.getByTestId('proposal-card-proposal-1')).toHaveAttribute('data-voted-direction', 'for');
    expect(screen.getByTestId('proposal-card-proposal-2')).toHaveAttribute('data-voted-direction', 'against');
  });
});
