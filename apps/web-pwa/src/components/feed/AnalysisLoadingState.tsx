import React, { useEffect, useState } from 'react';

const STAGED_MESSAGES = [
  'Extracting article text…',
  'Analyzing perspectives and bias…',
  'Generating balanced summary…',
  'Almost ready…',
] as const;

const ROTATION_INTERVAL_MS = 4_500;

export interface AnalysisLoadingStateProps {
  status: 'loading' | 'timeout' | 'error' | 'budget_exceeded';
  error: string | null;
  onRetry: () => void;
}

function resolveStatusMessage(
  status: Exclude<AnalysisLoadingStateProps['status'], 'loading'>,
  error: string | null,
): string {
  if (status === 'timeout') {
    return 'Analysis timed out. The server may be busy.';
  }

  if (status === 'budget_exceeded') {
    return 'Daily analysis limit reached. Try again tomorrow.';
  }

  return error?.trim() || 'Analysis failed. Please retry.';
}

export const AnalysisLoadingState: React.FC<AnalysisLoadingStateProps> = ({
  status,
  error,
  onRetry,
}) => {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (status !== 'loading') {
      setMessageIndex(0);
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      setMessageIndex((current) => (current + 1) % STAGED_MESSAGES.length);
    }, ROTATION_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [status]);

  const message = status === 'loading'
    ? STAGED_MESSAGES[messageIndex]
    : resolveStatusMessage(status, error);

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <p
        className="text-xs text-slate-700"
        aria-live="polite"
        data-testid="analysis-status-message"
      >
        {message}
      </p>

      {status !== 'loading' && (
        <button
          type="button"
          className="text-xs font-medium text-violet-700 underline-offset-2 hover:underline"
          onClick={onRetry}
          data-testid="analysis-retry-button"
        >
          Retry
        </button>
      )}
    </div>
  );
};

export default AnalysisLoadingState;
