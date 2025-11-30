/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletPanel } from './WalletPanel';
import '@testing-library/jest-dom/vitest';

const lastOnClickRef = vi.hoisted(() => ({ handler: null as any }));
const connect = vi.fn();
const refresh = vi.fn();
const claimUBE = vi.fn();

const mockUseWallet = vi.fn();

const identityMock = vi.hoisted(() => ({ identity: null as any, status: 'anonymous' }));
const xpState = vi.hoisted(() => ({
  tracks: { civic: 0, social: 0, project: 0 },
  totalXP: 0,
  claimDailyBoost: vi.fn(() => 0)
}));

vi.mock('../hooks/useWallet', () => ({
  useWallet: (...args: unknown[]) => mockUseWallet(...args)
}));

vi.mock('../hooks/useIdentity', () => ({
  useIdentity: () => identityMock
}));

vi.mock('../hooks/useXpLedger', () => ({
  useXpLedger: (() => {
    const useXpLedgerMock = () => xpState;
    (useXpLedgerMock as any).getState = () => xpState;
    return useXpLedgerMock;
  })()
}));

vi.mock('@vh/ui', () => ({
  Button: (props: any) => {
    lastOnClickRef.handler = props.onClick;
    return <button {...props} />;
  }
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
  localStorage.clear();
  lastOnClickRef.handler = null;
  identityMock.identity = null;
  identityMock.status = 'anonymous';
  xpState.tracks = { civic: 0, social: 0, project: 0 };
  xpState.totalXP = 0;
  xpState.claimDailyBoost = vi.fn(() => 0);
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

    const boostElements = screen.getAllByText('Daily Boost');
    const claimButton = boostElements.find((el) => el.tagName === 'BUTTON');
    expect(claimButton).not.toBeDisabled();
    fireEvent.click(claimButton!);
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
    const claimBtn = screen.getByRole('button', { name: /Come back tomorrow|Daily Boost/ });
    expect(claimBtn).toBeDisabled();
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

  it('shows identity trust when available and displays local mock mint', async () => {
    identityMock.identity = {
      id: 'id',
      createdAt: Date.now(),
      attestation: { platform: 'web', integrityToken: 't', deviceKey: 'd', nonce: 'n' },
      session: { token: 'tok', trustScore: 0.9, scaledTrustScore: 9000, nullifier: 'n' }
    };
    identityMock.status = 'ready';
    xpState.claimDailyBoost = vi.fn(() => 10);

    render(<WalletPanel />);

    expect(screen.getByText('90.0%')).toBeInTheDocument();

    const claimBtn = screen.getByRole('button', { name: /Daily Boost/ });
    fireEvent.click(claimBtn);

    await Promise.resolve();
    expect(screen.getByText(/\(\+10 mock\)/)).toBeInTheDocument();
    expect(xpState.claimDailyBoost).toHaveBeenCalledWith(0.9);
    expect(localStorage.getItem('vh_local_boost_next')).not.toBeNull();
    expect(claimUBE).not.toHaveBeenCalled();
  });

  it('applies stored local cooldown even when identity is eligible', async () => {
    const future = Math.floor(Date.now() / 1000) + 60;
    localStorage.setItem('vh_local_boost_next', String(future));
    identityMock.identity = {
      id: 'id',
      createdAt: Date.now(),
      attestation: { platform: 'web', integrityToken: 't', deviceKey: 'd', nonce: 'n' },
      session: { token: 'tok', trustScore: 0.9, scaledTrustScore: 9000, nullifier: 'n' }
    };
    identityMock.status = 'ready';

    render(<WalletPanel />);
    await Promise.resolve();

    const claimBtn = screen.getByRole('button', { name: /Come back tomorrow|Daily Boost/ });
    expect(claimBtn).toBeDisabled();
    expect(claimBtn).toHaveTextContent('Come back tomorrow');
  });

  it('short-circuits claim handler when locally ineligible', async () => {
    identityMock.identity = {
      id: 'id',
      createdAt: Date.now(),
      attestation: { platform: 'web', integrityToken: 't', deviceKey: 'd', nonce: 'n' },
      session: { token: 'tok', trustScore: 0.4, scaledTrustScore: 4000, nullifier: 'n' }
    };
    identityMock.status = 'ready';

    render(<WalletPanel />);
    const claimBtn = screen.getByRole('button', { name: /Come back tomorrow|Daily Boost/ });
    expect(claimBtn).toBeDisabled();
    lastOnClickRef.handler?.({ preventDefault() {}, stopPropagation() {} });
    await Promise.resolve();

    expect(xpState.claimDailyBoost).not.toHaveBeenCalled();
    expect(claimUBE).not.toHaveBeenCalled();
    expect(localStorage.getItem('vh_local_boost_next')).toBeNull();
  });

  it('uses scaled trustScore fallback and skips local mint when on-chain eligible', async () => {
    identityMock.identity = {
      id: 'id',
      createdAt: Date.now(),
      attestation: { platform: 'web', integrityToken: 't', deviceKey: 'd', nonce: 'n' },
      session: { token: 'tok', trustScore: undefined as unknown as number, scaledTrustScore: 9600, nullifier: 'n' }
    };
    identityMock.status = 'ready';
    xpState.claimDailyBoost = vi.fn(() => 12);
    setupWalletState({
      account: '0x1234',
      claimStatus: { eligible: true, nextClaimAt: 0, trustScore: 9200, expiresAt: 0, nullifier: '0x' }
    });

    render(<WalletPanel />);
    const claimBtn = screen.getByRole('button', { name: /Daily Boost/ });
    fireEvent.click(claimBtn);
    await Promise.resolve();

    expect(claimUBE).toHaveBeenCalled();
    expect(xpState.claimDailyBoost).toHaveBeenCalledWith(0.96);
    expect(screen.queryByText(/\(\+12 mock\)/)).not.toBeInTheDocument();
  });
});
