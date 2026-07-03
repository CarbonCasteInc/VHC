/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountIdentityPage } from './AccountIdentityPage';

const identityMock = vi.hoisted(() => ({
  state: {
    identity: null as any,
    status: 'anonymous' as any,
    error: undefined as string | undefined,
    createIdentity: vi.fn(),
    signOut: vi.fn(),
    resetIdentity: vi.fn(),
  },
}));

const walletMock = vi.hoisted(() => ({
  state: {
    account: null as string | null,
    walletBinding: null as any,
    connect: vi.fn(),
    loading: false,
  },
}));

const telemetryMock = vi.hoisted(() => ({
  state: {
    events: [] as any[],
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock('@vh/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('../hooks/useIdentity', () => ({
  useIdentity: () => identityMock.state,
}));

vi.mock('../hooks/useWallet', () => ({
  useWallet: () => walletMock.state,
}));

vi.mock('../hooks/useTelemetry', () => ({
  useTelemetry: () => telemetryMock.state,
}));

function readyIdentity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'identity-record',
    createdAt: Date.parse('2026-07-01T11:00:00Z'),
    attestation: { platform: 'web', integrityToken: 'token', deviceKey: 'device', nonce: 'nonce' },
    assuranceEnvelope: { verifierId: 'beta-local' },
    session: {
      token: 'secret-session-token',
      trustScore: 0.5,
      scaledTrustScore: 5000,
      nullifier: 'secret-principal-nullifier',
      createdAt: Date.parse('2026-07-01T11:00:00Z'),
      expiresAt: Date.parse('2099-07-10T11:00:00Z'),
    },
    handle: 'alice',
    ...overrides,
  };
}

describe('AccountIdentityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.state.identity = readyIdentity();
    identityMock.state.status = 'ready';
    identityMock.state.error = undefined;
    identityMock.state.createIdentity.mockResolvedValue(undefined);
    identityMock.state.signOut.mockResolvedValue(undefined);
    identityMock.state.resetIdentity.mockResolvedValue(undefined);
    walletMock.state.account = null;
    walletMock.state.walletBinding = null;
    walletMock.state.loading = false;
    telemetryMock.state.events = [
      { type: 'luma_session_created', level: 'info', ts_ms: 1000, message: 'created' },
      { type: 'luma_policy_blocked', level: 'warn', ts_ms: 2000, message: 'blocked' },
    ];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders identity controls without exposing raw principal, token, or numeric trust score', () => {
    render(<AccountIdentityPage />);

    expect(screen.getByTestId('identity-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    expect(screen.getByText('Beta-local identity on this device')).toBeInTheDocument();
    expect(screen.getByText('Verifier')).toBeInTheDocument();
    expect(screen.getByText('beta-local')).toBeInTheDocument();
    expect(screen.getByTestId('identity-session-expiry')).toHaveTextContent('2099-07-10 11:00 UTC');
    expect(screen.getByTestId('identity-telemetry-debug')).toHaveTextContent('luma_policy_blocked');

    expect(screen.queryByText(/secret-principal-nullifier/)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret-session-token/)).not.toBeInTheDocument();
    expect(screen.queryByText(/trust score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/50\.0/)).not.toBeInTheDocument();
  });

  it('shows the near-expiry warning without blocking controls', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T11:00:00Z'));
    identityMock.state.identity = readyIdentity({
      session: {
        ...readyIdentity().session,
        expiresAt: Date.parse('2026-07-04T06:00:00Z'),
      },
    });

    render(<AccountIdentityPage />);

    expect(screen.getByText(/Your session expires soon/)).toBeInTheDocument();
    expect(screen.getByTestId('identity-sign-out')).toBeEnabled();
    expect(screen.getByTestId('identity-reset')).toBeEnabled();
  });

  it('confirms Sign Out and preserves the copy boundary', async () => {
    render(<AccountIdentityPage />);

    fireEvent.click(screen.getByTestId('identity-sign-out'));
    const dialog = screen.getByRole('dialog', { name: 'Sign out of this device?' });

    expect(dialog).toHaveTextContent('Signing out ends your current session.');
    expect(dialog).toHaveTextContent('Your published posts and votes are unaffected.');
    expect(dialog).not.toHaveTextContent(/removes your data/i);

    fireEvent.click(within(dialog).getByTestId('identity-sign-out-confirm'));

    await waitFor(() => expect(identityMock.state.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText(/Signed out/).length).toBeGreaterThanOrEqual(1));
  });

  it('requires the typed Reset confirmation before resetIdentity runs', async () => {
    render(<AccountIdentityPage />);

    fireEvent.click(screen.getByTestId('identity-reset'));
    const dialog = screen.getByRole('dialog', { name: 'Reset your identity on this device?' });
    const confirm = within(dialog).getByTestId('identity-reset-confirm');

    expect(dialog).toHaveTextContent('Resetting creates a new pseudonym and stops using the current one.');
    expect(dialog).toHaveTextContent('Resetting does not remove them and cannot make them yours again.');
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Type reset to confirm'), { target: { value: 'reset' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(identityMock.state.resetIdentity).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText(/previous pseudonym's public history remains/).length).toBeGreaterThanOrEqual(1));
  });

  it('surfaces the wallet re-bind prompt for a binding on the previous identity', () => {
    walletMock.state.account = '0x1111111111111111111111111111111111111111';
    walletMock.state.walletBinding = {
      boundPrincipalNullifier: 'previous-principal-nullifier',
      address: walletMock.state.account,
    };

    render(<AccountIdentityPage />);

    expect(screen.getByTestId('identity-wallet-rebind')).toHaveTextContent(
      'This wallet was bound to your previous identity. Re-bind it to your current identity to continue.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Re-bind wallet' }));
    expect(walletMock.state.connect).toHaveBeenCalledTimes(1);
  });

  it('renders the create-identity call to action for a device without an active session', () => {
    identityMock.state.identity = null;
    identityMock.state.status = 'anonymous';

    render(<AccountIdentityPage />);

    expect(screen.getByText('No active session on this device.')).toBeInTheDocument();
    expect(screen.queryByTestId('identity-sign-out')).not.toBeInTheDocument();
    expect(screen.queryByTestId('identity-reset')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('identity-create'));
    expect(identityMock.state.createIdentity).toHaveBeenCalledTimes(1);
  });
});
