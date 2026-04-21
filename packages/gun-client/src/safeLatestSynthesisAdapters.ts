import { TopicSynthesisV2Schema, type TopicSynthesisV2 } from '@vh/data-model';
import type { VennClient } from './types';
import {
  hasForbiddenSynthesisPayloadFields,
  readTopicLatestSynthesis,
  writeTopicLatestSynthesis,
} from './synthesisAdapters';

export interface SafeLatestSynthesisWriteOptions {
  canOverwriteExisting?: (existing: TopicSynthesisV2, next: TopicSynthesisV2) => boolean;
}

export type SafeLatestSynthesisWriteResult =
  | { status: 'written'; synthesis: TopicSynthesisV2; previous: TopicSynthesisV2 | null }
  | {
      status: 'skipped';
      reason: 'newer_epoch' | 'higher_quorum' | 'ownership_guard';
      synthesis: TopicSynthesisV2;
      previous: TopicSynthesisV2;
    };

export async function writeTopicLatestSynthesisIfNotDowngrade(
  client: VennClient,
  synthesis: unknown,
  options: SafeLatestSynthesisWriteOptions = {},
): Promise<SafeLatestSynthesisWriteResult> {
  if (hasForbiddenSynthesisPayloadFields(synthesis)) {
    throw new Error('Synthesis payload contains forbidden identity/token fields');
  }
  const sanitized = TopicSynthesisV2Schema.parse(synthesis);
  const existing = await readTopicLatestSynthesis(client, sanitized.topic_id);

  if (existing) {
    if (existing.epoch > sanitized.epoch) {
      return { status: 'skipped', reason: 'newer_epoch', synthesis: sanitized, previous: existing };
    }

    if (existing.epoch === sanitized.epoch && existing.quorum.received > sanitized.quorum.received) {
      return { status: 'skipped', reason: 'higher_quorum', synthesis: sanitized, previous: existing };
    }

    if (options.canOverwriteExisting && !options.canOverwriteExisting(existing, sanitized)) {
      return { status: 'skipped', reason: 'ownership_guard', synthesis: sanitized, previous: existing };
    }
  }

  await writeTopicLatestSynthesis(client, sanitized);
  return { status: 'written', synthesis: sanitized, previous: existing };
}
