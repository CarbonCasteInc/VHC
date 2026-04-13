import { canonicalizeUrl, urlHash } from './normalize';

export type ItemEligibilityState =
  | 'analysis_eligible'
  | 'link_only'
  | 'hard_blocked';

export type ItemEligibilityReason =
  | 'analysis_eligible'
  | 'quality-too-low'
  | 'fetch-failed'
  | 'access-denied'
  | 'domain-not-allowed'
  | 'invalid-url'
  | 'removed'
  | 'unexpected-error';

export interface ItemEligibilityAssessment {
  readonly url: string;
  readonly canonicalUrl: string | null;
  readonly urlHash: string | null;
  readonly state: ItemEligibilityState;
  readonly reason: ItemEligibilityReason;
  readonly retryable: boolean;
  readonly displayEligible: boolean;
}

interface ArticleTextResultLike {
  readonly url: string;
  readonly urlHash: string;
}

interface ArticleTextServiceErrorLike {
  readonly code: string;
  readonly retryable: boolean;
}

function normalizeUrl(inputUrl: string): {
  readonly url: string;
  readonly canonicalUrl: string | null;
  readonly hashedUrl: string | null;
} {
  const canonicalUrl = canonicalizeUrl(inputUrl);
  return {
    url: inputUrl,
    canonicalUrl,
    hashedUrl: canonicalUrl ? urlHash(canonicalUrl) : null,
  };
}

export function assessItemEligibilityFromResult(
  result: ArticleTextResultLike,
): ItemEligibilityAssessment {
  return {
    url: result.url,
    canonicalUrl: result.url,
    urlHash: result.urlHash,
    state: 'analysis_eligible',
    reason: 'analysis_eligible',
    retryable: false,
    displayEligible: true,
  };
}

function isArticleTextServiceErrorLike(
  error: unknown,
): error is ArticleTextServiceErrorLike {
  return Boolean(
    error
    && typeof error === 'object'
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { retryable?: unknown }).retryable === 'boolean',
  );
}

export function assessItemEligibilityFromError(
  inputUrl: string,
  error: unknown,
): ItemEligibilityAssessment {
  const normalized = normalizeUrl(inputUrl);

  if (isArticleTextServiceErrorLike(error)) {
    switch (error.code) {
      case 'access-denied':
      case 'domain-not-allowed':
      case 'invalid-url':
      case 'removed':
        return {
          url: normalized.url,
          canonicalUrl: normalized.canonicalUrl,
          urlHash: normalized.hashedUrl,
          state: 'hard_blocked',
          reason: error.code,
          retryable: error.retryable,
          displayEligible: false,
        };
      case 'quality-too-low':
        return {
          url: normalized.url,
          canonicalUrl: normalized.canonicalUrl,
          urlHash: normalized.hashedUrl,
          state: 'link_only',
          reason: error.code,
          retryable: error.retryable,
          displayEligible: true,
        };
      case 'fetch-failed':
      default:
        return {
          url: normalized.url,
          canonicalUrl: normalized.canonicalUrl,
          urlHash: normalized.hashedUrl,
          state: 'link_only',
          reason: error.code === 'fetch-failed' ? 'fetch-failed' : 'unexpected-error',
          retryable: error.retryable,
          displayEligible: true,
        };
    }
  }

  return {
    url: normalized.url,
    canonicalUrl: normalized.canonicalUrl,
    urlHash: normalized.hashedUrl,
    state: 'link_only',
    reason: 'unexpected-error',
    retryable: false,
    displayEligible: true,
  };
}

export const itemEligibilityPolicyInternal = {
  normalizeUrl,
};
