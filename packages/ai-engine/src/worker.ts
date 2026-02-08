import { createDefaultEngine } from './engines';
import { createAnalysisPipeline } from './pipeline';
import type { AnalysisResult } from './schema';

const runPipeline = createAnalysisPipeline(createDefaultEngine());

export type WorkerMessage =
  | { type: 'ANALYZE'; payload: { articleText: string; urlHash: string } };

export type WorkerResponse =
  | { type: 'SUCCESS'; payload: { analysis: AnalysisResult; engine: string; warnings: string[] } }
  | { type: 'ERROR'; payload: { message: string } };

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;

  if (type === 'ANALYZE') {
    try {
      const result = await runPipeline(payload.articleText);
      self.postMessage({
        id,
        type: 'SUCCESS',
        payload: {
          analysis: result.analysis,
          engine: result.engine.id,
          warnings: result.warnings
        }
      });
    } catch (err) {
      self.postMessage({
        id,
        type: 'ERROR',
        payload: { message: (err as Error).message }
      });
    }
  }
};
