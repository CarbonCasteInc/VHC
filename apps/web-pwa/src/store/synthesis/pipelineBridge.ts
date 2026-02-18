/**
 * Pipeline → synthesis store bridge.
 *
 * Takes TopicSynthesisV2 output from the pipeline, validates it,
 * updates the synthesis store, and writes to the Gun mesh.
 *
 * @module pipelineBridge
 */

import { TopicSynthesisV2Schema, type TopicSynthesisV2 } from '@vh/data-model';
import {
  hasForbiddenSynthesisPayloadFields,
  writeTopicSynthesis,
  type VennClient,
} from '@vh/gun-client';

// ── Dependency injection ───────────────────────────────────────────

export interface PipelineBridgeDeps {
  /** Resolve Gun client for mesh writes. */
  resolveClient: () => VennClient | null;
  /** Update synthesis store state. */
  setTopicSynthesis: (
    topicId: string,
    synthesis: TopicSynthesisV2,
  ) => void;
}

// ── Validation ─────────────────────────────────────────────────────

export interface PersistResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a pipeline output for privacy and schema compliance.
 * Returns the parsed synthesis or null with a reason.
 */
export function validatePipelineOutput(
  output: unknown,
): { valid: true; synthesis: TopicSynthesisV2 } | { valid: false; reason: string } {
  if (hasForbiddenSynthesisPayloadFields(output)) {
    return {
      valid: false,
      reason: 'Pipeline output contains forbidden identity/token fields',
    };
  }

  const parsed = TopicSynthesisV2Schema.safeParse(output);
  if (!parsed.success) {
    return {
      valid: false,
      reason: `Schema validation failed: ${parsed.error.message}`,
    };
  }

  return { valid: true, synthesis: parsed.data };
}

// ── Bridge function ────────────────────────────────────────────────

/**
 * Persist a pipeline output to the synthesis store and Gun mesh.
 *
 * 1. Validates the output (privacy + schema).
 * 2. Updates the in-memory synthesis store.
 * 3. Writes to Gun mesh at epoch + latest paths.
 */
export async function persistSynthesisOutput(
  deps: PipelineBridgeDeps,
  output: unknown,
): Promise<PersistResult> {
  const validation = validatePipelineOutput(output);
  if (!validation.valid) {
    return { ok: false, reason: validation.reason };
  }

  const { synthesis } = validation;

  // Update in-memory store
  deps.setTopicSynthesis(synthesis.topic_id, synthesis);

  // Write to Gun mesh (epoch + latest paths)
  const client = deps.resolveClient();
  if (!client) {
    return { ok: true, reason: 'Store updated; no Gun client for mesh write' };
  }

  try {
    await writeTopicSynthesis(client, synthesis);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Gun write failed';
    return { ok: true, reason: `Store updated; mesh write failed: ${message}` };
  }

  return { ok: true };
}
