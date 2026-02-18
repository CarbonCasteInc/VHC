/**
 * Same-event merge contract for StoryBundle clustering.
 *
 * Determines whether two news articles describe the SAME underlying event.
 * Uses multi-signal scoring: entity overlap, keyword similarity,
 * action verb alignment, and anti-collision guards.
 *
 * No LLM calls — purely deterministic/heuristic.
 */

// --- Stop words excluded from keyword extraction ---

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'it', 'its',
  'that', 'this', 'these', 'those', 'he', 'she', 'they', 'we', 'you',
  'his', 'her', 'their', 'our', 'my', 'your', 'who', 'what', 'which',
  'when', 'where', 'how', 'why', 'if', 'then', 'than', 'so', 'as',
  'up', 'out', 'about', 'into', 'over', 'after', 'before', 'between',
  'under', 'again', 'more', 'most', 'some', 'such', 'only', 'also',
  'just', 'very', 'new', 'says', 'said', 'say', 'report', 'reports',
  'according', 'news', 'amid', 'via',
]);

// --- Action verb categories for event-type discrimination ---

const ACTION_CATEGORIES: ReadonlyMap<string, string> = new Map([
  // Legal/judicial
  ['arrested', 'legal'], ['arrests', 'legal'], ['charged', 'legal'],
  ['charges', 'legal'], ['convicted', 'legal'], ['sentenced', 'legal'],
  ['sued', 'legal'], ['indicted', 'legal'], ['acquitted', 'legal'],
  ['filed', 'legal'], ['ruled', 'legal'],
  // Political
  ['signed', 'political'], ['signs', 'political'], ['signing', 'political'],
  ['vetoed', 'political'], ['enacted', 'political'], ['passed', 'political'],
  ['repealed', 'political'], ['elected', 'political'], ['appointed', 'political'],
  ['resigned', 'political'], ['resigns', 'political'], ['impeached', 'political'],
  // Health
  ['hospitalized', 'health'], ['diagnosed', 'health'], ['recovered', 'health'],
  ['died', 'health'], ['dies', 'health'], ['tested', 'health'],
  ['vaccinated', 'health'], ['illness', 'health'], ['injury', 'health'],
  // Economic
  ['surged', 'economic'], ['surge', 'economic'], ['crashed', 'economic'],
  ['crash', 'economic'], ['rallied', 'economic'], ['rally', 'economic'],
  ['plunged', 'economic'], ['soared', 'economic'], ['dropped', 'economic'],
  ['earnings', 'economic'],
  // Conflict
  ['attacked', 'conflict'], ['attacks', 'conflict'], ['bombed', 'conflict'],
  ['invaded', 'conflict'], ['launched', 'conflict'], ['struck', 'conflict'],
  ['killed', 'conflict'], ['bombing', 'conflict'], ['strike', 'conflict'],
  // Diplomacy
  ['visited', 'diplomacy'], ['visits', 'diplomacy'], ['met', 'diplomacy'],
  ['negotiated', 'diplomacy'], ['agreed', 'diplomacy'], ['sanctioned', 'diplomacy'],
  // Disaster
  ['earthquake', 'disaster'], ['flood', 'disaster'], ['hurricane', 'disaster'],
  ['wildfire', 'disaster'], ['erupted', 'disaster'], ['collapsed', 'disaster'],
]);

/** Tokenize a headline into lowercase, alpha-only tokens ≥3 chars. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** Extract significant keywords from a title (non-stop, ≥3 chars). */
export function extractKeywords(title: string): string[] {
  return [...new Set(tokenize(title))];
}

/** Detect action category from title tokens. Returns category or null. */
export function detectActionCategory(title: string): string | null {
  const tokens = tokenize(title);
  for (const token of tokens) {
    const category = ACTION_CATEGORIES.get(token);
    if (category) return category;
  }
  return null;
}

// --- Location tokens for geographic alignment ---

const LOCATIONS = new Set([
  // Countries
  'china', 'russia', 'japan', 'india', 'brazil', 'germany', 'france',
  'ukraine', 'iran', 'israel', 'turkey', 'mexico', 'canada', 'australia',
  'korea', 'taiwan', 'pakistan', 'afghanistan', 'iraq', 'syria', 'egypt',
  'nigeria', 'kenya', 'colombia', 'argentina', 'indonesia', 'vietnam',
  // Cities
  'washington', 'beijing', 'moscow', 'tokyo', 'london', 'paris', 'berlin',
  'jerusalem', 'kyiv', 'tehran', 'taipei', 'seoul', 'delhi', 'mumbai',
  'gaza', 'kabul', 'baghdad', 'cairo', 'nairobi', 'brussels',
  // Regions
  'europe', 'asia', 'africa', 'middle-east', 'pacific', 'arctic',
  'mediterranean', 'caribbean', 'pentagon', 'kremlin', 'capitol',
]);

/** Extract location tokens from text. */
export function extractLocations(text: string): string[] {
  const tokens = tokenize(text);
  return [...new Set(tokens.filter((t) => LOCATIONS.has(t)))];
}

/** Jaccard similarity between two string sets. */
export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  if (union === 0) return 0;
  return intersection / union;
}

