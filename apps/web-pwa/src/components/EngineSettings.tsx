import React from 'react';
import { useRemoteEngineOptIn } from '../hooks/useRemoteEngineOptIn';

function readRemoteEngineUrl(): string {
  const viteValue = (import.meta as any).env?.VITE_REMOTE_ENGINE_URL;
  const nodeValue = typeof process !== 'undefined' ? process.env?.VITE_REMOTE_ENGINE_URL : undefined;
  const value = viteValue ?? nodeValue;

  return typeof value === 'string' ? value.trim() : '';
}

export const EngineSettings: React.FC = () => {
  const { optedIn, setOptIn } = useRemoteEngineOptIn();

  if (!readRemoteEngineUrl()) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-card-muted px-3 py-3 dark:border-slate-700/70 space-y-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">Engine Settings</p>
      <p className="text-xs text-slate-600" data-testid="engine-status-text">
        {optedIn ? 'On-device first, remote fallback' : 'On-device only'}
      </p>
      <label className="flex items-start gap-2 text-xs text-slate-600" htmlFor="remote-engine-opt-in">
        <input
          id="remote-engine-opt-in"
          type="checkbox"
          checked={optedIn}
          onChange={(event) => setOptIn(event.target.checked)}
          data-testid="remote-engine-toggle"
        />
        <span>
          Allow remote AI fallback when on-device AI is unavailable. Article text will be sent to a remote AI
          server.
        </span>
      </label>
    </div>
  );
};
