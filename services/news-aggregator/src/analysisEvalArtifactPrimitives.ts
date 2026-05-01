import { createHash } from 'node:crypto';

export interface AnalysisEvalSerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface AnalysisEvalValidatorEvent {
  stage:
    | 'source_extraction'
    | 'article_analysis_relay'
    | 'article_analysis_parse'
    | 'bundle_synthesis_relay'
    | 'bundle_synthesis_parse'
    | 'bundle_synthesis_source_count'
    | 'persist';
  status: 'accepted' | 'rejected' | 'warning';
  code: string;
  message: string;
  source_id?: string;
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function serializeAnalysisEvalError(error: unknown): AnalysisEvalSerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: 'Error', message: String(error) };
}
