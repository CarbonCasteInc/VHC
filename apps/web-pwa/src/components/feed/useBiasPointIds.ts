import { useEffect, useMemo, useState } from 'react';
import { deriveAnalysisKey, derivePointId, deriveSynthesisPointId } from '@vh/data-model';
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
  readonly frames: ReadonlyArray<{
    frame_point_id?: string;
    frame: string;
    reframe_point_id?: string;
    reframe: string;
  }>;
  readonly analysisId?: string;
  readonly topicId?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  readonly votingEnabled?: boolean;
}

export interface UseBiasPointIdsResult {
  readonly legacyPointIds: Record<string, string>;
  readonly synthesisPointIds: Record<string, string>;
}

export function useBiasPointIds({
  frames,
  analysisId,
  topicId,
  synthesisId,
  epoch,
  votingEnabled,
}: UseBiasPointIdsParams): UseBiasPointIdsResult {
  const [modelScopeKey, setModelScopeKey] = useState(getModelScopeKey);
  const [legacyPointIds, setLegacyPointIds] = useState<Record<string, string>>({});
  const [synthesisPointIds, setSynthesisPointIds] = useState<Record<string, string>>({});

  const analysisContext = useMemo(
    () => parseAnalysisContext(analysisId),
    [analysisId],
  );

  const shouldDeriveLegacyIds = !!(votingEnabled && analysisContext);

  const shouldDeriveSynthesisIds = !!(
    votingEnabled &&
    topicId &&
    synthesisId &&
    epoch !== undefined
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

    if (!shouldDeriveLegacyIds && !shouldDeriveSynthesisIds) {
      setLegacyPointIds({});
      setSynthesisPointIds({});
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const [legacyResult, synthesisResult] = await Promise.allSettled([
        (async () => {
          if (!shouldDeriveLegacyIds || !analysisContext) {
            return {} as Record<string, string>;
          }

          const analysisKey = await deriveAnalysisKey({
            story_id: analysisContext.storyId,
            provenance_hash: analysisContext.provenanceHash,
            pipeline_version: ANALYSIS_PIPELINE_VERSION,
            model_scope: modelScopeKey,
          });

          const nextLegacyPointIds: Record<string, string> = {};
          for (let rowIndex = 0; rowIndex < frames.length; rowIndex += 1) {
            const row = frames[rowIndex]!;
            const [framePointId, reframePointId] = await Promise.all([
              derivePointId({ analysisKey, column: 'frame', text: row.frame }),
              derivePointId({ analysisKey, column: 'reframe', text: row.reframe }),
            ]);

            nextLegacyPointIds[pointMapKey(rowIndex, 'frame')] = framePointId;
            nextLegacyPointIds[pointMapKey(rowIndex, 'reframe')] = reframePointId;
          }

          return nextLegacyPointIds;
        })(),
        (async () => {
          if (!shouldDeriveSynthesisIds) {
            return {} as Record<string, string>;
          }

          const nextSynthesisPointIds: Record<string, string> = {};
          for (let rowIndex = 0; rowIndex < frames.length; rowIndex += 1) {
            const row = frames[rowIndex]!;
            const [framePointId, reframePointId] = await Promise.all([
              row.frame_point_id
                ? Promise.resolve(row.frame_point_id)
                : deriveSynthesisPointId({
                    topic_id: topicId!,
                    synthesis_id: synthesisId!,
                    epoch: epoch!,
                    column: 'frame',
                    text: row.frame,
                  }),
              row.reframe_point_id
                ? Promise.resolve(row.reframe_point_id)
                : deriveSynthesisPointId({
                    topic_id: topicId!,
                    synthesis_id: synthesisId!,
                    epoch: epoch!,
                    column: 'reframe',
                    text: row.reframe,
                  }),
            ]);

            nextSynthesisPointIds[pointMapKey(rowIndex, 'frame')] = framePointId;
            nextSynthesisPointIds[pointMapKey(rowIndex, 'reframe')] = reframePointId;
          }

          return nextSynthesisPointIds;
        })(),
      ]);

      if (cancelled) {
        return;
      }

      if (legacyResult.status === 'fulfilled') {
        setLegacyPointIds(legacyResult.value);
      } else {
        console.warn('[vh:bias-table] failed to derive legacy point IDs', legacyResult.reason);
        setLegacyPointIds({});
      }

      if (synthesisResult.status === 'fulfilled') {
        setSynthesisPointIds(synthesisResult.value);
      } else {
        console.warn('[vh:bias-table] failed to derive synthesis point IDs', synthesisResult.reason);
        setSynthesisPointIds({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    analysisContext,
    epoch,
    frames,
    modelScopeKey,
    shouldDeriveLegacyIds,
    shouldDeriveSynthesisIds,
    synthesisId,
    topicId,
  ]);

  return { legacyPointIds, synthesisPointIds };
}
