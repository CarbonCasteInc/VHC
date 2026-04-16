import React, { useMemo } from 'react';
import {
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightOutline,
  EyeIcon as EyeOutline,
  LightBulbIcon as LightBulbOutline,
} from '@heroicons/react/24/outline';
import {
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolid,
  EyeIcon as EyeSolid,
  LightBulbIcon as LightBulbSolid,
} from '@heroicons/react/24/solid';

export interface FeedEngagementProps {
  readonly topicId: string;
  readonly eye: number;
  readonly lightbulb: number;
  readonly comments: number;
  readonly className?: string;
  readonly testIdPrefix?: string;
  readonly ariaLabel?: string;
  readonly compact?: boolean;
}

export function formatEngagementMetric(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value
    .toFixed(2)
    .replace(/\.?0+$/, '');
}

export const FeedEngagement: React.FC<FeedEngagementProps> = ({
  topicId,
  eye,
  lightbulb,
  comments,
  className,
  testIdPrefix = 'news-card',
  ariaLabel = 'Story engagement',
  compact = false,
}) => {
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const glowStyle =
    prefersReducedMotion
      ? undefined
      : {
          filter:
            'drop-shadow(var(--icon-shadow-x) var(--icon-shadow-y) var(--icon-shadow-blur) var(--icon-shadow)) ' +
            'drop-shadow(0 0 4px var(--icon-glow)) drop-shadow(0 0 8px var(--icon-glow))',
        };

  const iconBaseClass = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const pillClass = compact
    ? 'inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 px-2 py-0.5 font-medium text-slate-600 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300'
    : 'inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 font-medium text-slate-600 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300';
  const labelClass = compact
    ? 'sr-only'
    : 'text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500';
  const eyeLabel = formatEngagementMetric(eye);
  const lightbulbLabel = formatEngagementMetric(lightbulb);
  const commentsLabel = formatEngagementMetric(comments);

  return (
    <div
      className={`mt-4 flex flex-wrap items-center gap-2 text-xs ${className ?? ''}`.trim()}
      style={{ color: 'var(--headline-card-muted)' }}
      data-testid={`${testIdPrefix}-engagement-${topicId}`}
      aria-label={ariaLabel}
    >
      <span
        data-testid={`${testIdPrefix}-eye-${topicId}`}
        className={pillClass}
      >
        {eye > 0 ? (
          <EyeSolid
            className={iconBaseClass}
            style={{ color: 'var(--icon-engaged)', ...glowStyle }}
            data-testid={`${testIdPrefix}-eye-icon-engaged-${topicId}`}
            aria-hidden="true"
          />
        ) : (
          <EyeOutline
            className={iconBaseClass}
            style={{ color: 'var(--icon-default)' }}
            data-testid={`${testIdPrefix}-eye-icon-default-${topicId}`}
            aria-hidden="true"
          />
        )}
        <span>{eyeLabel}</span>
        <span className={labelClass}>
          Watching
        </span>
      </span>

      <span
        data-testid={`${testIdPrefix}-lightbulb-${topicId}`}
        className={pillClass}
      >
        {lightbulb > 0 ? (
          <LightBulbSolid
            className={iconBaseClass}
            style={{ color: 'var(--icon-engaged)', ...glowStyle }}
            data-testid={`${testIdPrefix}-lightbulb-icon-engaged-${topicId}`}
            aria-hidden="true"
          />
        ) : (
          <LightBulbOutline
            className={iconBaseClass}
            style={{ color: 'var(--icon-default)' }}
            data-testid={`${testIdPrefix}-lightbulb-icon-default-${topicId}`}
            aria-hidden="true"
          />
        )}
        <span>{lightbulbLabel}</span>
        <span className={labelClass}>
          Stances
        </span>
      </span>

      <span
        data-testid={`${testIdPrefix}-comments-${topicId}`}
        className={pillClass}
      >
        {comments > 0 ? (
          <ChatBubbleLeftRightSolid
            className={iconBaseClass}
            style={{ color: 'var(--icon-engaged)', ...glowStyle }}
            data-testid={`${testIdPrefix}-comments-icon-engaged-${topicId}`}
            aria-hidden="true"
          />
        ) : (
          <ChatBubbleLeftRightOutline
            className={iconBaseClass}
            style={{ color: 'var(--icon-default)' }}
            data-testid={`${testIdPrefix}-comments-icon-default-${topicId}`}
            aria-hidden="true"
          />
        )}
        <span>{commentsLabel}</span>
        <span className={labelClass}>
          Replies
        </span>
      </span>
    </div>
  );
};

export default FeedEngagement;
