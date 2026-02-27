import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryBundle } from '@vh/data-model';
import {
  getCachedSynthesisForStory,
  synthesizeStoryFromAnalysisPipeline,
  type NewsCardAnalysisSynthesis,
} from './newsCardAnalysis';
import {
  clearPendingMeshAnalysis,
  readPendingMeshAnalysis,
  readMeshAnalysis,
  upsertPendingMeshAnalysis,
  writeMeshAnalysis,
} from './useAnalysisMesh';
import {
  DEV_MODEL_CHANGED_EVENT,
  getDevModelOverride,
} from '../dev/DevModelPicker';

const ANALYSIS_TIMEOUT_MS = 60_000;
const ANALYSIS_PENDING_WAIT_WINDOW_MS = 35_000;
const ANALYSIS_PENDING_POLL_INTERVAL_MS = 1_500;
const ANALYSIS_BUDGET_KEY = 'vh_analysis_budget';
const DEFAULT_ANALYSIS_BUDGET_LIMIT = 20;
const RETRY_NOOP = (): void => {};

interface AnalysisBudgetState {
  readonly date: string;
  readonly count: number;
}

type AnalysisStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'timeout'
  | 'budget_exceeded';

export interface UseAnalysisResult {
  analysis: NewsCardAnalysisSynthesis | null;
  status: AnalysisStatus;
  error: string | null;
  retry: () => void;
}

let _pipelineBootLogged = false;

function isAnalysisPipelineEnabled(): boolean {
  const enabled = import.meta.env.VITE_VH_ANALYSIS_PIPELINE === 'true';
  if (!_pipelineBootLogged) {
    _pipelineBootLogged = true;
    console.info(`[vh:analysis:boot] pipeline=${enabled} VITE_VH_ANALYSIS_PIPELINE=${import.meta.env.VITE_VH_ANALYSIS_PIPELINE ?? 'undefined'}`);
  }
  return enabled;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getModelScopeKey(): string {
  const model = getDevModelOverride();
  return model ? `model:${model}` : 'model:default';
}

function getAnalysisBudgetLimit(): number {
  const rawLimit = import.meta.env.VITE_VH_ANALYSIS_DAILY_LIMIT;

  if (!rawLimit || rawLimit.trim().length === 0) {
    return DEFAULT_ANALYSIS_BUDGET_LIMIT;
  }

  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ANALYSIS_BUDGET_LIMIT;
  }

  return Math.max(0, Math.floor(parsed));
}

