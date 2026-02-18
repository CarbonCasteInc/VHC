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

function publisherInitial(publisher: string): string {
  return publisher.charAt(0).toUpperCase() || '?';
}

/**
 * Compact source badge pill showing publisher initial + name.
 * Color is deterministic from sourceId for visual consistency.
 */
export const SourceBadge: React.FC<SourceBadgeProps> = ({
  sourceId,
  publisher,
  url,
}) => {
  const colorClass = badgeColor(sourceId);
  const initial = publisherInitial(publisher);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colorClass} underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      aria-label={`Source: ${publisher}`}
      data-testid={`source-badge-${sourceId}`}
    >
      <span className="font-bold" aria-hidden="true">
        {initial}
      </span>
      <span className="max-w-[6rem] truncate">{publisher}</span>
    </a>
  );
};

export default SourceBadge;
