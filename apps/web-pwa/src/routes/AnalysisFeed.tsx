import React, { useCallback, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@vh/ui';
import type { AnalysisResult } from '../../../../packages/ai-engine/src/prompts';
import { getOrGenerate, hashUrl, type CanonicalAnalysis } from '../../../../packages/ai-engine/src/analysis';
import type { VennClient } from '@vh/gun-client';
import { useAppStore } from '../store';
import { useIdentity } from '../hooks/useIdentity';
import { useXpLedger } from '../store/xpLedger';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

export const ANALYSIS_FEED_STORAGE_KEY = 'vh_canonical_analyses';

interface FeedStore {
  data: CanonicalAnalysis[];
  save: (items: CanonicalAnalysis[]) => void;
}

function loadFeed(): FeedStore {
  try {
    const raw = safeGetItem(ANALYSIS_FEED_STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as CanonicalAnalysis[]) : [];
    return {
      data,
      save(items: CanonicalAnalysis[]) {
        safeSetItem(ANALYSIS_FEED_STORAGE_KEY, JSON.stringify(items));
      }
    };
  } catch {
    return {
      data: [],
      save: () => {}
    };
  }
}

async function getFromFeed(urlHash: string, feed: CanonicalAnalysis[]) {
  const existing = feed.find((item) => item.urlHash === urlHash);
  return existing ?? null;
}

function createGunStore(client: VennClient | null) {
  const mesh = (client as any)?.mesh ?? (client as any)?.gun ?? null;
  if (!mesh?.get) return null;
  const analyses = mesh.get('analyses');
  if (!analyses?.get) return null;
  return {
    async getByHash(urlHash: string) {
      return new Promise<CanonicalAnalysis | null>((resolve) => {
        analyses.get(urlHash).once((data?: CanonicalAnalysis) => {
          resolve((data as CanonicalAnalysis | null) ?? null);
        });
      });
    },
    async save(record: CanonicalAnalysis) {
      return new Promise<void>((resolve, reject) => {
        analyses.get(record.urlHash).put(record, (ack?: { err?: string }) => {
          if (ack?.err) {
            reject(new Error(ack.err));
            return;
          }
          resolve();
        });
      });
    }
  };
}

export const AnalysisFeed: React.FC = () => {
  const [url, setUrl] = useState('');
  const [feed, setFeed] = useState<CanonicalAnalysis[]>(() => loadFeed().data);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { client } = useAppStore();
  const { identity } = useIdentity();

  const store = useMemo(() => loadFeed(), []);
  const gunStore = useMemo(() => createGunStore(client), [client]);

  const sortedFeed = useMemo(
    () => [...feed].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    [feed]
  );

  const runAnalysis = useCallback(
    async (targetUrl: string): Promise<{ analysis: CanonicalAnalysis; notice?: string }> => {
      setBusy(true);
      return new Promise<{ analysis: CanonicalAnalysis; notice?: string }>((resolve, reject) => {
        const generate = async (): Promise<AnalysisResult> =>
          new Promise((res) =>
            setTimeout(
              () =>
                res({
                  summary: `Local analysis for ${targetUrl}`,
                  biases: ['Local-first'],
                  counterpoints: ['None'],
                  bias_claim_quote: [],
                  justify_bias_claim: [],
                  confidence: 0.6
                }),
              80
            )
          );

        let reusedFromMesh = false;
        let reusedFromLocal = false;

        const analysisStore = {
          async getByHash(hash: string) {
            const local = await getFromFeed(hash, feed);
            if (local) {
              reusedFromLocal = true;
              return local;
            }
            if (gunStore) {
              const meshRecord = await gunStore.getByHash(hash);
              if (meshRecord) {
                reusedFromMesh = true;
                return meshRecord;
              }
            }
            return null;
          },
          async save(record: CanonicalAnalysis) {
            const next = [record, ...feed];
            setFeed(next);
            store.save(next);
            if (gunStore) {
              await gunStore.save(record);
            }
          },
          async listRecent() {
            return feed;
          }
        };

        void analysisStore.listRecent();

        const topicId = hashUrl(targetUrl);
        const nullifier = identity?.session?.nullifier;
        if (nullifier) {
          const xpLedger = useXpLedger.getState();
          xpLedger.setActiveNullifier(nullifier);
          const budgetCheck = xpLedger.canPerformAction('analyses/day', 1, topicId);
          if (!budgetCheck.allowed) {
            const reason = budgetCheck.reason ?? 'Daily limit reached for analyses/day';
            setMessage(reason);
            setBusy(false);
            resolve({ analysis: {} as CanonicalAnalysis, notice: reason });
            return;
          }
        }

        void getOrGenerate(targetUrl, analysisStore, generate)
          .then((result) => {
            if (!result.reused && nullifier) {
              useXpLedger.getState().consumeAction('analyses/day', 1, topicId);
            }
            let notice: string | undefined;
            if (result.reused && reusedFromMesh) {
              notice = 'Analysis fetched from mesh.';
              const alreadyInFeed = feed.some((item) => item.urlHash === result.analysis.urlHash);
              if (!alreadyInFeed) {
                const next = [result.analysis, ...feed];
                setFeed(next);
                store.save(next);
              }
            } else if (result.reused) {
              notice = 'Analysis already exists. Showing cached result.';
            } else if (!gunStore) {
              notice = 'Analysis stored locally only.';
            } else if (!identity) {
              notice = 'Analysis stored locally; connect identity to sync.';
            }
            resolve({ analysis: result.analysis, notice });
          })
          .catch((error) => reject(error))
          .finally(() => setBusy(false));
      });
    },
    [feed, gunStore, identity, store]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const targetUrl = url.trim();
    if (!targetUrl) {
      setMessage('Enter a valid URL');
      return;
    }
    try {
      const { analysis, notice } = await runAnalysis(targetUrl);
      setMessage(notice ?? `Analysis ready for ${analysis.url}`);
      setUrl('');
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-card p-5 shadow-sm shadow-slate-900/5 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.08em] text-slate-900 uppercase">Canonical Analysis</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">Local-first · WebLLM · First-to-File</p>
        </div>
        {message && <span className="text-xs text-slate-700 dark:text-slate-200">{message}</span>}
      </div>

      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
        <input
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-card"
          placeholder="Paste URL to analyze"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          data-testid="analysis-url-input"
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Analyzing…' : 'Analyze'}
        </Button>
      </form>

      <div className="grid gap-3">
        {sortedFeed.length === 0 && <p className="text-sm text-slate-600">No analyses yet.</p>}
        {sortedFeed.map((item) => (
          <div key={item.urlHash} className="rounded-xl border border-slate-100 bg-card-muted p-3 space-y-1 dark:border-slate-700/70">
            <p className="text-xs uppercase tracking-wide text-slate-500">{new Date(item.timestamp).toLocaleString()}</p>
            <p className="text-sm font-semibold text-slate-900">{item.url}</p>
            <p className="text-sm text-slate-700">{item.summary}</p>
            <p className="text-xs text-slate-600">Biases: {item.biases.join(' · ')}</p>
            <div className="mt-2 flex justify-end">
              <Link
                to="/hermes"
                search={{ sourceAnalysisId: item.urlHash, title: item.summary, sourceUrl: item.url }}
                className="text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
              >
                Discuss in Forum →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
