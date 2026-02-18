/* @vitest-environment jsdom */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlippableCard } from './FlippableCard';

const createMatchMedia = (matches: boolean) =>
  vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

const Wrapper = ({
  showDefaultControls,
  flipToBackLabel,
  flipToFrontLabel,
}: {
  showDefaultControls?: boolean;
  flipToBackLabel?: string;
  flipToFrontLabel?: string;
}) => {
  const [flipped, setFlipped] = useState(false);
  return (
    <FlippableCard
      front={<div>Front Face</div>}
      back={<div>Back Face</div>}
      isFlipped={flipped}
      onFlip={() => setFlipped((prev) => !prev)}
      showDefaultControls={showDefaultControls}
      flipToBackLabel={flipToBackLabel}
      flipToFrontLabel={flipToFrontLabel}
    />
  );
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FlippableCard', () => {
  it('toggles between front and back faces with default controls', () => {
    render(<Wrapper />);

    expect(screen.getByTestId('flip-front')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByTestId('flip-back')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('💬 Discuss in Forum')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('flip-to-forum'));
    expect(screen.getByTestId('flip-front')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('flip-back')).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(screen.getByTestId('flip-to-analysis'));
    expect(screen.getByTestId('flip-front')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByTestId('flip-back')).toHaveAttribute('aria-hidden', 'true');
  });

  it('supports custom flip button labels', () => {
    render(
      <Wrapper
        flipToBackLabel="Open perspective lens"
        flipToFrontLabel="Return to headline"
      />,
    );

    expect(screen.getByText('Open perspective lens')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('flip-to-forum'));
    expect(screen.getByText('Return to headline')).toBeInTheDocument();
  });

  it('can hide default controls for external card handlers', () => {
    render(<Wrapper showDefaultControls={false} />);

    expect(screen.queryByTestId('flip-to-forum')).not.toBeInTheDocument();
    expect(screen.queryByTestId('flip-to-analysis')).not.toBeInTheDocument();
  });

  it('uses reduced-motion instant swap without rotate transforms', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: createMatchMedia(true),
    });

    render(<Wrapper />);

    const front = screen.getByTestId('flip-front');
    const back = screen.getByTestId('flip-back');

    expect(front).toHaveStyle({ transform: 'none', display: 'block', transition: 'none' });
    expect(back).toHaveStyle({ transform: 'none', display: 'none', transition: 'none' });

    fireEvent.click(screen.getByTestId('flip-to-forum'));

    expect(front).toHaveStyle({ display: 'none' });
    expect(back).toHaveStyle({ display: 'block' });
  });
});
