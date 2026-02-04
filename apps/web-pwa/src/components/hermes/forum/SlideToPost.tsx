import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
}

export const SlideToPost: React.FC<Props> = ({ value, onChange, onCommit, disabled = false }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const cleanupMouseListenersRef = useRef<null | (() => void)>(null);
  const disabledRef = useRef(disabled);
  const lastValueRef = useRef(value);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    lastValueRef.current = value;
  }, [value]);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const getLabel = (pos: number): string => {
    if (pos <= 15) return 'Strong Support';
    if (pos <= 30) return 'Support';
    if (pos >= 85) return 'Strong Oppose';
    if (pos >= 70) return 'Oppose';
    return 'Discuss';
  };

  const getThumbColor = (pos: number): string => {
    if (pos <= 30) return 'var(--concur-button)';
    if (pos >= 70) return 'var(--counter-button)';
    return 'var(--discuss-button)';
  };

  const getPositionFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 50;
    const rect = track.getBoundingClientRect();
    if (!rect.width || rect.width <= 0) return 50;
    const x = clientX - rect.left;
    const pct = (x / rect.width) * 100;
    return Math.max(0, Math.min(100, pct));
  }, []);

  const endDrag = useCallback(() => {
    setIsDragging(false);
    cleanupMouseListenersRef.current?.();
    cleanupMouseListenersRef.current = null;
  }, []);

  const setValue = useCallback(
    (next: number) => {
      lastValueRef.current = next;
      onChange(next);
    },
    [onChange]
  );

  const startMouseDrag = useCallback(
    (clientX: number) => {
      if (disabledRef.current) return;
      setIsDragging(true);
      
      const next = getPositionFromClientX(clientX);
      setValue(next);

      const onMouseMove = (e: MouseEvent) => {
        setValue(getPositionFromClientX(e.clientX));
      };
      const onMouseUp = () => {
        onCommit?.(lastValueRef.current);
        endDrag();
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      cleanupMouseListenersRef.current = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
    },
    [endDrag, getPositionFromClientX, onCommit, setValue]
  );

  useEffect(() => {
    return () => {
      cleanupMouseListenersRef.current?.();
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startMouseDrag(e.clientX);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    setIsDragging(true);
    setValue(getPositionFromClientX(e.touches[0].clientX));
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    setValue(getPositionFromClientX(e.touches[0].clientX));
  };

  const onTouchEnd = () => {
    if (!isDragging) return;
    onCommit?.(lastValueRef.current);
    endDrag();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setValue(Math.max(0, value - 10));
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setValue(Math.min(100, value + 10));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCommit?.(lastValueRef.current);
      return;
    }
  };

  const thumbColor = getThumbColor(value);
  const label = getLabel(value);

  return (
    <div
      ref={trackRef}
      className={[
        'relative h-12 select-none overflow-hidden rounded-full',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        !prefersReducedMotion && isDragging ? 'scale-[1.02]' : '',
        !prefersReducedMotion ? 'transition-transform duration-150' : ''
      ].join(' ')}
      style={{
        background: `linear-gradient(to right,
          var(--concur-button) 0%,
          var(--concur-button) 25%,
          var(--discuss-button) 50%,
          var(--counter-button) 75%,
          var(--counter-button) 100%)`
      }}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKeyDown}
      role="slider"
      aria-label="Select stance. Left for support, right for oppose, center for discuss."
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={label}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      data-testid="slide-to-post"
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-4 text-xs font-medium text-white/80">
        <span>◀ Support</span>
        <span>Oppose ▶</span>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span
          className={[
            'text-sm font-semibold text-white',
            !prefersReducedMotion ? 'transition-opacity duration-150' : '',
            isDragging ? 'opacity-0' : 'opacity-100'
          ].join(' ')}
          data-testid="slide-label-idle"
        >
          {label}
        </span>

        <span
          className={[
            'absolute text-sm font-bold text-white',
            !prefersReducedMotion ? 'transition-opacity duration-100' : '',
            isDragging ? 'opacity-100' : 'opacity-0'
          ].join(' ')}
          data-testid="slide-label-active"
        >
          {label}
        </span>
      </div>

      <div
        className={[
          'pointer-events-none absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white',
          !prefersReducedMotion ? 'transition-all duration-75' : '',
          !prefersReducedMotion && isDragging ? 'scale-110' : ''
        ].join(' ')}
        style={{
          left: `calc(${value}% - 20px)`,
          borderWidth: '3px',
          borderColor: thumbColor,
          boxShadow:
            isDragging && !prefersReducedMotion
              ? `0 0 16px ${thumbColor}, 0 4px 12px rgba(0,0,0,0.3)`
              : '0 2px 8px rgba(0,0,0,0.2)'
        }}
        data-testid="slide-thumb"
      >
        <div className="flex gap-0.5">
          <div className="h-4 w-0.5 rounded-full" style={{ backgroundColor: thumbColor }} />
          <div className="h-4 w-0.5 rounded-full" style={{ backgroundColor: thumbColor }} />
          <div className="h-4 w-0.5 rounded-full" style={{ backgroundColor: thumbColor }} />
        </div>
      </div>
    </div>
  );
};

export default SlideToPost;
