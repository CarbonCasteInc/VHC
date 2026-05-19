/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardMocks = vi.hoisted(() => ({
  createIdentityRecord: vi.fn(),
  startLinkSession: vi.fn(),
  completeLinkSession: vi.fn(),
  analyze: vi.fn(),
  reset: vi.fn(),
  createProfile: vi.fn(),
  appState: {
    profile: { username: 'Alice' } as { username: string } | null,
    identityStatus: 'ready',
    client: {} as Record<string, unknown> | null,
    error: undefined as string | undefined,
  }
}));

vi.mock('@vh/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  )
}));

vi.mock('@vh/ai-engine', () => ({
  useAI: () => ({
    state: {
      status: 'idle',
      progress: 0,
      result: null,
      message: null
    },
    analyze: dashboardMocks.analyze,
    reset: dashboardMocks.reset
  })
}));

vi.mock('@vh/ai-engine/worker?worker', () => ({
  default: class MockWorker {}
}), { virtual: true });

vi.mock('../components/HandleEditor', () => ({
  HandleEditor: () => <div data-testid="handle-editor" />
}));

vi.mock('./AnalysisFeed', () => ({
  AnalysisFeed: () => <div data-testid="analysis-feed" />
}));

vi.mock('../store', () => ({
  useAppStore: () => ({
    profile: dashboardMocks.appState.profile,
    createIdentity: dashboardMocks.createProfile,
    identityStatus: dashboardMocks.appState.identityStatus,
    client: dashboardMocks.appState.client,
    error: dashboardMocks.appState.error
  })
}));

vi.mock('../hooks/useIdentity', () => ({
  useIdentity: () => ({
    identity: {
      session: {
        trustScore: 0.91,
        scaledTrustScore: 9100
      },
      linkedDevices: ['legacy-linked-device'],
      pendingLinkCode: 'legacy-link-code'
    },
    status: 'ready',
    createIdentity: dashboardMocks.createIdentityRecord,
    startLinkSession: dashboardMocks.startLinkSession,
    completeLinkSession: dashboardMocks.completeLinkSession
  })
}));

describe('DashboardContent multi-device deferral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardMocks.appState.profile = { username: 'Alice' };
    dashboardMocks.appState.identityStatus = 'ready';
    dashboardMocks.appState.client = {};
    dashboardMocks.appState.error = undefined;
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it('renders link-device as deferred without exposing fake link controls', async () => {
    const { DashboardContent } = await import('./dashboardContent');
    render(<DashboardContent />);

    expect(screen.getByTestId('linked-count')).toHaveTextContent('Device linking: deferred');
    expect(screen.getByTestId('link-device-btn')).toBeDisabled();
    expect(screen.getByTestId('link-device-btn')).toHaveTextContent('Link Device Deferred');
    expect(screen.getByTestId('link-device-deferred')).toHaveTextContent(
      'Multi-device identity linking is deferred to LUMA Phase 3+.'
    );

    expect(screen.queryByTestId('link-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('link-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('link-complete-btn')).not.toBeInTheDocument();
    expect(dashboardMocks.startLinkSession).not.toHaveBeenCalled();
    expect(dashboardMocks.completeLinkSession).not.toHaveBeenCalled();
  });

  it('keeps identity creation disabled until the mesh client is ready', async () => {
    dashboardMocks.appState.profile = null;
    dashboardMocks.appState.identityStatus = 'idle';
    dashboardMocks.appState.client = null;

    const { DashboardContent } = await import('./dashboardContent');
    render(<DashboardContent />);

    expect(screen.getByTestId('create-identity-btn')).toBeDisabled();
    expect(screen.getByTestId('create-identity-btn')).toHaveTextContent('Connecting');
  });
});
