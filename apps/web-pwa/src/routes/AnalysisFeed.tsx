import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@vh/ui';
import {
  getOrGenerate,
  hashUrl,
  type CanonicalAnalysis,
  type GenerateResult
} from '../../../../packages/ai-engine/src/analysis';
import { createRemoteEngine } from '../../../../packages/ai-engine/src/engines';
import { createAnalysisPipeline } from '../../../../packages/ai-engine/src/pipeline';
import type { VennClient } from '@vh/gun-client';
import { AnalysisFeedCard } from '../components/AnalysisFeedCard';
import { EngineSettings } from '../components/EngineSettings';
import { useRemoteEngineOptIn } from '../hooks/useRemoteEngineOptIn';
import { useAppStore } from '../store';
import { useIdentity } from '../hooks/useIdentity';
import { useXpLedger } from '../store/xpLedger';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
import { logAnalysisMeshWrite } from '../utils/analysisTelemetry';

export const ANALYSIS_FEED_STORAGE_KEY = 'vh_canonical_analyses';

interface FeedStore {
  data: CanonicalAnalysis[];
  save: (items: CanonicalAnalysis[]) => void;
}

export function createBudgetDeniedResult(reason: string): { analysis: null; notice: string } {
  return { analysis: null, notice: reason };
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

const ANALYSIS_MESH_PUT_ACK_TIMEOUT_MS = 1000;

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
      const startedAt = Date.now();
      return new Promise<void>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          logAnalysisMeshWrite({
            source: 'analysis-feed',
            event: 'mesh_write_timeout',
            url_hash: record.urlHash,
            latency_ms: Math.max(0, Date.now() - startedAt),
          });
          resolve();
        }, ANALYSIS_MESH_PUT_ACK_TIMEOUT_MS);

        analyses.get(record.urlHash).put(record, (ack?: { err?: string }) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (ack?.err) {
            logAnalysisMeshWrite({
              source: 'analysis-feed',
              event: 'mesh_write_failed',
              url_hash: record.urlHash,
              error: ack.err,
              latency_ms: Math.max(0, Date.now() - startedAt),
            });
            resolve();
            return;
          }

          logAnalysisMeshWrite({
            source: 'analysis-feed',
            event: 'mesh_write_success',
            url_hash: record.urlHash,
            latency_ms: Math.max(0, Date.now() - startedAt),
          });
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
  const isRunningRef = useRef(false);
  const isSharingRef = useRef(false);
  const { client } = useAppStore();
  const { identity } = useIdentity();
  const { optedIn } = useRemoteEngineOptIn();

  const store = useMemo(() => loadFeed(), []);
  const gunStore = useMemo(() => createGunStore(client), [client]);
  const pipeline = useMemo(() => {
    if (optedIn) {
      const remoteEngine = createRemoteEngine();
      if (remoteEngine) {
        return createAnalysisPipeline({ policy: 'local-first', remoteEngine });
      }
    }

    return createAnalysisPipeline();
  }, [optedIn]);

  const sortedFeed = useMemo(
    () => [...feed].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    [feed]
  );

  const runAnalysis = useCallback(
    async (targetUrl: string): Promise<{ analysis: CanonicalAnalysis | null; notice?: string }> => {
      if (isRunningRef.current) return { analysis: null };
      isRunningRef.current = true;
      setBusy(true);

      try {
        const generate = async (articleText: string): Promise<GenerateResult> => {
          const result = await pipeline(articleText);
          return {
            analysis: result.analysis,
            engine: result.engine,
            warnings: result.warnings
          };
        };

        let reusedFromMesh = false;

        const analysisStore = {
          async getByHash(hash: string) {
            const local = await getFromFeed(hash, feed);
            if (local) {
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

        const topicId = await hashUrl(targetUrl);
        const nullifier = identity?.session?.nullifier;
        if (nullifier) {
          const xpLedger = useXpLedger.getState();
          xpLedger.setActiveNullifier(nullifier);
          const budgetCheck = xpLedger.canPerformAction('analyses/day', 1, topicId);
          if (!budgetCheck.allowed) {
            const reason = budgetCheck.reason || 'Daily limit reached for analyses/day';
            console.warn('[vh:analysis] Budget denied:', reason);
            setMessage(reason);
            return createBudgetDeniedResult(reason);
          }
        }

        const result = await getOrGenerate(targetUrl, analysisStore, generate);
        if (!result.reused && nullifier && result.analysis) {
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

        return { analysis: result.analysis, notice };
      } finally {
        isRunningRef.current = false;
        setBusy(false);
      }
    },
    [feed, gunStore, identity, pipeline, store]
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
      if (analysis) {
        setMessage(notice ?? `Analysis ready for ${analysis.url}`);
        setUrl('');
      } else {
        setMessage(notice ?? 'Analysis unavailable');
      }
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(false);
    }
  };

  const handleShare = useCallback(
    async (item: CanonicalAnalysis) => {
      if (isSharingRef.current) return;
      isSharingRef.current = true;

      const shareText = `${item.summary}\n${item.url}`;
      const topicId = item.urlHash;

      // Budget check (only when identity is present)
      const nullifier = identity?.session?.nullifier;
      if (nullifier) {
        const xpLedger = useXpLedger.getState();
        xpLedger.setActiveNullifier(nullifier);
        const budgetCheck = xpLedger.canPerformAction('shares/day', 1, topicId);
        if (!budgetCheck.allowed) {
          const reason = budgetCheck.reason || 'Daily share limit reached';
          setMessage(reason);
          isSharingRef.current = false;
          return;
        }
      }

      // Attempt share
      try {
        if (navigator.share) {
          await navigator.share({
            title: item.summary,
            text: item.summary,
            url: item.url,
          });
          if (nullifier) {
            useXpLedger.getState().consumeAction('shares/day', 1, topicId);
          }
          setMessage('Shared!');
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareText);
          if (nullifier) {
            useXpLedger.getState().consumeAction('shares/day', 1, topicId);
          }
          setMessage('Link copied!');
        } else {
          setMessage('Unable to share');
          isSharingRef.current = false;
          return;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User cancelled share sheet — silent no-op
          return;
        }
        console.warn('[vh:share]', err);
        setMessage('Unable to share');
      } finally {
        isSharingRef.current = false;
      }
    },
    [identity]
  );

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-card p-5 shadow-sm shadow-slate-900/5 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.08em] text-slate-900 uppercase">Canonical Analysis</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">On-device by default · WebLLM · First-to-File</p>
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

      <EngineSettings />

      <div className="grid gap-3">
        {sortedFeed.length === 0 && <p className="text-sm text-slate-600">No analyses yet.</p>}
        {sortedFeed.map((item) => (
          <AnalysisFeedCard key={item.urlHash} item={item} onShare={handleShare} />
        ))}
      </div>
    </div>
  );
};
