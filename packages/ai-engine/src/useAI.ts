import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from './schema';

type Status = 'idle' | 'loading' | 'generating' | 'complete' | 'error';

export interface AIState {
  status: Status;
  modelId: string;
  progress: number;
  message?: string;
  result?: AnalysisResult;
  rawOutput?: string;
  error?: string;
}

type WorkerMessage =
  | { type: 'ready'; modelId: string }
  | { type: 'progress'; progress: number; message?: string }
  | { type: 'result'; result: AnalysisResult; raw: string }
  | { type: 'error'; error: string };

type WorkerPayload =
  | { type: 'LOAD_MODEL'; modelId: string }
  | { type: 'GENERATE_ANALYSIS'; text: string; previousPass?: AnalysisResult };

export interface UseAIOptions {
  modelId?: string;
  workerFactory?: () => Worker;
}

const DEFAULT_MODEL_ID = 'Llama-3-8B-Instruct-q4f16_1-MLC';

class MockWorker implements Worker {
  onmessage: ((this: Worker, ev: MessageEvent<WorkerMessage>) => any) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => any) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null;

  postMessage(message: WorkerPayload) {
    if (message.type === 'LOAD_MODEL') {
      setTimeout(() => {
        this.onmessage?.call(this as unknown as Worker, { data: { type: 'progress', progress: 25, message: 'Mock load...' } } as MessageEvent<WorkerMessage>);
      }, 20);
      setTimeout(() => {
        this.onmessage?.call(this as unknown as Worker, { data: { type: 'ready', modelId: message.modelId } } as MessageEvent<WorkerMessage>);
      }, 80);
    }

    if (message.type === 'GENERATE_ANALYSIS') {
      setTimeout(() => {
        const mock: AnalysisResult = {
          summary: 'Local mock analysis: replace with WebLLM output.',
          biases: ['No clear bias detected'],
          bias_claim_quote: ['N/A'],
          justify_bias_claim: ['N/A'],
          counterpoints: ['N/A'],
          confidence: 0.5
        };
        this.onmessage?.call(this as unknown as Worker, { data: { type: 'result', result: mock, raw: JSON.stringify(mock) } } as MessageEvent<WorkerMessage>);
      }, 200);
    }
  }

  terminate() {
    /* noop */
  }

  addEventListener<K extends keyof WorkerEventMap>(type: K, listener: (this: Worker, ev: WorkerEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    /* noop */
  }

  removeEventListener<K extends keyof WorkerEventMap>(type: K, listener: (this: Worker, ev: WorkerEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
    /* noop */
  }

  dispatchEvent(event: Event): boolean {
    return true;
  }
}

function createFallbackWorker(): Worker {
  return new MockWorker() as unknown as Worker;
}

export function useAI(options: UseAIOptions = {}) {
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<AIState>({
    status: 'idle',
    modelId,
    progress: 0
  });

  useEffect(() => {
    const worker = options.workerFactory ? options.workerFactory() : createFallbackWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        setState((prev: AIState) => ({ ...prev, status: 'idle', progress: 100, message: 'Model ready', modelId: msg.modelId }));
      } else if (msg.type === 'progress') {
        setState((prev: AIState) => ({ ...prev, status: 'loading', progress: msg.progress, message: msg.message }));
      } else if (msg.type === 'result') {
        setState((prev: AIState) => ({
          ...prev,
          status: 'complete',
          progress: 100,
          result: msg.result,
          rawOutput: msg.raw,
          message: 'Analysis complete'
        }));
      } else if (msg.type === 'error') {
        setState((prev: AIState) => ({ ...prev, status: 'error', error: msg.error, message: msg.error }));
      }
    };

    worker.postMessage({ type: 'LOAD_MODEL', modelId });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [modelId, options.workerFactory]);

  const analyze = useCallback(
    (text: string, previousPass?: AnalysisResult) => {
      if (!workerRef.current) {
        setState((prev: AIState) => ({ ...prev, status: 'error', error: 'AI worker not available' }));
        return;
      }
      setState((prev: AIState) => ({ ...prev, status: 'generating', progress: 0, message: 'Running analysis...' }));
      workerRef.current.postMessage({ type: 'GENERATE_ANALYSIS', text, previousPass });
    },
    []
  );

  const reset = useCallback(() => {
    setState({ status: 'idle', progress: 0, modelId });
  }, [modelId]);

  return {
    state,
    analyze,
    reset
  };
}
