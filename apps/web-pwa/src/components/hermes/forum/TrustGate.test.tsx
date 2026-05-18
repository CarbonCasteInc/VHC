/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { clearPublishedIdentity, publishIdentity } from '../../../store/identityProvider';
import { TrustGate } from './TrustGate';

const identityState = vi.hoisted(() => ({
  identity: null as null | { session: { trustScore: number } },
}));

vi.mock('../../../hooks/useIdentity', () => ({
  useIdentity: () => ({ identity: identityState.identity }),
}));

function publishTrustScore(trustScore: number): void {
  publishIdentity({
    session: {
      nullifier: `trust-gate-${trustScore}`,
      trustScore,
      scaledTrustScore: Math.round(trustScore * 10_000),
      expiresAt: 0,
    },
  });
}

describe('TrustGate', () => {
  beforeEach(() => {
    identityState.identity = null;
    clearPublishedIdentity();
  });

  afterEach(() => {
    cleanup();
    clearPublishedIdentity();
  });

  it('renders the fallback without a trusted identity', () => {
    render(
      <TrustGate>
        <button type="button">Reply</button>
      </TrustGate>,
    );

    expect(screen.getByTestId('trust-gate-msg')).toHaveTextContent('Verify identity');
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
  });

  it('renders children from the live identity hook', () => {
    identityState.identity = { session: { trustScore: 0.95 } };

    render(
      <TrustGate>
        <button type="button">Reply</button>
      </TrustGate>,
    );

    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
    expect(screen.queryByTestId('trust-gate-msg')).not.toBeInTheDocument();
  });

  it('renders children from the published identity while a new hook instance hydrates', () => {
    publishTrustScore(0.95);

    render(
      <TrustGate>
        <button type="button">Start discussion</button>
      </TrustGate>,
    );

    expect(screen.getByRole('button', { name: 'Start discussion' })).toBeInTheDocument();
    expect(screen.queryByTestId('trust-gate-msg')).not.toBeInTheDocument();
  });

  it('still blocks a low-trust published identity', () => {
    publishTrustScore(0.2);

    render(
      <TrustGate>
        <button type="button">Reply</button>
      </TrustGate>,
    );

    expect(screen.getByTestId('trust-gate-msg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
  });
});
