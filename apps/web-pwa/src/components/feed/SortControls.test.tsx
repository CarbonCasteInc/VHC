/* @vitest-environment jsdom */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { SortControls } from './SortControls';
import type { SortMode } from '@vh/data-model';

describe('SortControls', () => {
  afterEach(() => cleanup());

  it('renders all three sort mode buttons', () => {
    render(<SortControls active="LATEST" onSelect={vi.fn()} />);
    expect(screen.getByTestId('sort-mode-LATEST')).toBeInTheDocument();
    expect(screen.getByTestId('sort-mode-HOTTEST')).toBeInTheDocument();
    expect(screen.getByTestId('sort-mode-MY_ACTIVITY')).toBeInTheDocument();
  });

  it('displays correct labels', () => {
    render(<SortControls active="LATEST" onSelect={vi.fn()} />);
    expect(screen.getByText('Latest')).toBeInTheDocument();
    expect(screen.getByText('Hottest')).toBeInTheDocument();
    expect(screen.getByText('My Activity')).toBeInTheDocument();
  });

  it('marks the active mode with aria-pressed=true', () => {
    render(<SortControls active="HOTTEST" onSelect={vi.fn()} />);
    expect(screen.getByTestId('sort-mode-HOTTEST')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('sort-mode-LATEST')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('sort-mode-MY_ACTIVITY')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onSelect with the correct mode when clicked', () => {
    const onSelect = vi.fn<(mode: SortMode) => void>();
    render(<SortControls active="LATEST" onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('sort-mode-HOTTEST'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('HOTTEST');
  });

  it('calls onSelect for each mode type', () => {
    const onSelect = vi.fn<(mode: SortMode) => void>();
    render(<SortControls active="LATEST" onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('sort-mode-LATEST'));
    expect(onSelect).toHaveBeenCalledWith('LATEST');

    fireEvent.click(screen.getByTestId('sort-mode-MY_ACTIVITY'));
    expect(onSelect).toHaveBeenCalledWith('MY_ACTIVITY');

    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('applies active styling to the selected mode', () => {
    render(<SortControls active="MY_ACTIVITY" onSelect={vi.fn()} />);
    const active = screen.getByTestId('sort-mode-MY_ACTIVITY');
    expect(active.className).toContain('bg-blue-600');
    expect(active.className).toContain('text-white');
  });

  it('applies inactive styling to non-selected modes', () => {
    render(<SortControls active="MY_ACTIVITY" onSelect={vi.fn()} />);
    const inactive = screen.getByTestId('sort-mode-LATEST');
    expect(inactive.className).toContain('bg-slate-200');
    expect(inactive.className).toContain('text-slate-700');
  });

  it('has a group role with accessible label', () => {
    render(<SortControls active="LATEST" onSelect={vi.fn()} />);
    const group = screen.getByTestId('sort-controls');
    expect(group).toHaveAttribute('role', 'group');
    expect(group).toHaveAttribute('aria-label', 'Feed sort');
  });

  it('renders modes in spec order: LATEST, HOTTEST, MY_ACTIVITY', () => {
    render(<SortControls active="LATEST" onSelect={vi.fn()} />);
    const group = screen.getByTestId('sort-controls');
    const buttons = group.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAttribute('data-testid', 'sort-mode-LATEST');
    expect(buttons[1]).toHaveAttribute('data-testid', 'sort-mode-HOTTEST');
    expect(buttons[2]).toHaveAttribute('data-testid', 'sort-mode-MY_ACTIVITY');
  });
});
