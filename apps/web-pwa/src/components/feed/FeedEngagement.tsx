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
}

export const FeedEngagement: React.FC<FeedEngagementProps> = ({
  topicId,
  eye,
  lightbulb,
  comments,
  className,
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
      className={`mt-4 flex flex-wrap items-center gap-4 text-xs ${className ?? ''}`.trim()}
      style={{ color: 'var(--headline-card-muted)' }}
      data-testid={`news-card-engagement-${topicId}`}
      aria-label="Story engagement"
    >
      <span data-testid={`news-card-eye-${topicId}`} className="inline-flex items-center gap-1">
        {eye > 0 ? (
          <EyeSolid
            className={iconBaseClass}
            style={{ color: 'var(--icon-engaged)', ...glowStyle }}
            data-testid={`news-card-eye-icon-engaged-${topicId}`}
            aria-hidden="true"
          />
        ) : (
          <EyeOutline
            className={iconBaseClass}
            style={{ color: 'var(--icon-default)' }}
            data-testid={`news-card-eye-icon-default-${topicId}`}
            aria-hidden="true"
          />
        )}
        {eye}
      </span>

      <span data-testid={`news-card-lightbulb-${topicId}`} className="inline-flex items-center gap-1">
        {lightbulb > 0 ? (
          <LightBulbSolid
            className={iconBaseClass}
            style={{ color: 'var(--icon-engaged)', ...glowStyle }}
            data-testid={`news-card-lightbulb-icon-engaged-${topicId}`}
            aria-hidden="true"
          />
        ) : (
          <LightBulbOutline
            className={iconBaseClass}
            style={{ color: 'var(--icon-default)' }}
            data-testid={`news-card-lightbulb-icon-default-${topicId}`}
            aria-hidden="true"
          />
        )}
        {lightbulb}
      </span>

      <span data-testid={`news-card-comments-${topicId}`} className="inline-flex items-center gap-1">
        {comments > 0 ? (
          <ChatBubbleLeftRightSolid
            className={iconBaseClass}
            style={{ color: 'var(--icon-engaged)', ...glowStyle }}
            data-testid={`news-card-comments-icon-engaged-${topicId}`}
            aria-hidden="true"
          />
        ) : (
          <ChatBubbleLeftRightOutline
            className={iconBaseClass}
            style={{ color: 'var(--icon-default)' }}
            data-testid={`news-card-comments-icon-default-${topicId}`}
            aria-hidden="true"
          />
        )}
        {comments}
      </span>
    </div>
  );
};

export default FeedEngagement;