function readBudgetState(): AnalysisBudgetState {
  const today = todayIsoDate();
  const fallback: AnalysisBudgetState = { date: today, count: 0 };

  if (typeof globalThis.localStorage === 'undefined') {
    return fallback;
  }

  try {
    const raw = globalThis.localStorage.getItem(ANALYSIS_BUDGET_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<AnalysisBudgetState>;
    if (
      !parsed ||
      typeof parsed.date !== 'string' ||
      typeof parsed.count !== 'number' ||
      !Number.isFinite(parsed.count) ||
      parsed.count < 0
    ) {
      return fallback;
    }

    if (parsed.date !== today) {
      return fallback;
    }

    return {
      date: parsed.date,
      count: Math.floor(parsed.count),
    };
  } catch {
    return fallback;
  }
}

function writeBudgetState(next: AnalysisBudgetState): void {
  if (typeof globalThis.localStorage === 'undefined') {
    return;
  }

  try {
    globalThis.localStorage.setItem(ANALYSIS_BUDGET_KEY, JSON.stringify(next));
  } catch {
    // no-op when storage write is blocked
  }
}

export function canAnalyze(): boolean {
  const budgetLimit = getAnalysisBudgetLimit();
  if (budgetLimit === 0) {
    return true;
  }

  return readBudgetState().count < budgetLimit;
}

export function recordAnalysis(): void {
  const budgetLimit = getAnalysisBudgetLimit();
  if (budgetLimit === 0) {
    return;
  }

  const current = readBudgetState();
  writeBudgetState({
    date: current.date,
    count: current.count + 1,
  });
}

function toStoryCacheKey(story: StoryBundle | null, modelScopeKey: string): string | null {
  if (!story) {
    return null;
  }

  return `${story.story_id}:${story.provenance_hash}:${modelScopeKey}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Analysis pipeline unavailable.';
}

async function waitForPendingPeerAnalysis(
  story: StoryBundle,
  modelScopeKey: string,
  maxWaitMs: number,
): Promise<NewsCardAnalysisSynthesis | null> {
  if (maxWaitMs <= 0) {
    return null;
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const sleepMs = Math.min(
      ANALYSIS_PENDING_POLL_INTERVAL_MS,
      Math.max(0, deadline - Date.now()),
    );

    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, sleepMs);
    });

    const analysis = await readMeshAnalysis(story, modelScopeKey);
    if (analysis) {
      return analysis;
    }
  }

  return null;
}

export function useAnalysis(story: StoryBundle | null, enabled: boolean): UseAnalysisResult {
  const [analysis, setAnalysis] = useState<NewsCardAnalysisSynthesis | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [modelScopeKey, setModelScopeKey] = useState(getModelScopeKey);

  const pipelineEnabled = isAnalysisPipelineEnabled();

  useEffect(() => {
    const syncModelScope = () => {
      setModelScopeKey(getModelScopeKey());
    };

    syncModelScope();
    window.addEventListener(DEV_MODEL_CHANGED_EVENT, syncModelScope);
    window.addEventListener('storage', syncModelScope);

    return () => {
      window.removeEventListener(DEV_MODEL_CHANGED_EVENT, syncModelScope);
      window.removeEventListener('storage', syncModelScope);
    };
  }, []);

  const storyKey = useMemo(
    () => toStoryCacheKey(story, modelScopeKey),
    [story?.story_id, story?.provenance_hash, modelScopeKey],
  );
  const stableStory = useMemo(
    () => story,
    [storyKey],
  );

  const activeRequestId = useRef(0);
  const handledRetryToken = useRef(0);
  const successfulStoryKey = useRef<string | null>(null);

  useEffect(() => {
    successfulStoryKey.current = null;
    setAnalysis(null);
    setStatus('idle');
    setError(null);
  }, [storyKey]);

  const retry = useCallback(() => {
    successfulStoryKey.current = null;
    setError(null);
    setStatus('idle');
    setRetryToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!pipelineEnabled || !enabled || !stableStory || !storyKey) {
      return;
    }

    const isExplicitRetry = retryToken !== handledRetryToken.current;
    handledRetryToken.current = retryToken;

    if (!isExplicitRetry && successfulStoryKey.current === storyKey) {
      setStatus('success');
      return;
    }

    const cached = getCachedSynthesisForStory(stableStory);
    if (!isExplicitRetry && cached) {
      successfulStoryKey.current = storyKey;
      setAnalysis(cached);
      setStatus('success');
      setError(null);
      return;
    }

    setStatus('loading');
    setError(null);

    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;
    const requestStartedAt = Date.now();

    let timedOut = false;
    const timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      setStatus('timeout');
      setError('Analysis timed out. The server may be busy.');
    }, ANALYSIS_TIMEOUT_MS);

    void (async () => {
      const meshAnalysis = isExplicitRetry
        ? null
        : await readMeshAnalysis(stableStory, modelScopeKey);

      if (activeRequestId.current !== requestId || timedOut) {
        return;
      }

      if (meshAnalysis) {
        successfulStoryKey.current = storyKey;
        setAnalysis(meshAnalysis);
        setStatus('success');
        setError(null);
        return;
      }

      if (!canAnalyze()) {
        setStatus('budget_exceeded');
        setError('Daily analysis limit reached. Try again tomorrow.');
        return;
      }

      const pending = await readPendingMeshAnalysis(stableStory, modelScopeKey);
      if (activeRequestId.current !== requestId || timedOut) {
        return;
      }

      if (pending) {
        const remainingTimeoutBudget = Math.max(
          0,
          ANALYSIS_TIMEOUT_MS - (Date.now() - requestStartedAt) - 1_000,
        );
        const peerWaitBudget = Math.min(
          ANALYSIS_PENDING_WAIT_WINDOW_MS,
          Math.max(0, pending.expiresAt - Date.now()),
          remainingTimeoutBudget,
        );

        const peerResult = await waitForPendingPeerAnalysis(
          stableStory,
          modelScopeKey,
          peerWaitBudget,
        );

        if (activeRequestId.current !== requestId || timedOut) {
          return;
        }

        if (peerResult) {
          successfulStoryKey.current = storyKey;
          setAnalysis(peerResult);
          setStatus('success');
          setError(null);
          return;
        }
      }

      await upsertPendingMeshAnalysis(stableStory, modelScopeKey);

      try {
        recordAnalysis();
        const nextAnalysis = await synthesizeStoryFromAnalysisPipeline(stableStory);

        if (activeRequestId.current !== requestId || timedOut) {
          return;
        }

        successfulStoryKey.current = storyKey;
        setAnalysis(nextAnalysis);
        setStatus('success');
        setError(null);

        await writeMeshAnalysis(stableStory, nextAnalysis, modelScopeKey);
      } finally {
        await clearPendingMeshAnalysis(stableStory, modelScopeKey);
      }
    })()
      .catch((cause: unknown) => {
        if (activeRequestId.current !== requestId || timedOut) {
          return;
        }

        setStatus('error');
        setError(toErrorMessage(cause));
      })
      .finally(() => {
        globalThis.clearTimeout(timeoutId);
      });

    return () => {
      globalThis.clearTimeout(timeoutId);
      if (activeRequestId.current === requestId) {
        activeRequestId.current = requestId + 1;
      }
    };
  }, [enabled, modelScopeKey, pipelineEnabled, retryToken, stableStory, storyKey]);

  if (!pipelineEnabled) {
    return {
      analysis: null,
      status: 'idle',
      error: null,
      retry: RETRY_NOOP,
    };
  }

  return {
    analysis,
    status,
    error,
    retry,
  };
}