// --- Merge signal scoring ---

export interface MergeSignals {
  /** Entity Jaccard overlap [0–1]. */
  entityOverlap: number;
  /** Keyword Jaccard overlap [0–1]. */
  keywordOverlap: number;
  /** Whether detected action categories match. */
  actionMatch: boolean;
  /** Whether action categories actively conflict. */
  actionConflict: boolean;
  /** Location alignment [0–1]: 1=match/none, 0=conflict. */
  locationAlignment: number;
  /** Composite score [0–1]. */
  score: number;
}

/**
 * Compute merge signals between a cluster's accumulated state and a
 * candidate item. Used to decide whether the item belongs to the cluster.
 */
export function computeMergeSignals(
  clusterEntityKeys: readonly string[],
  clusterTitles: readonly string[],
  itemEntityKeys: readonly string[],
  itemTitle: string,
): MergeSignals {
  const entityOverlap = jaccardSimilarity(clusterEntityKeys, itemEntityKeys);

  const clusterKeywords = clusterTitles.flatMap(extractKeywords);
  const itemKeywords = extractKeywords(itemTitle);
  const keywordOverlap = jaccardSimilarity(clusterKeywords, itemKeywords);

  const clusterActions = clusterTitles
    .map(detectActionCategory)
    .filter((c): c is string => c !== null);
  const itemAction = detectActionCategory(itemTitle);

  let actionMatch = false;
  let actionConflict = false;
  if (itemAction !== null && clusterActions.length > 0) {
    actionMatch = clusterActions.includes(itemAction);
    actionConflict = !actionMatch;
  }

  // Location alignment: 1.0 if same/none, 0.0 if conflicting locations.
  const clusterLocs = clusterTitles.flatMap(extractLocations);
  const itemLocs = extractLocations(itemTitle);
  let locationAlignment: number;
  if (clusterLocs.length === 0 || itemLocs.length === 0) {
    locationAlignment = 1; // neutral — no location signal
  } else {
    const locOverlap = jaccardSimilarity(clusterLocs, itemLocs);
    locationAlignment = locOverlap > 0 ? 1 : 0;
  }

  // Weighted composite (CE-Opus formula):
  // - Entity overlap: 0.25
  // - Keyword overlap: 0.35
  // - Action alignment: 0.25
  // - Location alignment: 0.15
  const actionScore = actionConflict ? 0 : actionMatch ? 1 : 0.5;
  const score =
    entityOverlap * 0.25 +
    keywordOverlap * 0.35 +
    actionScore * 0.25 +
    locationAlignment * 0.15;

  return { entityOverlap, keywordOverlap, actionMatch, actionConflict, locationAlignment, score };
}

/** Minimum composite score for merge. */
export const SAME_EVENT_MERGE_THRESHOLD = 0.30;

/**
 * Same-event merge predicate. Returns true if the item should join the cluster.
 *
 * Contract:
 * 1. Entity overlap must be non-zero (at least one shared entity).
 * 2. Action categories must not conflict (e.g., "arrested" vs "visited").
 * 3. Composite score must meet threshold.
 */
export function shouldMerge(
  clusterEntityKeys: readonly string[],
  clusterTitles: readonly string[],
  itemEntityKeys: readonly string[],
  itemTitle: string,
): boolean {
  const signals = computeMergeSignals(
    clusterEntityKeys, clusterTitles, itemEntityKeys, itemTitle,
  );
  // Hard anti-collision: action conflict vetoes merge regardless of score.
  if (signals.actionConflict) return false;
  // Must have at least some entity overlap.
  if (signals.entityOverlap === 0) return false;
  return signals.score >= SAME_EVENT_MERGE_THRESHOLD;
}

export interface MergeExplanation {
  entityOverlap: number;
  keywordOverlap: number;
  actionCategory: string | null;
  actionMatch: boolean;
  actionConflict: boolean;
  locationAlignment: number;
  compositeScore: number;
  merged: boolean;
  reason: string;
}

/** Build human-readable merge explanation for verification metadata. */
export function explainMerge(
  clusterEntityKeys: readonly string[],
  clusterTitles: readonly string[],
  itemEntityKeys: readonly string[],
  itemTitle: string,
): MergeExplanation {
  const signals = computeMergeSignals(
    clusterEntityKeys, clusterTitles, itemEntityKeys, itemTitle,
  );
  const merged = shouldMerge(
    clusterEntityKeys, clusterTitles, itemEntityKeys, itemTitle,
  );

  let reason: string;
  if (signals.actionConflict) {
    reason = 'action_conflict_veto';
  } else if (signals.entityOverlap === 0) {
    reason = 'no_entity_overlap';
  } else if (signals.score < SAME_EVENT_MERGE_THRESHOLD) {
    reason = 'below_threshold';
  } else {
    reason = 'same_event_match';
  }

  return {
    entityOverlap: signals.entityOverlap,
    keywordOverlap: signals.keywordOverlap,
    actionCategory: detectActionCategory(itemTitle),
    actionMatch: signals.actionMatch,
    actionConflict: signals.actionConflict,
    locationAlignment: signals.locationAlignment,
    compositeScore: signals.score,
    merged,
    reason,
  };
}
