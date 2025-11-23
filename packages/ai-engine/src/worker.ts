import type { MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';
import { generateAnalysisPrompt, AnalysisResult } from './prompts';

let engine: MLCEngine | null = null;

async function ensureEngine(): Promise<MLCEngine> {
  if (engine) return engine;
  const { MLCEngine } = await import('@mlc-ai/web-llm');
  engine = new MLCEngine();
  engine.setInitProgressCallback((report: InitProgressReport) => {
    self.postMessage({ type: 'PROGRESS', payload: report } as WorkerResponse);
  });
  return engine;
}

export type WorkerMessage =
    | { type: "LOAD_MODEL"; payload: { modelId: string } }
    | { type: "GENERATE_ANALYSIS"; payload: { articleText: string; modelId?: string } };

export type WorkerResponse =
    | { type: "PROGRESS"; payload: InitProgressReport }
    | { type: "MODEL_LOADED" }
    | { type: "ANALYSIS_COMPLETE"; payload: AnalysisResult }
    | { type: "ERROR"; payload: string };

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data;

  try {
    if (type === 'LOAD_MODEL') {
      const { modelId } = payload;
      const loadedEngine = await ensureEngine();
      await loadedEngine.reload(modelId);
      self.postMessage({ type: 'MODEL_LOADED' } as WorkerResponse);
    } else if (type === 'GENERATE_ANALYSIS') {
      const loadedEngine = await ensureEngine();
      const { articleText } = payload;

      const prompt = generateAnalysisPrompt({ articleText });

      const completion = await loadedEngine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      const rawContent = completion.choices[0]?.message?.content || '';

      const firstOpen = rawContent.indexOf('{');
      const lastClose = rawContent.lastIndexOf('}');

      if (firstOpen === -1 || lastClose === -1 || lastClose < firstOpen) {
        throw new Error('No valid JSON object found in response');
      }

      const jsonString = rawContent.substring(firstOpen, lastClose + 1);

      let result: AnalysisResult;
      try {
        result = JSON.parse(jsonString) as AnalysisResult;
      } catch (parseError) {
        throw new Error(`Failed to parse JSON: ${(parseError as Error).message}`);
      }

      self.postMessage({ type: 'ANALYSIS_COMPLETE', payload: result } as WorkerResponse);
    }
  } catch (error) {
    self.postMessage({ type: 'ERROR', payload: (error as Error).message } as WorkerResponse);
  }
};
