import type { ThreadSourceContextInput } from './types';

export function normalizeThreadSourceContext(
  sourceContext: ThreadSourceContextInput,
): { sourceSynthesisId?: string; sourceEpoch?: number } {
  if (typeof sourceContext === 'string') {
    const sourceSynthesisId = sourceContext.trim();
    return sourceSynthesisId ? { sourceSynthesisId } : {};
  }

  const sourceSynthesisId = sourceContext?.sourceSynthesisId?.trim();
  return {
    ...(sourceSynthesisId ? { sourceSynthesisId } : {}),
    ...(sourceContext?.sourceEpoch != null ? { sourceEpoch: sourceContext.sourceEpoch } : {}),
  };
}
