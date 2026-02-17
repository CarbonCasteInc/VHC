/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { NewsCardSourceAnalysis } from './newsCardAnalysis';
import { BiasTable } from './BiasTable';

function makeAnalysis(overrides: Partial<NewsCardSourceAnalysis> = {}): NewsCardSourceAnalysis {
  return {
    source_id: 'src-1',
    publisher: 'Reuters',
    url: 'https://reuters.com/1',
    summary: 'A concise summary.',
    biases: ['Urgency framing'],
    counterpoints: ['Phased approach is safer'],
    biasClaimQuotes: ['We must act immediately'],
    justifyBiasClaims: ['Creates false urgency without evidence'],
    provider_id: 'openai',
    model_id: 'gpt-4o-mini',
    ...overrides,
  };
}

const FRAMES = [
  { frame: 'Reuters: Urgency framing', reframe: 'Phased approach is safer' },
  { frame: 'AP News: Cost overrun risk', reframe: 'Budget controls exist' },
];

describe('BiasTable', () => {
  afterEach(() => cleanup());

  it('renders frame and reframe columns with data', () => {
    const analyses = [makeAnalysis()];
    render(<BiasTable analyses={analyses} frames={FRAMES} />);
    expect(screen.getByTestId('bias-table')).toBeInTheDocument();
    expect(screen.getByText('Frame')).toBeInTheDocument();
    expect(screen.getByText('Reframe')).toBeInTheDocument();
    expect(screen.getByText('Reuters: Urgency framing')).toBeInTheDocument();
    expect(screen.getByText('Phased approach is safer')).toBeInTheDocument();
    expect(screen.getByText('AP News: Cost overrun risk')).toBeInTheDocument();
    expect(screen.getByText('Budget controls exist')).toBeInTheDocument();
  });

  it('shows publisher attribution via frame text', () => {
    const analyses = [makeAnalysis()];
    render(<BiasTable analyses={analyses} frames={FRAMES} />);
    expect(screen.getByTestId('bias-table-row-0')).toHaveTextContent('Reuters:');
    expect(screen.getByTestId('bias-table-row-1')).toHaveTextContent('AP News:');
  });

  it('shows source count header', () => {
    const analyses = [
      makeAnalysis(),
      makeAnalysis({ source_id: 'src-2', publisher: 'AP News' }),
      makeAnalysis({ source_id: 'src-3', publisher: 'BBC' }),
    ];
    render(<BiasTable analyses={analyses} frames={FRAMES} />);
    expect(screen.getByTestId('bias-table-source-count')).toHaveTextContent('3 sources analyzed');
  });

  it('shows singular source count', () => {
    render(<BiasTable analyses={[makeAnalysis()]} frames={FRAMES} />);
    expect(screen.getByTestId('bias-table-source-count')).toHaveTextContent('1 source analyzed');
  });

  it('shows provider provenance badge', () => {
    render(
      <BiasTable analyses={[makeAnalysis()]} frames={FRAMES} providerLabel="gpt-4o-mini" />,
    );
    expect(screen.getByTestId('bias-table-provider-badge')).toHaveTextContent(
      'Analysis by gpt-4o-mini',
    );
  });

  it('omits provider badge when no providerLabel', () => {
    render(<BiasTable analyses={[makeAnalysis()]} frames={FRAMES} />);
    expect(screen.queryByTestId('bias-table-provider-badge')).not.toBeInTheDocument();
  });

  it('renders empty state when no analyses and no frames', () => {
    render(<BiasTable analyses={[]} frames={[]} />);
    expect(screen.getByTestId('bias-table-empty')).toHaveTextContent(
      'No bias analysis available yet',
    );
    expect(screen.queryByTestId('bias-table')).not.toBeInTheDocument();
  });

  it('renders loading skeleton rows', () => {
    render(<BiasTable analyses={[]} frames={[]} loading />);
    expect(screen.getByTestId('bias-table-skeleton-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('bias-table-skeleton-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('bias-table-skeleton-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('bias-table-empty')).not.toBeInTheDocument();
  });

  it('expands row to show bias claim quotes and justification', () => {
    const analyses = [makeAnalysis()];
    render(<BiasTable analyses={analyses} frames={[FRAMES[0]!]} />);
    const row = screen.getByTestId('bias-table-row-0');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('bias-table-detail-0')).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByTestId('bias-table-detail-0');
    expect(detail).toHaveTextContent('We must act immediately');
    expect(detail).toHaveTextContent('Creates false urgency without evidence');

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('bias-table-detail-0')).not.toBeInTheDocument();
  });

  it('does not make rows expandable when no detail data exists', () => {
    const analyses = [
      makeAnalysis({ biasClaimQuotes: [], justifyBiasClaims: [] }),
    ];
    render(<BiasTable analyses={analyses} frames={[FRAMES[0]!]} />);
    const row = screen.getByTestId('bias-table-row-0');
    expect(row).not.toHaveAttribute('aria-expanded');
    fireEvent.click(row);
    expect(screen.queryByTestId('bias-table-detail-0')).not.toBeInTheDocument();
  });

  it('shows table with frames even when analyses is empty', () => {
    render(<BiasTable analyses={[]} frames={FRAMES} />);
    expect(screen.getByTestId('bias-table')).toBeInTheDocument();
    expect(screen.getByText('Reuters: Urgency framing')).toBeInTheDocument();
    expect(screen.getByTestId('bias-table-source-count')).toHaveTextContent('0 sources analyzed');
  });
});
