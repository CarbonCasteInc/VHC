import { fnv1a32 } from './quorum';
import type { StoryBundle } from './newsTypes';
import type {
  StoryEntityLink,
  StoryTemporalAnchor,
  StoryTupleGdeltGrounding,
} from './newsAdvancedPipelineTypes';
import { clamp01, normalizeToken, roundMetric, titleCaseLabel, tokenize } from './newsAdvancedPipelinePrimitives';

export interface ActionProfile {
  readonly predicate: string;
  readonly gdeltCode: string;
  readonly gdeltLabel: string;
  readonly baseImpact: number;
  readonly keywords: readonly string[];
}

const ACTION_PROFILES: readonly ActionProfile[] = [
  {
    predicate: 'attack',
    gdeltCode: '190',
    gdeltLabel: 'Use conventional military force',
    baseImpact: 0.95,
    keywords: ['attack', 'strike', 'bomb', 'raid', 'assault'],
  },
  {
    predicate: 'sanction',
    gdeltCode: '112',
    gdeltLabel: 'Accuse or impose restrictions',
    baseImpact: 0.78,
    keywords: ['sanction', 'tariff', 'ban', 'restrict', 'penalty'],
  },
  {
    predicate: 'protest',
    gdeltCode: '145',
    gdeltLabel: 'Demonstrate or protest',
    baseImpact: 0.62,
    keywords: ['protest', 'rally', 'march', 'demonstration', 'boycott'],
  },
  {
    predicate: 'investigate',
    gdeltCode: '173',
    gdeltLabel: 'Investigate or prosecute',
    baseImpact: 0.73,
    keywords: ['arrest', 'charge', 'investigate', 'probe', 'indict'],
  },
  {
    predicate: 'agree',
    gdeltCode: '030',
    gdeltLabel: 'Express intent to cooperate',
    baseImpact: 0.56,
    keywords: ['agree', 'deal', 'accord', 'sign', 'ceasefire'],
  },
  {
    predicate: 'assist',
    gdeltCode: '070',
    gdeltLabel: 'Provide aid',
    baseImpact: 0.5,
    keywords: ['aid', 'relief', 'rescue', 'evacuate', 'support'],
  },
  {
    predicate: 'announce',
    gdeltCode: '010',
    gdeltLabel: 'Make public statement',
    baseImpact: 0.42,
    keywords: ['announce', 'launch', 'release', 'publish', 'report'],
  },
];

const DEFAULT_ACTION_PROFILE: ActionProfile = {
  predicate: 'report',
  gdeltCode: '010',
  gdeltLabel: 'Make public statement',
  baseImpact: 0.4,
  keywords: [],
};

function toEntityId(value: string): string {
  return `ent-${fnv1a32(normalizeToken(value))}`;
}

export function extractEntityCandidates(bundle: StoryBundle): string[] {
  const candidates = new Set<string>();

  for (const key of bundle.cluster_features.entity_keys) {
    const canonical = titleCaseLabel(key);
    if (canonical) {
      candidates.add(canonical);
    }
  }

  for (const title of [bundle.headline, bundle.summary_hint ?? '', ...bundle.sources.map((source) => source.title)]) {
    for (const token of tokenize(title)) {
      if (token.length >= 4) {
        const canonical = titleCaseLabel(token);
        if (canonical) {
          candidates.add(canonical);
        }
      }
    }
  }

  if (candidates.size === 0) {
    candidates.add('General');
  }

  return [...candidates].sort((left, right) => left.localeCompare(right));
}

export function buildEntityLinks(entityCandidates: readonly string[]): StoryEntityLink[] {
  const supportByEntity = new Map<string, { canonical: string; aliases: Set<string>; count: number }>();

  for (const candidate of entityCandidates) {
    const normalized = normalizeToken(candidate);
    if (!normalized) {
      continue;
    }

    const canonical = titleCaseLabel(candidate) || 'General';
    const existing = supportByEntity.get(normalized);
    if (existing) {
      existing.aliases.add(canonical);
      existing.count += 1;
      continue;
    }

    supportByEntity.set(normalized, {
      canonical,
      aliases: new Set([canonical]),
      count: 1,
    });
  }

  const totalSupport = [...supportByEntity.values()].reduce((sum, entry) => sum + entry.count, 0);
  const denominator = totalSupport > 0 ? totalSupport : 1;

  return [...supportByEntity.values()]
    .map((entry) => {
      const aliases = [...entry.aliases].sort((left, right) => left.localeCompare(right));
      return {
        entity_id: toEntityId(entry.canonical),
        canonical_label: entry.canonical,
        aliases,
        support_count: entry.count,
        confidence: roundMetric(entry.count / denominator),
      };
    })
    .sort((left, right) => left.canonical_label.localeCompare(right.canonical_label));
}

