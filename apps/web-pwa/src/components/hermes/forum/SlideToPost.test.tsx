/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SlideToPost } from './SlideToPost';

describe('SlideToPost', () => {
  afterEach(() => cleanup());

  it('renders idle state', () => {
    render(<SlideToPost value={50} onChange={vi.fn()} />);
    expect(screen.getByTestId('slide-to-post')).toBeInTheDocument();
    expect(screen.getByTestId('slide-label-idle')).toHaveTextContent('Discuss');
  });

  it('is disabled when disabled prop is true', () => {
    render(<SlideToPost value={50} onChange={vi.fn()} disabled />);
    expect(screen.getByTestId('slide-to-post')).toHaveAttribute('aria-disabled', 'true');
  });

  it('calls onChange with center value when width is unavailable', () => {
    const onChange = vi.fn();
    render(<SlideToPost value={50} onChange={onChange} />);

    const track = screen.getByTestId('slide-to-post');
    fireEvent.mouseDown(track, { clientX: 192 });

    expect(onChange).toHaveBeenCalledWith(50);
  });

  it('calls onChange with a left-side value when clicked on left', () => {
    const onChange = vi.fn();
    render(<SlideToPost value={50} onChange={onChange} />);

    const track = screen.getByTestId('slide-to-post');
    Object.defineProperty(track, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 384 })
    });

    fireEvent.mouseDown(track, { clientX: 50 }); // ~13%

    const nextValue = onChange.mock.calls[0][0];
    expect(nextValue).toBeGreaterThanOrEqual(0);
    expect(nextValue).toBeLessThanOrEqual(30);
  });

  it('calls onCommit with the latest value on release', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<SlideToPost value={50} onChange={onChange} onCommit={onCommit} />);

    const track = screen.getByTestId('slide-to-post');
    Object.defineProperty(track, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 384 })
    });

    fireEvent.mouseDown(track, { clientX: 50 }); // ~13%
    fireEvent.mouseUp(document);

    expect(onCommit).toHaveBeenCalledWith(onChange.mock.calls[0][0]);
  });

  it('calls onChange with a right-side value when clicked on right', () => {
    const onChange = vi.fn();
    render(<SlideToPost value={50} onChange={onChange} />);

    const track = screen.getByTestId('slide-to-post');
    Object.defineProperty(track, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 384 })
    });

    fireEvent.mouseDown(track, { clientX: 330 }); // ~86%

    const nextValue = onChange.mock.calls[0][0];
    expect(nextValue).toBeGreaterThanOrEqual(70);
    expect(nextValue).toBeLessThanOrEqual(100);
  });

  it('supports keyboard navigation', () => {
    const onChange = vi.fn();
    render(<SlideToPost value={50} onChange={onChange} />);

    const track = screen.getByTestId('slide-to-post');
    track.focus();

    fireEvent.keyDown(track, { key: 'ArrowLeft' });
    fireEvent.keyDown(track, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith(40);
    expect(onChange).toHaveBeenCalledWith(60);
  });

  it('commits on Enter when enabled', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<SlideToPost value={50} onChange={onChange} onCommit={onCommit} />);

    const track = screen.getByTestId('slide-to-post');
    track.focus();

    fireEvent.keyDown(track, { key: 'ArrowRight' });
    fireEvent.keyDown(track, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith(60);
  });

  it('updates label based on value prop', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SlideToPost value={50} onChange={onChange} />);
    expect(screen.getByTestId('slide-label-idle')).toHaveTextContent('Discuss');

    rerender(<SlideToPost value={10} onChange={onChange} />);
    expect(screen.getByTestId('slide-label-idle')).toHaveTextContent('Strong Support');
  });

  it('has proper ARIA attributes', () => {
    render(<SlideToPost value={50} onChange={vi.fn()} />);
    const track = screen.getByTestId('slide-to-post');

    expect(track).toHaveAttribute('role', 'slider');
    expect(track).toHaveAttribute('aria-valuemin', '0');
    expect(track).toHaveAttribute('aria-valuemax', '100');
    expect(track).toHaveAttribute('aria-valuenow');
    expect(track).toHaveAttribute('aria-valuetext');
    expect(track).toHaveAttribute('tabIndex', '0');
  });
});
