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
}

export const FeedEngagement: React.FC<FeedEngagementProps> = ({
  topicId,
  eye,
  lightbulb,
  comments,
  className,
  testIdPrefix = 'news-card',
  ariaLabel = 'Story engagement',
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

  const iconBaseClass = 'h-4 w-4';

  return (
    <div
      className={`mt-4 flex flex-wrap items-center gap-2 text-xs ${className ?? ''}`.trim()}
      style={{ color: 'var(--headline-card-muted)' }}
      data-testid={`${testIdPrefix}-engagement-${topicId}`}
      aria-label={ariaLabel}
    >
      <span
        data-testid={`${testIdPrefix}-eye-${topicId}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 font-medium text-slate-600 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
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
        <span>{eye}</span>
        <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          Watching
        </span>
      </span>

      <span
        data-testid={`${testIdPrefix}-lightbulb-${topicId}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 font-medium text-slate-600 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
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
        <span>{lightbulb}</span>
        <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          Stances
        </span>
      </span>

      <span
        data-testid={`${testIdPrefix}-comments-${topicId}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 font-medium text-slate-600 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
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
        <span>{comments}</span>
        <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          Replies
        </span>
      </span>
    </div>
  );
};

export default FeedEngagement;
