import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryBundle } from '@vh/data-model';
import {
  getCachedSynthesisForStory,
  synthesizeStoryFromAnalysisPipeline,
  type NewsCardAnalysisSynthesis,
} from './newsCardAnalysis';
import {
  DEV_MODEL_CHANGED_EVENT,
  getDevModelOverride,
} from '../dev/DevModelPicker';

const ANALYSIS_TIMEOUT_MS = 30_000;
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

function isAnalysisPipelineEnabled(): boolean {
  return import.meta.env.VITE_VH_ANALYSIS_PIPELINE === 'true';
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

    if (!canAnalyze()) {
      setStatus('budget_exceeded');
      setError('Daily analysis limit reached. Try again tomorrow.');
      return;
    }

    recordAnalysis();
    setStatus('loading');
    setError(null);

    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;

    let timedOut = false;
    const timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      setStatus('timeout');
      setError('Analysis timed out. The server may be busy.');
    }, ANALYSIS_TIMEOUT_MS);

    void synthesizeStoryFromAnalysisPipeline(stableStory)
      .then((nextAnalysis) => {
        if (activeRequestId.current !== requestId || timedOut) {
          return;
        }

        successfulStoryKey.current = storyKey;
        setAnalysis(nextAnalysis);
        setStatus('success');
        setError(null);
      })
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
  }, [enabled, pipelineEnabled, retryToken, stableStory, storyKey]);

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
