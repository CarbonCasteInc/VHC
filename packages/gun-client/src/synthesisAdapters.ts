import type { CandidateSynthesis, TopicDigest, TopicSynthesisV2 } from '@vh/data-model';
import { createGuardedChain, type ChainWithGet } from './chain';
import type { VennClient } from './types';

function candidatesPath(topicId: string, epochId: string): string {
  return `vh/topics/${topicId}/epochs/${epochId}/candidates/`;
}

function synthesisPath(topicId: string, epochId: string): string {
  return `vh/topics/${topicId}/epochs/${epochId}/synthesis/`;
}

function latestPath(topicId: string): string {
  return `vh/topics/${topicId}/latest/`;
}

function digestPath(topicId: string, digestId: string): string {
  return `vh/topics/${topicId}/digests/${digestId}/`;
}

// Wave 0 adapter stub. Team A will extend this API in A-4.
export function getTopicEpochCandidatesChain(
  client: VennClient,
  topicId: string,
  epochId: string
): ChainWithGet<CandidateSynthesis> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('epochs')
    .get(epochId)
    .get('candidates') as unknown as ChainWithGet<CandidateSynthesis>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, candidatesPath(topicId, epochId));
}

// Wave 0 adapter stub. Team A will extend this API in A-4.
export function getTopicEpochSynthesisChain(
  client: VennClient,
  topicId: string,
  epochId: string
): ChainWithGet<TopicSynthesisV2> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('epochs')
    .get(epochId)
    .get('synthesis') as unknown as ChainWithGet<TopicSynthesisV2>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, synthesisPath(topicId, epochId));
}

// Wave 0 adapter stub. Team A will extend this API in A-4.
export function getTopicLatestSynthesisChain(client: VennClient, topicId: string): ChainWithGet<TopicSynthesisV2> {
  const chain = client.mesh.get('topics').get(topicId).get('latest') as unknown as ChainWithGet<TopicSynthesisV2>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, latestPath(topicId));
}

// Wave 0 adapter stub. Team A will extend this API in A-4.
export function getTopicDigestChain(client: VennClient, topicId: string, digestId: string): ChainWithGet<TopicDigest> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('digests')
    .get(digestId) as unknown as ChainWithGet<TopicDigest>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, digestPath(topicId, digestId));
}
