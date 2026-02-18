import React from 'react';

export interface RemovalIndicatorProps {
  /** Reason the article was removed (e.g. "extraction-failed-permanently"). */
  readonly reason: string;
  /** Optional callback to dismiss the indicator. */
  readonly onDismiss?: () => void;
}

const REASON_LABELS: Record<string, string> = {
  'extraction-failed-permanently': 'Article text could not be extracted after multiple attempts.',
  'removed-by-policy': 'This article was removed by content policy.',
};

function labelForReason(reason: string): string {
  return REASON_LABELS[reason] ?? 'Article text could not be extracted after multiple attempts.';
}

/**
 * Brief card shown when a story has been removed from the feed.
 * Accessible via role="status" + aria-live for screen readers.
 */
export const RemovalIndicator: React.FC<RemovalIndicatorProps> = ({ reason, onDismiss }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="removal-indicator"
      className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-sm"
    >
      <p className="text-sm text-amber-800" data-testid="removal-indicator-reason">
        {labelForReason(reason)}
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          data-testid="removal-indicator-dismiss"
          className="ml-2 rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
          aria-label="Dismiss removal notice"
        >
          Dismiss
        </button>
      )}
    </div>
  );
};

export default RemovalIndicator;
