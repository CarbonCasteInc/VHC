import React from 'react';

export interface SourceBadgeProps {
  /** Feed source identifier. */
  readonly sourceId: string;
  /** Publisher display name. */
  readonly publisher: string;
  /** Canonical source article URL. */
  readonly url: string;
  /** Optional icon key for future icon lookup. */
  readonly iconKey?: string;
}

/**
 * Deterministic color from sourceId hash — accessibility-safe palette.
 * Uses a small set of distinguishable hues that remain readable on white.
 */
function badgeColor(sourceId: string): string {
  let hash = 0;
  for (let i = 0; i < sourceId.length; i++) {
    hash = ((hash << 5) - hash + sourceId.charCodeAt(i)) | 0;
  }

  const colors = [
    'bg-blue-100 text-blue-800',
    'bg-emerald-100 text-emerald-800',
    'bg-amber-100 text-amber-800',
    'bg-rose-100 text-rose-800',
    'bg-violet-100 text-violet-800',
    'bg-cyan-100 text-cyan-800',
    'bg-orange-100 text-orange-800',
    'bg-teal-100 text-teal-800',
    'bg-pink-100 text-pink-800',
  ];

  const index = Math.abs(hash) % colors.length;
  return colors[index]!;
}

function publisherTag(publisher: string): string {
  const normalizedPublisher = publisher.trim();
  const lettersOnly = normalizedPublisher.replace(/[^A-Za-z0-9]/g, '');
  if (lettersOnly.length > 0 && lettersOnly.length <= 4 && lettersOnly === lettersOnly.toUpperCase()) {
    return lettersOnly.toLowerCase();
  }

  const words = normalizedPublisher
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index) => !(index === 0 && word === 'the'));

  if (words.length === 0) {
    return '???';
  }

  if (words.length === 1) {
    return words[0]!.slice(0, 3);
  }

  if (words.length === 2 && words[1] === 'news') {
    return words[0]!.slice(0, 3);
  }

  return words
    .slice(0, 3)
    .map((word) => word[0]!)
    .join('')
    .slice(0, 3);
}

/**
 * Compact circular source badge showing a short publisher tag.
 * Color is deterministic from sourceId for visual consistency.
 */
export const SourceBadge: React.FC<SourceBadgeProps> = ({
  sourceId,
  publisher,
  url,
}) => {
  const colorClass = badgeColor(sourceId);
  const tag = publisherTag(publisher);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/90 text-[10px] font-semibold uppercase tracking-[0.16em] shadow-sm transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${colorClass}`}
      aria-label={`Source: ${publisher}`}
      title={publisher}
      data-testid={`source-badge-${sourceId}`}
    >
      <span aria-hidden="true">{tag}</span>
    </a>
  );
};

export default SourceBadge;
