/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisFeedCard } from './AnalysisFeedCard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

const BASE_ITEM = {
  schemaVersion: 'canonical-analysis-v1' as const,
  url: 'https://example.com/story',
  urlHash: 'hash-1',
  summary: 'Summary text',
  bias_claim_quote: ['quote'],
  justify_bias_claim: ['reason'],
  biases: ['bias'],
  counterpoints: ['counter'],
  sentimentScore: 0,
  timestamp: 1_700_000_000_000,
};

afterEach(() => {
  cleanup();
});

describe('AnalysisFeedCard', () => {
  it('surfaces provider provenance when engine metadata exists', () => {
    const onShare = vi.fn();

    render(
      <AnalysisFeedCard
        item={{
          ...BASE_ITEM,
          engine: { id: 'relay-provider', kind: 'remote', modelName: 'gpt-5.2' },
        }}
        onShare={onShare}
      />,
    );

    expect(screen.getByTestId('analysis-provider-hash-1')).toHaveTextContent(
      'Provider: relay-provider · gpt-5.2',
    );

    fireEvent.click(screen.getByTestId('share-hash-1'));
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('hides provider row when engine metadata is absent', () => {
    render(<AnalysisFeedCard item={BASE_ITEM} onShare={() => {}} />);
    expect(screen.queryByTestId('analysis-provider-hash-1')).not.toBeInTheDocument();
  });
});
