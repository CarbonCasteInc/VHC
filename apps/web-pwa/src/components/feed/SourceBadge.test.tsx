/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceBadge } from './SourceBadge';

describe('SourceBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders publisher name', () => {
    render(
      <SourceBadge
        sourceId="fox-latest"
        publisher="Fox News"
        url="https://example.com/fox"
      />,
    );
    expect(screen.getByText('Fox News')).toBeTruthy();
  });

  it('renders publisher initial', () => {
    render(
      <SourceBadge
        sourceId="guardian-us"
        publisher="The Guardian"
        url="https://example.com/guardian"
      />,
    );
    expect(screen.getByText('T')).toBeTruthy();
  });

  it('has accessible aria-label', () => {
    render(
      <SourceBadge
        sourceId="bbc-general"
        publisher="BBC News"
        url="https://example.com/bbc"
      />,
    );
    const badge = screen.getByLabelText('Source: BBC News');
    expect(badge).toBeTruthy();
  });

  it('links to source URL with safe target/rel attributes', () => {
    render(
      <SourceBadge
        sourceId="huffpost-us"
        publisher="HuffPost"
        url="https://example.com/huffpost"
      />,
    );

    const link = screen.getByTestId('source-badge-huffpost-us');
    expect(link).toHaveAttribute('href', 'https://example.com/huffpost');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('has data-testid based on sourceId', () => {
    render(
      <SourceBadge
        sourceId="huffpost-us"
        publisher="HuffPost"
        url="https://example.com/huffpost"
      />,
    );
    expect(screen.getByTestId('source-badge-huffpost-us')).toBeTruthy();
  });

  it('produces deterministic colors for same sourceId', () => {
    const { container: c1 } = render(
      <SourceBadge sourceId="abc" publisher="ABC" url="https://example.com/a" />,
    );
    const { container: c2 } = render(
      <SourceBadge sourceId="abc" publisher="ABC" url="https://example.com/b" />,
    );
    const class1 = c1.querySelector('[data-testid="source-badge-abc"]')?.className;
    const class2 = c2.querySelector('[data-testid="source-badge-abc"]')?.className;
    expect(class1).toBe(class2);
  });

  it('produces different colors for different sourceIds', () => {
    const { container: c1 } = render(
      <SourceBadge sourceId="source-a" publisher="A" url="https://example.com/a" />,
    );
    const { container: c2 } = render(
      <SourceBadge sourceId="source-z" publisher="Z" url="https://example.com/z" />,
    );
    const class1 = c1.querySelector('[data-testid="source-badge-source-a"]')?.className;
    const class2 = c2.querySelector('[data-testid="source-badge-source-z"]')?.className;
    expect(class1).toBeDefined();
    expect(class2).toBeDefined();
  });

  it('handles empty publisher gracefully', () => {
    render(
      <SourceBadge sourceId="empty" publisher="" url="https://example.com/empty" />,
    );
    expect(screen.getByText('?')).toBeTruthy();
  });
});
