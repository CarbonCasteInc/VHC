import React, { useEffect, useState } from 'react';
import { useHealthStore, startHealthMonitor } from '../../hooks/useHealthMonitor';

function statusColor(mode: string): string {
  switch (mode) {
    case 'none':
      return 'bg-green-500';
    case 'mesh-degraded':
      return 'bg-yellow-500';
    case 'relay-unavailable':
      return 'bg-orange-500';
    case 'disconnected':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

function statusLabel(mode: string): string {
  switch (mode) {
    case 'none':
      return 'Healthy';
    case 'mesh-degraded':
      return 'Mesh Degraded';
    case 'relay-unavailable':
      return 'Relay Unavailable';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Unknown';
  }
}

export const HealthIndicator: React.FC = () => {
  const [expanded, setExpanded] = useState(false);

  const gunPeerState = useHealthStore((s) => s.gunPeerState);
  const meshWriteAckRate = useHealthStore((s) => s.meshWriteAckRate);
  const meshWriteAckSamples = useHealthStore((s) => s.meshWriteAckSamples);
  const analysisRelayAvailable = useHealthStore((s) => s.analysisRelayAvailable);
  const convergenceLagP95Ms = useHealthStore((s) => s.convergenceLagP95Ms);
  const degradationMode = useHealthStore((s) => s.degradationMode);
  const lastHealthCheck = useHealthStore((s) => s.lastHealthCheck);

  useEffect(() => {
    const stop = startHealthMonitor();
    return stop;
  }, []);

  return (
    <div
      className="fixed bottom-2 left-2 z-50"
      data-testid="health-indicator"
    >
      <button
        type="button"
        className={`h-3 w-3 rounded-full ${statusColor(degradationMode)} border border-white/50 shadow-sm`}
        onClick={() => setExpanded((v) => !v)}
        aria-label={`Health: ${statusLabel(degradationMode)}`}
        title={statusLabel(degradationMode)}
        data-testid="health-indicator-dot"
      />

      {expanded && (
        <div
          className="absolute bottom-5 left-0 w-64 rounded border border-slate-300 bg-white p-2 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-800"
          data-testid="health-indicator-panel"
        >
          <div className="mb-1 font-semibold">
            {statusLabel(degradationMode)}
          </div>
          <table className="w-full text-left">
            <tbody>
              <tr>
                <td className="pr-2 text-slate-500">Gun peer</td>
                <td>{gunPeerState}</td>
              </tr>
              <tr>
                <td className="pr-2 text-slate-500">Mesh write ack</td>
                <td>{(meshWriteAckRate * 100).toFixed(1)}% ({meshWriteAckSamples} samples)</td>
              </tr>
              <tr>
                <td className="pr-2 text-slate-500">Analysis relay</td>
                <td>{analysisRelayAvailable ? 'available' : 'unavailable'}</td>
              </tr>
              <tr>
                <td className="pr-2 text-slate-500">Convergence p95</td>
                <td>{convergenceLagP95Ms !== null ? `${convergenceLagP95Ms}ms` : 'n/a'}</td>
              </tr>
              <tr>
                <td className="pr-2 text-slate-500">Last check</td>
                <td>{lastHealthCheck ? new Date(lastHealthCheck).toLocaleTimeString() : 'n/a'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default HealthIndicator;
