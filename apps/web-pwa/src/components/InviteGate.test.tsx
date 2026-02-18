/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InviteGate } from './InviteGate';

// Mock invite store
vi.mock('../store/invite', () => ({
  isInviteOnlyEnabled: vi.fn(() => true),
  hasInviteAccess: vi.fn(() => false),
  grantInviteAccess: vi.fn(),
  validateInviteToken: vi.fn(() => ({ valid: false, reason: 'Token not found' })),
  redeemInviteToken: vi.fn(() => ({ valid: false, reason: 'Token not found' })),
  appendAuditEntry: vi.fn(),
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  recordAttempt: vi.fn(),
}));

const invite = vi.mocked(await import('../store/invite'));

beforeEach(() => {
  vi.clearAllMocks();
  invite.isInviteOnlyEnabled.mockReturnValue(true);
  invite.hasInviteAccess.mockReturnValue(false);
  invite.checkRateLimit.mockReturnValue({ allowed: true });
  invite.redeemInviteToken.mockReturnValue({ valid: false, reason: 'Token not found' });
});

afterEach(() => {
  cleanup();
});

describe('InviteGate', () => {
  it('renders children when gate is disabled via env', () => {
    invite.isInviteOnlyEnabled.mockReturnValue(false);
    render(<InviteGate><div data-testid="app">App</div></InviteGate>);
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('invite-gate')).toBeNull();
  });

  it('renders children when _forceAccess is true', () => {
    render(<InviteGate _forceAccess><div data-testid="app">App</div></InviteGate>);
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('invite-gate')).toBeNull();
  });

  it('renders children when _forceEnabled is false', () => {
    render(<InviteGate _forceEnabled={false}><div data-testid="app">App</div></InviteGate>);
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('renders children when localStorage has granted access', () => {
    invite.hasInviteAccess.mockReturnValue(true);
    render(<InviteGate><div data-testid="app">App</div></InviteGate>);
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('invite-gate')).toBeNull();
  });

  it('shows gate when enabled and no access', () => {
    render(<InviteGate><div data-testid="app">App</div></InviteGate>);
    expect(screen.getByTestId('invite-gate')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('shows gate when _forceEnabled overrides disabled env', () => {
    invite.isInviteOnlyEnabled.mockReturnValue(false);
    render(<InviteGate _forceEnabled><div data-testid="app">App</div></InviteGate>);
    expect(screen.getByTestId('invite-gate')).toBeTruthy();
  });

  it('submit button disabled on empty input', () => {
    render(<InviteGate><div>App</div></InviteGate>);
    const btn = screen.getByTestId('invite-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('grants access on valid token redemption', () => {
    invite.redeemInviteToken.mockReturnValue({ valid: true, token: {} as any });

    render(<InviteGate><div data-testid="app">App</div></InviteGate>);
    fireEvent.change(screen.getByTestId('invite-code-input'), { target: { value: 'good-code' } });
    fireEvent.click(screen.getByTestId('invite-submit'));

    expect(invite.redeemInviteToken).toHaveBeenCalledWith('good-code', 'web-user');
    expect(invite.grantInviteAccess).toHaveBeenCalled();
    expect(invite.appendAuditEntry).toHaveBeenCalledWith('invite_redeemed', { token: 'good-code' });
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('shows error on invalid token', () => {
    invite.redeemInviteToken.mockReturnValue({ valid: false, reason: 'Token not found' });

    render(<InviteGate><div data-testid="app">App</div></InviteGate>);
    fireEvent.change(screen.getByTestId('invite-code-input'), { target: { value: 'bad-code' } });
    fireEvent.click(screen.getByTestId('invite-submit'));

    expect(screen.getByTestId('invite-error').textContent).toBe('Token not found');
    expect(invite.appendAuditEntry).toHaveBeenCalledWith('invite_validation_failed', {
      token: 'bad-code',
      reason: 'Token not found',
    });
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('shows error on expired token', () => {
    invite.redeemInviteToken.mockReturnValue({ valid: false, reason: 'Token expired' });

    render(<InviteGate><div data-testid="app">App</div></InviteGate>);
    fireEvent.change(screen.getByTestId('invite-code-input'), { target: { value: 'old-code' } });
    fireEvent.click(screen.getByTestId('invite-submit'));

    expect(screen.getByTestId('invite-error').textContent).toBe('Token expired');
  });

  it('enforces rate limiting', () => {
    invite.checkRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 60000 });

    render(<InviteGate><div>App</div></InviteGate>);
    fireEvent.change(screen.getByTestId('invite-code-input'), { target: { value: 'code' } });
    fireEvent.click(screen.getByTestId('invite-submit'));

    expect(screen.getByTestId('invite-error').textContent).toContain('Too many attempts');
    expect(invite.redeemInviteToken).not.toHaveBeenCalled();
  });

  it('trims whitespace from input', () => {
    invite.redeemInviteToken.mockReturnValue({ valid: true, token: {} as any });

    render(<InviteGate><div data-testid="app">App</div></InviteGate>);
    fireEvent.change(screen.getByTestId('invite-code-input'), { target: { value: '  trimmed  ' } });
    fireEvent.click(screen.getByTestId('invite-submit'));

    expect(invite.redeemInviteToken).toHaveBeenCalledWith('trimmed', 'web-user');
  });

  it('uses default reason when redeemInviteToken returns no reason', () => {
    invite.redeemInviteToken.mockReturnValue({ valid: false });

    render(<InviteGate><div>App</div></InviteGate>);
    fireEvent.change(screen.getByTestId('invite-code-input'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('invite-submit'));

    expect(screen.getByTestId('invite-error').textContent).toBe('Invalid invite code.');
  });
});
