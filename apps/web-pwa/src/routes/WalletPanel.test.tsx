/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletPanel } from './WalletPanel';
import '@testing-library/jest-dom/vitest';

const connect = vi.fn();
const refresh = vi.fn();
const claimUBE = vi.fn();

const mockUseWallet = vi.fn();

vi.mock('../hooks/useWallet', () => ({
  useWallet: (...args: unknown[]) => mockUseWallet(...args)
}));

function setupWalletState(state: Partial<ReturnType<typeof mockUseWallet>>) {
  mockUseWallet.mockReturnValue({
    account: null,
    formattedBalance: null,
    claimStatus: null,
    loading: false,
    claiming: false,
    error: null,
    connect,
    refresh,
    claimUBE,
    ...state
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  vi.clearAllMocks();
  setupWalletState({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WalletPanel', () => {
  it('renders disconnected state and triggers connect', () => {
    render(<WalletPanel />);
    expect(screen.getByText(/Wallet not connected/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Connect Wallet'));
    expect(connect).toHaveBeenCalled();
  });

  it('shows balances and allows claiming when eligible', () => {
    setupWalletState({
      account: '0x1234567890abcdef',
      formattedBalance: '42.5',
      claimStatus: { eligible: true, nextClaimAt: 0, trustScore: 9200, expiresAt: 0, nullifier: '0x' }
    });

    render(<WalletPanel />);

    expect(screen.getByText(/42\.5 RVU/)).toBeInTheDocument();
    expect(screen.getByText('92.0%')).toBeInTheDocument();

    const refreshButton = screen.getByText('Refresh');
    fireEvent.click(refreshButton);
    expect(refresh).toHaveBeenCalled();

    const claimButton = screen.getAllByText('Claim UBE')[0];
    expect(claimButton).not.toBeDisabled();
    fireEvent.click(claimButton);
    expect(claimUBE).toHaveBeenCalled();
  });

  it('disables claim when cooldown is active and shows timing', () => {
    const nextClaim = Math.floor(Date.now() / 1000) + 3600;
    setupWalletState({
      account: '0x1234',
      claimStatus: { eligible: false, nextClaimAt: nextClaim, trustScore: 8000, expiresAt: nextClaim + 1000, nullifier: '0x' }
    });

    render(<WalletPanel />);

    expect(screen.getByText(/in 1h/)).toBeInTheDocument();
    expect(screen.getByText('Claim UBE')).toBeDisabled();
  });

  it('shows loading state and surfaces errors', () => {
    setupWalletState({
      account: '0x1234',
      loading: true,
      error: 'oops'
    });

    render(<WalletPanel />);

    expect(screen.getByText('Refreshing…')).toBeDisabled();
    expect(screen.getByText('oops')).toBeInTheDocument();
  });

  it('disables claim while claiming is in progress', () => {
    setupWalletState({
      account: '0x1234',
      claiming: true,
      claimStatus: { eligible: true, nextClaimAt: 0, trustScore: 9000, expiresAt: 0, nullifier: '0x' }
    });

    render(<WalletPanel />);
    expect(screen.getByText('Claiming…')).toBeDisabled();
  });

  it('renders pending attestation and long cooldown labels', () => {
    setupWalletState({
      account: '0x9999',
      claimStatus: { eligible: false, nextClaimAt: 0, trustScore: 7000, expiresAt: 0, nullifier: '0x' }
    });

    render(<WalletPanel />);
    expect(screen.getByText('Pending attestation')).toBeInTheDocument();
  });

  it('shows long wait and ready states based on timestamps', () => {
    const longWait = Math.floor(Date.now() / 1000) + 3 * 60 * 60;
    setupWalletState({
      account: '0x9999',
      claimStatus: { eligible: false, nextClaimAt: longWait, trustScore: 7000, expiresAt: longWait + 100, nullifier: '0x' }
    });
    render(<WalletPanel />);
    expect(screen.getByText(/in 3h/)).toBeInTheDocument();
    cleanup();

    const pastClaim = Math.floor(Date.now() / 1000) - 60;
    setupWalletState({
      account: '0x9999',
      claimStatus: { eligible: false, nextClaimAt: pastClaim, trustScore: 7000, expiresAt: pastClaim + 100, nullifier: '0x' }
    });
    render(<WalletPanel />);
    expect(screen.getByText('Ready to claim')).toBeInTheDocument();
    cleanup();

    const shortWait = Math.floor(Date.now() / 1000) + 30 * 60;
    setupWalletState({
      account: '0x9999',
      claimStatus: { eligible: false, nextClaimAt: shortWait, trustScore: 7000, expiresAt: shortWait + 100, nullifier: '0x' }
    });
    render(<WalletPanel />);
    expect(screen.getByText(/in 30m/)).toBeInTheDocument();
  });
});
