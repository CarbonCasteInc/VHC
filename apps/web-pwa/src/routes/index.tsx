import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import React, { useEffect, useState } from 'react';
import { Button } from '@vh/ui';
import { useAI, type AnalysisResult } from '@vh/ai-engine';
import { useAppStore } from '../store';

const E2E_MODE = (import.meta as any).env?.VITE_E2E_MODE === 'true';

const RootComponent = () => (
  <RootShell>
    <Outlet />
  </RootShell>
);

const RootShell = ({ children }: { children: React.ReactNode }) => {
  const { client, initializing, init } = useAppStore();

  useEffect(() => {
    void init();
  }, [init]);

  const peersCount = client?.config.peers.length ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">TRINITY · VENN/HERMES</p>
            <h1 className="text-3xl font-semibold text-slate-900">Hello Trinity</h1>
            <p className="text-slate-600">Local-first nervous system online.</p>
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>Peers: {peersCount}</p>
          </div>
        </header>
        <main className="space-y-6">
          {initializing && !client ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-700">Loading Mesh…</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
};

const HomeComponent = () => {
  const { profile, createIdentity, identityStatus, client, error } = useAppStore();
  const [username, setUsername] = useState('');
  const [workerFactory, setWorkerFactory] = useState<(() => Worker) | undefined>();
  const {
    state: { status, progress, result, message },
    analyze,
    reset
  } = useAI({
    workerFactory
  });
  const [statusTrail, setStatusTrail] = useState<string[]>(() => ['idle']);

  useEffect(() => {
    if (E2E_MODE) {
      // In E2E we rely on the mock worker in useAI to avoid heavy model downloads.
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@vh/ai-engine/worker?worker');
        if (!cancelled) {
          const WorkerCtor = (mod as any).default as { new(): Worker };
          setWorkerFactory(() => () => new WorkerCtor());
        }
      } catch (err) {
        console.warn('[vh:web-pwa] AI worker unavailable, using mock fallback', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [history, setHistory] = useState<AnalysisResult[]>(() => {
    try {
      const raw = localStorage.getItem('vh_analysis_history');
      return raw ? (JSON.parse(raw) as AnalysisResult[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (result) {
      setHistory((prev) => {
        const next = [result, ...prev].slice(0, 5);
        localStorage.setItem('vh_analysis_history', JSON.stringify(next));
        return next;
      });
    }
  }, [result]);

  useEffect(() => {
    setStatusTrail((prev) => {
      if (prev[prev.length - 1] === status) return prev;
      return [...prev, status].slice(-5);
    });
  }, [status]);

  const handleAnalyze = () => {
    const demo = `A local-first stack powers civic analysis. The system processes text on-device to surface bias and provide balanced counterpoints.`;
    if (!profile) return;
    analyze(demo);
  };

  return (
    <section className="space-y-4">
      <p className="text-lg text-slate-700">Your Guardian Node stack is live. Next: hydrate the graph and start composing signals.</p>

      {!profile && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-slate-800">
          <p className="font-semibold">Welcome to TRINITY</p>
          <p className="text-sm text-amber-800">No identity found. Create a local identity to join the mesh.</p>
          <form
            className="mt-3 flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const chosen = username.trim() || 'vh-user';
              void createIdentity(chosen);
            }}
          >
            <input
              className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={identityStatus === 'creating'}
            />
            <Button
              type="submit"
              onClick={() => { }}
              disabled={identityStatus === 'creating'}
              data-testid="create-identity-btn"
            >
              {identityStatus === 'creating' ? 'Creating…' : 'Join'}
            </Button>
          </form>
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      )}

      {profile && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">Connected to mesh</span>
            <span className="text-slate-500">Identity: {profile.username}</span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => console.log('bootstrap mesh')}>Bootstrap Mesh</Button>
            <Button variant="secondary" onClick={() => console.log('open settings')}>
              Open Settings
            </Button>
            <Button
              variant="ghost"
              onClick={handleAnalyze}
              disabled={!client || status === 'generating' || status === 'loading'}
              data-testid="analyze-btn"
            >
              {status === 'generating' || status === 'loading' ? 'Analyzing…' : 'Analyze demo'}
            </Button>
            {status !== 'idle' && (
              <Button variant="ghost" onClick={reset}>
                Reset
              </Button>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span data-testid="current-status">Status: {status}</span>
              <span data-testid="current-progress">Progress: {progress}%</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600" data-testid="status-trail">
              {statusTrail.map((s) => (
                <span key={s} className="rounded bg-slate-100 px-2 py-1">{`Status: ${s}`}</span>
              ))}
            </div>
            {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
            {result && (
              <div className="mt-4 space-y-2">
                <p className="font-semibold text-slate-900">Summary</p>
                <p className="text-sm text-slate-700">{result.summary}</p>
                <p className="font-semibold text-slate-900">Biases</p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
                  {result.biases.map((bias, idx) => (
                    <li key={idx}>
                      <span className="font-medium text-slate-900">{bias}</span>
                      {result.counterpoints[idx] && (
                        <span className="text-slate-600"> · Counterpoint: {result.counterpoints[idx]}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">Recent Analyses</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {history.map((entry, idx) => (
                  <li key={idx} className="rounded border border-slate-100 bg-slate-50 p-2">
                    <p className="font-medium text-slate-900">{entry.summary}</p>
                    <p className="text-slate-600">Biases: {entry.biases.join(' · ')}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const rootRoute = createRootRoute({ component: RootComponent });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomeComponent });

export const routeTree = rootRoute.addChildren([indexRoute]);
