/* @vitest-environment jsdom */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { FilterChips } from './FilterChips';
import type { FilterChip } from '@vh/data-model';

describe('FilterChips', () => {
  afterEach(() => cleanup());

  it('renders all four filter chips', () => {
    render(<FilterChips active="ALL" onSelect={vi.fn()} />);
    expect(screen.getByTestId('filter-chip-ALL')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-NEWS')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-TOPICS')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-SOCIAL')).toBeInTheDocument();
  });

  it('displays correct labels', () => {
    render(<FilterChips active="ALL" onSelect={vi.fn()} />);
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('News')).toBeInTheDocument();
    expect(screen.getByText('Topics')).toBeInTheDocument();
    expect(screen.getByText('Social')).toBeInTheDocument();
  });

  it('marks the active chip with aria-pressed=true', () => {
    render(<FilterChips active="NEWS" onSelect={vi.fn()} />);
    expect(screen.getByTestId('filter-chip-NEWS')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('filter-chip-ALL')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('filter-chip-TOPICS')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('filter-chip-SOCIAL')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onSelect with the correct chip when clicked', () => {
    const onSelect = vi.fn<(chip: FilterChip) => void>();
    render(<FilterChips active="ALL" onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('filter-chip-TOPICS'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('TOPICS');
  });

  it('calls onSelect for each chip type', () => {
    const onSelect = vi.fn<(chip: FilterChip) => void>();
    render(<FilterChips active="ALL" onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('filter-chip-NEWS'));
    expect(onSelect).toHaveBeenCalledWith('NEWS');

    fireEvent.click(screen.getByTestId('filter-chip-SOCIAL'));
    expect(onSelect).toHaveBeenCalledWith('SOCIAL');

    fireEvent.click(screen.getByTestId('filter-chip-ALL'));
    expect(onSelect).toHaveBeenCalledWith('ALL');

    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('applies active styling to the selected chip', () => {
    render(<FilterChips active="SOCIAL" onSelect={vi.fn()} />);
    const activeChip = screen.getByTestId('filter-chip-SOCIAL');
    expect(activeChip.className).toContain('bg-blue-600');
    expect(activeChip.className).toContain('text-white');
  });

  it('applies inactive styling to non-selected chips', () => {
    render(<FilterChips active="SOCIAL" onSelect={vi.fn()} />);
    const inactiveChip = screen.getByTestId('filter-chip-ALL');
    expect(inactiveChip.className).toContain('bg-slate-200');
    expect(inactiveChip.className).toContain('text-slate-700');
  });

  it('has a group role with accessible label', () => {
    render(<FilterChips active="ALL" onSelect={vi.fn()} />);
    const group = screen.getByTestId('filter-chips');
    expect(group).toHaveAttribute('role', 'group');
    expect(group).toHaveAttribute('aria-label', 'Feed filter');
  });

  it('renders chips in spec order: ALL, NEWS, TOPICS, SOCIAL', () => {
    render(<FilterChips active="ALL" onSelect={vi.fn()} />);
    const group = screen.getByTestId('filter-chips');
    const buttons = group.querySelectorAll('button');
    expect(buttons).toHaveLength(4);
    expect(buttons[0]).toHaveAttribute('data-testid', 'filter-chip-ALL');
    expect(buttons[1]).toHaveAttribute('data-testid', 'filter-chip-NEWS');
    expect(buttons[2]).toHaveAttribute('data-testid', 'filter-chip-TOPICS');
    expect(buttons[3]).toHaveAttribute('data-testid', 'filter-chip-SOCIAL');
  });
});
