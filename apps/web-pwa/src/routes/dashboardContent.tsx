import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Button } from '@vh/ui';
import { useAI, type AnalysisResult } from '@vh/ai-engine';
import { useAppStore } from '../store';
import { useIdentity } from '../hooks/useIdentity';
import { getHandleError } from '../utils/handle';
import { HandleEditor } from '../components/HandleEditor';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

const WalletPanel = lazy(() => import('./WalletPanel').then((mod) => ({ default: mod.WalletPanel })));
const AnalysisFeed = lazy(() => import('./AnalysisFeed').then((mod) => ({ default: mod.AnalysisFeed })));

const E2E_MODE = (import.meta as any).env?.VITE_E2E_MODE === 'true';

export const DashboardContent: React.FC = () => {
  const { profile, createIdentity, identityStatus, client, error } = useAppStore();
  const {
    identity,
    status: identityRecordStatus,
    createIdentity: createIdentityRecord,
    startLinkSession,
    completeLinkSession
  } = useIdentity();
  const [username, setUsername] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [handleErrorMsg, setHandleErrorMsg] = useState<string | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [incomingCode, setIncomingCode] = useState('');
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
      const raw = safeGetItem('vh_analysis_history');
      return raw ? (JSON.parse(raw) as AnalysisResult[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (result) {
      setHistory((prev) => {
        const next = [result, ...prev].slice(0, 5);
        safeSetItem('vh_analysis_history', JSON.stringify(next));
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

  const handleStartLink = async () => {
    try {
      const code = await startLinkSession();
      setGeneratedCode(code);
      setLinkModalOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCompleteLink = async () => {
    try {
      await completeLinkSession(incomingCode.trim());
      setLinkModalOpen(false);
      setIncomingCode('');
    } catch (err) {
      console.error(err);
    }
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
              if (handleErrorMsg) return;
              void (async () => {
                const trimmedHandle = handleInput.trim();
                const validation = getHandleError(trimmedHandle);
                if (validation) {
                  setHandleErrorMsg(validation);
                  return;
                }
                await createIdentityRecord(trimmedHandle);
                await createIdentity(chosen);
              })();
            }}
          >
            <input
              className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={identityStatus === 'creating' || identityRecordStatus === 'creating'}
            />
            <input
              className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              placeholder="Choose a handle (letters, numbers, _)"
              value={handleInput}
              onChange={(e) => {
                setHandleInput(e.target.value);
                setHandleErrorMsg(getHandleError(e.target.value) ?? null);
              }}
              required
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]{3,20}"
              data-testid="handle-input"
              disabled={identityStatus === 'creating' || identityRecordStatus === 'creating'}
            />
            <Button
              type="submit"
              disabled={identityStatus === 'creating' || identityRecordStatus === 'creating' || Boolean(handleErrorMsg)}
              data-testid="create-identity-btn"
            >
              {identityStatus === 'creating' || identityRecordStatus === 'creating' ? 'Creating…' : 'Join'}
            </Button>
          </form>
          {handleErrorMsg && <span className="text-xs text-red-700">{handleErrorMsg}</span>}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      )}

      {profile && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">Connected to mesh</span>
            {identity?.session?.trustScore != null && identity.session.trustScore >= 0.7 && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700" data-testid="identity-badge">
                Verified
              </span>
            )}
            {identity?.session?.trustScore != null && identity.session.trustScore >= 0.5 && identity.session.trustScore < 0.7 && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700" data-testid="identity-badge">
                Attested
              </span>
            )}
            {identity?.session?.trustScore != null && identity.session.trustScore < 0.5 && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600" data-testid="identity-badge">
                Limited
              </span>
            )}
            <span className="text-slate-500" data-testid="welcome-msg">
              Welcome, {profile.username}
            </span>
            {identity?.session?.trustScore != null && (
              <span className="text-slate-500" data-testid="trust-score">
                Trust Score: {(identity.session.scaledTrustScore / 100).toFixed(1)}%
              </span>
            )}
            <span className="text-slate-500" data-testid="linked-count">
              Linked devices: {(identity?.linkedDevices ?? []).length}
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => console.log('bootstrap mesh')}>Bootstrap Mesh</Button>
            <Button variant="secondary" onClick={() => console.log('open settings')}>
              Open Settings
            </Button>
            <Button variant="ghost" onClick={handleStartLink} data-testid="link-device-btn">
              Link Device
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

          <HandleEditor />

          {linkModalOpen && (
            <div className="rounded-lg border border-slate-200 bg-card p-4 shadow-lg dark:border-slate-700">
              <p className="font-semibold text-slate-900">Link Device</p>
              <p className="text-sm text-slate-700">Share this link code with the device you want to link.</p>
              {generatedCode && (
                <div className="mt-2 rounded border border-dashed border-slate-300 bg-card-muted px-3 py-2 text-sm font-mono text-slate-800" data-testid="link-code">
                  {generatedCode}
                </div>
              )}
              <div className="mt-3 space-y-2">
                <label className="text-xs uppercase tracking-wide text-slate-500">Simulate incoming link</label>
                <div className="flex gap-2">
                  <input
                    className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                    placeholder="Paste code here"
                    value={incomingCode}
                    onChange={(e) => setIncomingCode(e.target.value)}
                    data-testid="link-input"
                  />
                  <Button onClick={handleCompleteLink} data-testid="link-complete-btn">
                    Complete
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
                <span>Linked devices: {(identity?.linkedDevices ?? []).length}</span>
                <Button variant="ghost" onClick={() => setLinkModalOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}

          <Suspense fallback={<div className="rounded-lg border border-slate-200 bg-card p-4 text-sm text-slate-700 dark:border-slate-700">Loading analyses…</div>}>
            <AnalysisFeed />
          </Suspense>
          <div className="rounded-lg border border-slate-200 bg-card p-4 shadow-sm dark:border-slate-700">
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span data-testid="current-status">Status: {status}</span>
              <span data-testid="current-progress">Progress: {progress}%</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600" data-testid="status-trail">
              {statusTrail.map((s, i) => (
                <span key={i} className="rounded bg-slate-100 px-2 py-1">{`Status: ${s}`}</span>
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
            <div className="rounded-2xl border border-slate-200/80 bg-card p-5 shadow-sm shadow-slate-900/5 dark:border-slate-700">
              <p className="font-semibold tracking-[0.04em] text-slate-900">Recent Analyses</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                {history.map((entry, idx) => (
                  <li key={idx} className="rounded-xl border border-slate-100 bg-card-muted p-2 dark:border-slate-700/70">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{entry.summary}</p>
                    <p className="text-slate-600 dark:text-slate-300">Biases: {entry.biases.join(' · ')}</p>
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

export const DashboardPage: React.FC = () => (
  <section className="space-y-4">
    <Suspense fallback={<div className="rounded-2xl border border-slate-200/80 bg-card p-5 text-sm text-slate-700 shadow-sm shadow-slate-900/5 dark:border-slate-700">Loading wallet…</div>}>
      <WalletPanel />
    </Suspense>
    <DashboardContent />
  </section>
);
