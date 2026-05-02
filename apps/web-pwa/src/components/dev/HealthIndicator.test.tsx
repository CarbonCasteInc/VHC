/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthIndicator } from './HealthIndicator';

const state = {
  gunPeerState: 'connected',
  meshWriteAckRate: null as number | null,
  meshWriteAckSamples: 0,
  analysisRelayAvailable: true,
  convergenceLagP95Ms: null,
  degradationMode: 'none',
  degradationReasons: [] as readonly string[],
  lastHealthCheck: null,
};

vi.mock('../../hooks/useHealthMonitor', () => ({
  useHealthStore: (selector: (current: typeof state) => unknown) => selector(state),
}));

describe('HealthIndicator', () => {
  afterEach(() => {
    cleanup();
    state.gunPeerState = 'connected';
    state.meshWriteAckRate = null;
    state.meshWriteAckSamples = 0;
    state.analysisRelayAvailable = true;
    state.convergenceLagP95Ms = null;
    state.degradationMode = 'none';
    state.degradationReasons = [];
    state.lastHealthCheck = null;
  });

  it('shows the healthy label when no degradation is active', () => {
    render(<HealthIndicator />);
    expect(screen.getByLabelText('Health: Healthy')).toBeInTheDocument();
  });

  it('labels analysis relay outages explicitly', () => {
    state.analysisRelayAvailable = false;
    state.degradationMode = 'relay-unavailable';
    state.degradationReasons = ['analysis-relay-unavailable'];

    render(<HealthIndicator />);
    expect(screen.getByLabelText('Health: Analysis Relay Unavailable')).toBeInTheDocument();
  });

  it('shows unknown ack rate until enough samples exist and renders degradation reasons', async () => {
    state.gunPeerState = 'degraded';
    state.degradationMode = 'mesh-degraded';
    state.degradationReasons = ['probe-ack-timeout', 'message-rate-high'];

    render(<HealthIndicator />);
    fireEvent.click(screen.getByLabelText('Health: Mesh Degraded'));

    expect(screen.getByText('unknown (0 samples)')).toBeInTheDocument();
    expect(screen.getByText('Probe ack timeout, Gun message rate high')).toBeInTheDocument();
  });
});
