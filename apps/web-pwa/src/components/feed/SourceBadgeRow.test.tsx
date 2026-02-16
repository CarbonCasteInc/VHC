/* @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceBadgeRow } from './SourceBadgeRow';

const threeSources = [
  { source_id: 'fox-latest', publisher: 'Fox News' },
  { source_id: 'guardian-us', publisher: 'The Guardian' },
  { source_id: 'bbc-general', publisher: 'BBC News' },
];

describe('SourceBadgeRow', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when sources is empty', () => {
    const { container } = render(<SourceBadgeRow sources={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders correct number of badges', () => {
    render(<SourceBadgeRow sources={threeSources} />);
    expect(screen.getByTestId('source-badge-fox-latest')).toBeTruthy();
    expect(screen.getByTestId('source-badge-guardian-us')).toBeTruthy();
    expect(screen.getByTestId('source-badge-bbc-general')).toBeTruthy();
  });

  it('has data-testid on the row', () => {
    render(<SourceBadgeRow sources={threeSources} />);
    expect(screen.getByTestId('source-badge-row')).toBeTruthy();
  });

  it('has aria-label with source count', () => {
    render(<SourceBadgeRow sources={threeSources} />);
    expect(screen.getByLabelText('3 sources')).toBeTruthy();
  });

  it('shows singular label for 1 source', () => {
    render(
      <SourceBadgeRow sources={[{ source_id: 'x', publisher: 'X' }]} />,
    );
    expect(screen.getByLabelText('1 source')).toBeTruthy();
  });

  it('shows overflow indicator when sources exceed maxVisible', () => {
    const manySources = Array.from({ length: 8 }, (_, i) => ({
      source_id: `src-${i}`,
      publisher: `Publisher ${i}`,
    }));
    render(<SourceBadgeRow sources={manySources} maxVisible={5} />);
    expect(screen.getByTestId('source-badge-overflow')).toBeTruthy();
    expect(screen.getByText('+3 more')).toBeTruthy();
  });

  it('does not show overflow when within maxVisible', () => {
    render(<SourceBadgeRow sources={threeSources} maxVisible={5} />);
    expect(screen.queryByTestId('source-badge-overflow')).toBeNull();
  });

  it('respects custom maxVisible', () => {
    render(<SourceBadgeRow sources={threeSources} maxVisible={2} />);
    expect(screen.getByText('+1 more')).toBeTruthy();
  });
});
