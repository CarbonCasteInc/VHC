import { useEffect, useRef, useState } from 'react';
import {
  getNewsRemovalChain,
  parseRemovalEntry,
  type RemovalEntry,
  type VennClient,
} from '@vh/gun-client';
import { resolveClientFromAppStore } from '../../store/clientResolver';

export interface StoryRemovalState {
  readonly isRemoved: boolean;
  readonly removalReason: string | null;
  readonly removalEntry: RemovalEntry | null;
}

const DEFAULT_STATE: StoryRemovalState = {
  isRemoved: false,
  removalReason: null,
  removalEntry: null,
};

function isAnalysisPipelineEnabled(): boolean {
  try {
    return (import.meta as any).env?.VITE_VH_ANALYSIS_PIPELINE === 'true';
  /* v8 ignore next 3 -- non-Vite runtime guard */
  } catch {
    return false;
  }
}

export interface UseStoryRemovalOptions {
  readonly resolveClient?: () => VennClient | null;
  readonly isEnabled?: () => boolean;
}

/**
 * React hook that reads removal status from Gun mesh at `vh/news/removed/{urlHash}`.
 * Feature-flag gated: returns default (not-removed) state when pipeline is disabled.
 * Subscribes via Gun `.on()` for live updates when available.
 */
export function useStoryRemoval(
  urlHash: string | undefined,
  options?: UseStoryRemovalOptions,
): StoryRemovalState {
  const [state, setState] = useState<StoryRemovalState>(DEFAULT_STATE);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const opts = optionsRef.current;
    const enabled = opts?.isEnabled ? opts.isEnabled() : isAnalysisPipelineEnabled();
    if (!enabled || !urlHash?.trim()) {
      setState(DEFAULT_STATE);
      return;
    }

    const resolve = opts?.resolveClient ?? resolveClientFromAppStore;
    const client = resolve();
    if (!client) {
      setState(DEFAULT_STATE);
      return;
    }

    const chain = getNewsRemovalChain(client, urlHash);
    let cancelled = false;

    const applyData = (data: unknown) => {
      if (cancelled) return;
      const entry = parseRemovalEntry(data);
      setState(
        entry
          ? { isRemoved: true, removalReason: entry.reason, removalEntry: entry }
          : DEFAULT_STATE,
      );
    };

    // Initial read via once()
    chain.once(applyData);

    // Subscribe to live updates if .on() is available
    if (chain.on) chain.on(applyData);

    return () => {
      cancelled = true;
      if (chain.off) chain.off(applyData);
    };
  }, [urlHash]);

  return state;
}
