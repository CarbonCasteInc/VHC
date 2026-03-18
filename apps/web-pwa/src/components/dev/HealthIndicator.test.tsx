/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthIndicator } from './HealthIndicator';

const state = {
  gunPeerState: 'connected',
  meshWriteAckRate: 1,
  meshWriteAckSamples: 0,
  analysisRelayAvailable: true,
  convergenceLagP95Ms: null,
  degradationMode: 'none',
  lastHealthCheck: null,
};

vi.mock('../../hooks/useHealthMonitor', () => ({
  useHealthStore: (selector: (current: typeof state) => unknown) => selector(state),
  startHealthMonitor: () => () => undefined,
}));

describe('HealthIndicator', () => {
  afterEach(() => {
    cleanup();
    state.gunPeerState = 'connected';
    state.meshWriteAckRate = 1;
    state.meshWriteAckSamples = 0;
    state.analysisRelayAvailable = true;
    state.convergenceLagP95Ms = null;
    state.degradationMode = 'none';
    state.lastHealthCheck = null;
  });

  it('shows the healthy label when no degradation is active', () => {
    render(<HealthIndicator />);
    expect(screen.getByLabelText('Health: Healthy')).toBeInTheDocument();
  });

  it('labels analysis relay outages explicitly', () => {
    state.analysisRelayAvailable = false;
    state.degradationMode = 'relay-unavailable';

    render(<HealthIndicator />);
    expect(screen.getByLabelText('Health: Analysis Relay Unavailable')).toBeInTheDocument();
  });
});
