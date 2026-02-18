import React, { useMemo } from 'react';

interface FlippableCardProps {
  front: React.ReactNode;
  back: React.ReactNode;
  isFlipped: boolean;
  onFlip: () => void;
  showDefaultControls?: boolean;
  flipToBackLabel?: string;
  flipToFrontLabel?: string;
}

export const FlippableCard: React.FC<FlippableCardProps> = ({
  front,
  back,
  isFlipped,
  onFlip,
  showDefaultControls = true,
  flipToBackLabel = '💬 Discuss in Forum',
  flipToFrontLabel = '← Back to Analysis',
}) => {
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const borderlessButton =
    'px-4 py-2 rounded-lg shadow-sm hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-500';

  const containerStyle: React.CSSProperties = prefersReducedMotion
    ? { display: 'grid' }
    : { display: 'grid', perspective: '1000px' };

  const frontStyle: React.CSSProperties = prefersReducedMotion
    ? {
        gridArea: '1 / 1',
        display: isFlipped ? 'none' : 'block',
        transform: 'none',
        transition: 'none',
      }
    : {
        gridArea: '1 / 1',
        backfaceVisibility: 'hidden',
        transform: isFlipped ? 'rotateY(-180deg)' : 'rotateY(0deg)',
        visibility: isFlipped ? 'hidden' : 'visible',
        transition: 'transform 0.6s ease-in-out, visibility 0s linear 0.3s',
        transformStyle: 'preserve-3d',
        pointerEvents: isFlipped ? 'none' : 'auto',
      };

  const backStyle: React.CSSProperties = prefersReducedMotion
    ? {
        gridArea: '1 / 1',
        display: isFlipped ? 'block' : 'none',
        transform: 'none',
        transition: 'none',
      }
    : {
        gridArea: '1 / 1',
        backfaceVisibility: 'hidden',
        transform: isFlipped ? 'rotateY(0deg)' : 'rotateY(180deg)',
        visibility: isFlipped ? 'visible' : 'hidden',
        transition: 'transform 0.6s ease-in-out, visibility 0s linear 0.3s',
        transformStyle: 'preserve-3d',
        pointerEvents: isFlipped ? 'auto' : 'none',
      };

  return (
    <div data-testid="flippable-card">
      <div className="flip-container" style={containerStyle}>
        <div className="flip-front" style={frontStyle} aria-hidden={isFlipped} data-testid="flip-front">
          {front}
          {showDefaultControls && (
            <div className="mt-3">
              <button
                className={borderlessButton}
                onClick={onFlip}
                aria-expanded={isFlipped}
                data-testid="flip-to-forum"
                style={{
                  backgroundColor: 'var(--btn-secondary-bg)',
                  color: 'var(--btn-secondary-text)',
                }}
              >
                {flipToBackLabel}
              </button>
            </div>
          )}
        </div>

        <div className="flip-back" style={backStyle} aria-hidden={!isFlipped} data-testid="flip-back">
          {back}
          {showDefaultControls && (
            <div className="mt-3">
              <button
                className={borderlessButton}
                onClick={onFlip}
                aria-expanded={!isFlipped}
                data-testid="flip-to-analysis"
                style={{
                  backgroundColor: 'var(--btn-secondary-bg)',
                  color: 'var(--btn-secondary-text)',
                }}
              >
                {flipToFrontLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FlippableCard;
