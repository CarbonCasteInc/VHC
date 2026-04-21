import { useEffect, useState } from 'react';
import { deriveSynthesisPointId } from '@vh/data-model';

export interface SynthesisPerspectiveInput {
  readonly id: string;
  readonly frame_point_id?: string;
  readonly frame: string;
  readonly reframe_point_id?: string;
  readonly reframe: string;
}

interface UseSynthesisPointIdsParams {
  readonly topicId?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  readonly perspectives: ReadonlyArray<SynthesisPerspectiveInput>;
  readonly enabled?: boolean;
}

export function perspectivePointMapKey(
  perspectiveId: string,
  column: 'frame' | 'reframe',
): string {
  return `${perspectiveId}:${column}`;
}

export function useSynthesisPointIds({
  topicId,
  synthesisId,
  epoch,
  perspectives,
  enabled = true,
}: UseSynthesisPointIdsParams): Record<string, string> {
  const [pointIds, setPointIds] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !topicId || !synthesisId || epoch === undefined) {
      setPointIds({});
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const nextPointIds: Record<string, string> = {};

      for (const perspective of perspectives) {
        const [framePointId, reframePointId] = await Promise.all([
          perspective.frame_point_id
            ? Promise.resolve(perspective.frame_point_id)
            : deriveSynthesisPointId({
                topic_id: topicId,
                synthesis_id: synthesisId,
                epoch,
                column: 'frame',
                text: perspective.frame,
              }),
          perspective.reframe_point_id
            ? Promise.resolve(perspective.reframe_point_id)
            : deriveSynthesisPointId({
                topic_id: topicId,
                synthesis_id: synthesisId,
                epoch,
                column: 'reframe',
                text: perspective.reframe,
              }),
        ]);

        nextPointIds[perspectivePointMapKey(perspective.id, 'frame')] = framePointId;
        nextPointIds[perspectivePointMapKey(perspective.id, 'reframe')] = reframePointId;
      }

      if (!cancelled) {
        setPointIds(nextPointIds);
      }
    })().catch((error) => {
      if (!cancelled) {
        console.warn('[vh:analysis-view] failed to derive synthesis point IDs', error);
        setPointIds({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, epoch, perspectives, synthesisId, topicId]);

  return pointIds;
}
