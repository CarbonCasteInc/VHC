import { useEffect, useMemo, useState } from 'react';
import { deriveAnalysisKey, derivePointId } from '@vh/data-model';
import { DEV_MODEL_CHANGED_EVENT, getDevModelOverride } from '../dev/DevModelPicker';

const ANALYSIS_PIPELINE_VERSION = 'news-card-analysis-v1';

function getModelScopeKey(): string {
  const model = getDevModelOverride();
  return model ? `model:${model}` : 'model:default';
}

function parseAnalysisContext(analysisId?: string): { storyId: string; provenanceHash: string } | null {
  if (!analysisId) {
    return null;
  }

  const separatorIndex = analysisId.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= analysisId.length - 1) {
    return null;
  }

  return {
    storyId: analysisId.slice(0, separatorIndex),
    provenanceHash: analysisId.slice(separatorIndex + 1),
  };
}

export function pointMapKey(rowIndex: number, column: 'frame' | 'reframe'): string {
  return `${column}:${rowIndex}`;
}

interface UseBiasPointIdsParams {
  readonly frames: ReadonlyArray<{ frame: string; reframe: string }>;
  readonly analysisId?: string;
  readonly topicId?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  readonly votingEnabled?: boolean;
}

export function useBiasPointIds({
  frames,
  analysisId,
  topicId,
  synthesisId,
  epoch,
  votingEnabled,
}: UseBiasPointIdsParams): Record<string, string> {
  const [modelScopeKey, setModelScopeKey] = useState(getModelScopeKey);
  const [pointIds, setPointIds] = useState<Record<string, string>>({});

  const analysisContext = useMemo(
    () => parseAnalysisContext(analysisId),
    [analysisId],
  );
  const shouldDerivePointIds = !!(
    votingEnabled &&
    topicId &&
    synthesisId &&
    epoch !== undefined &&
    analysisContext
  );

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

  useEffect(() => {
    let cancelled = false;

    if (!shouldDerivePointIds || !analysisContext) {
      setPointIds({});
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const analysisKey = await deriveAnalysisKey({
        story_id: analysisContext.storyId,
        provenance_hash: analysisContext.provenanceHash,
        pipeline_version: ANALYSIS_PIPELINE_VERSION,
        model_scope: modelScopeKey,
      });

      const nextPointIds: Record<string, string> = {};
      for (let rowIndex = 0; rowIndex < frames.length; rowIndex += 1) {
        const row = frames[rowIndex]!;
        const [framePointId, reframePointId] = await Promise.all([
          derivePointId({ analysisKey, column: 'frame', text: row.frame }),
          derivePointId({ analysisKey, column: 'reframe', text: row.reframe }),
        ]);

        nextPointIds[pointMapKey(rowIndex, 'frame')] = framePointId;
        nextPointIds[pointMapKey(rowIndex, 'reframe')] = reframePointId;
      }

      if (!cancelled) {
        setPointIds(nextPointIds);
      }
    })().catch((error) => {
      if (!cancelled) {
        console.warn('[vh:bias-table] failed to derive point IDs', error);
        setPointIds({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [analysisContext, frames, modelScopeKey, shouldDerivePointIds]);

  return pointIds;
}