export function findMentionedEntityIds(text: string, links: readonly StoryEntityLink[]): string[] {
  const tokenSet = new Set(tokenize(text));
  const mentioned = links
    .filter((link) =>
      link.aliases.some((alias) =>
        tokenize(alias).some((token) => tokenSet.has(token)),
      ),
    )
    .map((link) => link.entity_id)
    .sort((left, right) => left.localeCompare(right));

  if (mentioned.length > 0) {
    return mentioned;
  }

  return links[0] ? [links[0].entity_id] : [];
}

function parseIsoDate(text: string): number | null {
  const match = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (!match) {
    return null;
  }

  const timestamp = Date.parse(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function parseRelativeDate(text: string, referenceNowMs: number): StoryTemporalAnchor | null {
  const normalized = normalizeToken(text);
  const dayMs = 24 * 60 * 60 * 1000;

  if (normalized.includes('yesterday')) {
    return {
      normalized_at: Math.max(0, referenceNowMs - dayMs),
      granularity: 'day',
      source: 'title',
      expression: 'yesterday',
    };
  }

  if (normalized.includes('tomorrow')) {
    return {
      normalized_at: referenceNowMs + dayMs,
      granularity: 'day',
      source: 'title',
      expression: 'tomorrow',
    };
  }

  if (normalized.includes('today') || normalized.includes('tonight')) {
    return {
      normalized_at: referenceNowMs,
      granularity: 'day',
      source: 'title',
      expression: normalized.includes('tonight') ? 'tonight' : 'today',
    };
  }

  if (normalized.includes('last week')) {
    return {
      normalized_at: Math.max(0, referenceNowMs - 7 * dayMs),
      granularity: 'week',
      source: 'title',
      expression: 'last week',
    };
  }

  if (normalized.includes('next week')) {
    return {
      normalized_at: referenceNowMs + 7 * dayMs,
      granularity: 'week',
      source: 'title',
      expression: 'next week',
    };
  }

  return null;
}

export function normalizeTemporalAnchor(
  text: string,
  publishedAt: number | undefined,
  referenceNowMs: number,
  clusterWindowStart: number,
): StoryTemporalAnchor {
  const parsedIso = parseIsoDate(text);
  if (parsedIso !== null) {
    return {
      normalized_at: parsedIso,
      granularity: 'day',
      source: 'title',
      expression: text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1],
    };
  }

  const relative = parseRelativeDate(text, referenceNowMs);
  if (relative) {
    return relative;
  }

  if (typeof publishedAt === 'number' && Number.isFinite(publishedAt) && publishedAt >= 0) {
    return {
      normalized_at: Math.floor(publishedAt),
      granularity: 'hour',
      source: 'published_at',
    };
  }

  return {
    normalized_at: Math.max(0, Math.floor(clusterWindowStart)),
    granularity: 'fallback',
    source: 'cluster_window',
    expression: 'cluster_window_start',
  };
}

export function resolveActionProfile(text: string): ActionProfile {
  const normalized = normalizeToken(text);

  for (const profile of ACTION_PROFILES) {
    if (profile.keywords.some((keyword) => normalized.includes(keyword))) {
      return profile;
    }
  }

  return DEFAULT_ACTION_PROFILE;
}

export function clusterSignal(bundle: StoryBundle): number {
  const coverage = bundle.cluster_features.coverage_score ?? 0.35;
  const velocity = bundle.cluster_features.velocity_score ?? 0.2;
  const confidence = bundle.cluster_features.confidence_score ?? 0.5;
  return clamp01((coverage + velocity + confidence) / 3);
}

export function gdeltFromAction(action: ActionProfile, confidence: number): StoryTupleGdeltGrounding {
  return {
    code: action.gdeltCode,
    label: action.gdeltLabel,
    confidence: roundMetric(confidence * 0.9),
    impact_score: roundMetric(action.baseImpact),
  };
}
