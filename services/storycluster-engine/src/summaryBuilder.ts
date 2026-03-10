import type { StoredClusterRecord } from './stageState';
import { ensureSentence, splitSentences } from './textSignals';

function publisherKey(publisher: string, sourceId: string): string {
  const normalized = publisher.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized || sourceId.trim().toLowerCase();
}

function pickLeadSentence(cluster: StoredClusterRecord): string {
  const canonicalDocument = cluster.source_documents.find((document) => document.title === cluster.headline);
  const leadSource = canonicalDocument?.summary ?? cluster.headline;
  const summaryCandidates = [leadSource]
    .flatMap((text) => splitSentences(text))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return ensureSentence(summaryCandidates[0]!);
}

function coverageSentence(cluster: StoredClusterRecord): string {
  const groupedPublishers = new Map<string, string>();
  for (const document of cluster.source_documents) {
    const key = publisherKey(document.publisher, document.source_id);
    if (!groupedPublishers.has(key)) {
      groupedPublishers.set(key, document.publisher);
    }
  }
  const sourceCount = groupedPublishers.size;
  const assetCount = Math.max(0, cluster.source_documents.length - sourceCount);
  const publishers = [...groupedPublishers.values()]
    .sort()
    .slice(0, 3);
  const spanHours = Math.max(
    1,
    Math.round((cluster.cluster_window_end - cluster.cluster_window_start) / (60 * 60 * 1000)),
  );
  const assetTail = assetCount > 0
    ? ` with ${assetCount} additional same-publisher asset${assetCount === 1 ? '' : 's'}`
    : '';
  return ensureSentence(
    `${sourceCount} source${sourceCount === 1 ? '' : 's'} across ${publishers.join(', ') || 'multiple outlets'} tracked the event over about ${spanHours} hour${spanHours === 1 ? '' : 's'}${assetTail}`,
  );
}

function updateSentence(cluster: StoredClusterRecord): string | null {
  const latest = [...cluster.source_documents].sort((left, right) => right.published_at - left.published_at)[0];
  if (!latest) {
    return null;
  }

  const text = latest.summary ?? latest.title;
  const sentence = splitSentences(text)[0]!;
  if (!sentence || sentence.toLowerCase() === cluster.headline.toLowerCase()) {
    return null;
  }
  return ensureSentence(sentence);
}

export function buildClusterSummary(cluster: StoredClusterRecord): string {
  const sentences = [pickLeadSentence(cluster), coverageSentence(cluster), updateSentence(cluster)]
    .filter((sentence, index, values) => Boolean(sentence) && values.indexOf(sentence) === index)
    .slice(0, 3) as string[];

  return sentences.join(' ');
}
