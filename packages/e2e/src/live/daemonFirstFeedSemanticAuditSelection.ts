import type {
  LiveSemanticAuditBundleLike,
  SemanticAuditStoreSnapshot,
  SemanticAuditStoreStorySnapshot,
} from './daemonFirstFeedSemanticAuditTypes';

const DEFAULT_PROFILE_VISIBLE_STORY_LIMIT = 8;
const PROFILE_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'after', 'against', 'amid', 'be', 'by', 'for', 'from',
  'in', 'into', 'is', 'it', 'its', 'near', 'of', 'on', 'or', 'over', 'says', 'say', 'saying',
  'the', 'their', 'to', 'under', 'up', 'us', 'who', 'with', 'watch', 'what', 'why', 'how', 'will',
]);

export interface ProfileOverlapTarget {
  readonly sourceIds: ReadonlyArray<string>;
  readonly sharedTerms: ReadonlyArray<string>;
  readonly similarity: number;
  readonly leftStoryId: string;
  readonly rightStoryId: string;
  readonly leftHeadline: string;
  readonly rightHeadline: string;
}

export interface ProfileSpecificBundleSelection {
  readonly hasOverlapTarget: boolean;
  readonly target: ProfileOverlapTarget | null;
  readonly bundles: ReadonlyArray<LiveSemanticAuditBundleLike>;
}

function normalizeToken(token: string): string {
  const compact = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact.length < 3 || PROFILE_STOPWORDS.has(compact)) {
    return '';
  }
  if (compact.endsWith('ies') && compact.length > 4) {
    return `${compact.slice(0, -3)}y`;
  }
  if (compact.endsWith('ing') && compact.length > 5) {
    return compact.slice(0, -3);
  }
  if (compact.endsWith('ed') && compact.length > 4) {
    return compact.slice(0, -2);
  }
  if (compact.endsWith('es') && compact.length > 4) {
    return compact.slice(0, -2);
  }
  if (compact.endsWith('s') && compact.length > 4) {
    return compact.slice(0, -1);
  }
  return compact;
}

export function headlineTerms(headline: string | null | undefined): string[] {
  return [...new Set(
    String(headline ?? '')
      .split(/\s+/)
      .map(normalizeToken)
      .filter((value) => value.length > 0),
  )];
}

function readProfileVisibleStoryLimit(env = process.env): number {
  const raw = env.VH_DAEMON_FEED_SEMANTIC_PROFILE_VISIBLE_STORY_LIMIT?.trim();
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PROFILE_VISIBLE_STORY_LIMIT;
  }
  return parsed;
}

export function readPublicSemanticProfileSourceIds(env = process.env): string[] {
  if (env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true') {
    return [];
  }

  return [...new Set(
    (env.VH_LIVE_DEV_FEED_SOURCE_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )];
}

function storeStorySourceIds(story: SemanticAuditStoreStorySnapshot): string[] {
  return story.primary_source_ids.length > 0
    ? [...story.primary_source_ids]
    : [...story.source_ids];
}

function bundleSourceIds(bundle: LiveSemanticAuditBundleLike): string[] {
  return (bundle.primary_sources ?? bundle.sources).map((source) => source.source_id);
}

function firstProfileSourceId(sourceIds: readonly string[], profileSourceSet: ReadonlySet<string>): string | null {
  const matches = sourceIds.filter((sourceId) => profileSourceSet.has(sourceId));
  return matches.length === 1 ? matches[0]! : null;
}

export function buildProfileOverlapTarget(
  snapshot: SemanticAuditStoreSnapshot,
  profileSourceIds: readonly string[],
  env = process.env,
): ProfileOverlapTarget | null {
  if (profileSourceIds.length < 2) {
    return null;
  }

  const profileSourceSet = new Set(profileSourceIds);
  const visibleStoryLimit = readProfileVisibleStoryLimit(env);
  const visibleStories = snapshot.stories
    .filter((story) => story.is_dom_visible)
    .slice(0, visibleStoryLimit)
    .map((story) => ({
      story,
      profileSourceId: firstProfileSourceId(storeStorySourceIds(story), profileSourceSet),
    }))
    .filter((entry) => entry.profileSourceId !== null);

  let bestTarget: ProfileOverlapTarget | null = null;
  for (let index = 0; index < visibleStories.length; index += 1) {
    const left = visibleStories[index]!;
    const leftTerms = headlineTerms(left.story.headline);
    if (leftTerms.length === 0) {
      continue;
    }

    for (let next = index + 1; next < visibleStories.length; next += 1) {
      const right = visibleStories[next]!;
      if (left.profileSourceId === right.profileSourceId) {
        continue;
      }

      const rightTerms = headlineTerms(right.story.headline);
      const sharedTerms = leftTerms.filter((term) => rightTerms.includes(term));
      const similarity = sharedTerms.length / Math.max(1, Math.min(leftTerms.length, rightTerms.length));
      if (sharedTerms.length < 2 || similarity < 0.4) {
        continue;
      }

      const candidate: ProfileOverlapTarget = {
        sourceIds: [left.profileSourceId!, right.profileSourceId!].sort(),
        sharedTerms,
        similarity,
        leftStoryId: left.story.story_id,
        rightStoryId: right.story.story_id,
        leftHeadline: left.story.headline,
        rightHeadline: right.story.headline,
      };

      if (!bestTarget) {
        bestTarget = candidate;
        continue;
      }

      if (candidate.sharedTerms.length > bestTarget.sharedTerms.length) {
        bestTarget = candidate;
        continue;
      }
      if (candidate.sharedTerms.length === bestTarget.sharedTerms.length && candidate.similarity > bestTarget.similarity) {
        bestTarget = candidate;
      }
    }
  }

  return bestTarget;
}

function bundleTerms(bundle: LiveSemanticAuditBundleLike): Set<string> {
  return new Set([
    ...headlineTerms(bundle.headline),
    ...(bundle.primary_sources ?? bundle.sources).flatMap((source) => headlineTerms(source.title)),
  ]);
}

export function selectProfileSpecificAuditableBundles(
  auditableBundles: readonly LiveSemanticAuditBundleLike[],
  snapshot: SemanticAuditStoreSnapshot,
  profileSourceIds: readonly string[],
  env = process.env,
): ProfileSpecificBundleSelection {
  const target = buildProfileOverlapTarget(snapshot, profileSourceIds, env);
  if (!target) {
    return {
      hasOverlapTarget: false,
      target: null,
      bundles: [...auditableBundles],
    };
  }

  const ranked = auditableBundles
    .map((bundle) => {
      const canonicalSourceIds = bundleSourceIds(bundle).filter((sourceId) => profileSourceIds.includes(sourceId));
      const distinctSourceIds = [...new Set(canonicalSourceIds)].sort();
      if (distinctSourceIds.length < 2) {
        return null;
      }
      if (distinctSourceIds.join(',') !== target.sourceIds.join(',')) {
        return null;
      }

      const terms = bundleTerms(bundle);
      const matchedTerms = target.sharedTerms.filter((term) => terms.has(term));
      if (matchedTerms.length < 2) {
        return null;
      }

      return {
        bundle,
        matchedTerms,
      };
    })
    .filter((entry): entry is { bundle: LiveSemanticAuditBundleLike; matchedTerms: string[] } => Boolean(entry))
    .sort((left, right) =>
      right.matchedTerms.length - left.matchedTerms.length
      || left.bundle.story_id.localeCompare(right.bundle.story_id));

  return {
    hasOverlapTarget: true,
    target,
    bundles: ranked.map((entry) => entry.bundle),
  };
}
