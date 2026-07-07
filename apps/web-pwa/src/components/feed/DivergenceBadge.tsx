import React from 'react';

export const HIGH_DIVERGENCE_THRESHOLD = 0.5;

interface DivergenceBadgeProps {
  score: number | null | undefined;
  label?: string;
}

export const DivergenceBadge: React.FC<DivergenceBadgeProps> = ({ score, label = 'High divergence' }) => {
  if (typeof score !== 'number' || score <= HIGH_DIVERGENCE_THRESHOLD) {
    return null;
  }
  return (
    <span
      className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
      data-testid="synthesis-divergence"
      title={`Disagreement: ${(score * 100).toFixed(0)}%`}
    >
      {label}
    </span>
  );
};

export default DivergenceBadge;
