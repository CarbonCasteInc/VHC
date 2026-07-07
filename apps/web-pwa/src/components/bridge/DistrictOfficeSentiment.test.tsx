/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DistrictAggregateSummaryV1 } from '@vh/data-model';
import { DistrictOfficeSentiment } from './DistrictOfficeSentiment';
import type { UseDistrictAggregateResult } from '../../hooks/useDistrictAggregate';

let aggregateResult: UseDistrictAggregateResult = {
  summary: null,
  status: 'idle',
  minCohortSize: 100,
};

const useDistrictAggregateMock = vi.fn(() => aggregateResult);

vi.mock('../../hooks/useConstituencyProof', () => ({
  useConstituencyProof: () => ({
    proof: { district_hash: 'district-1', nullifier: 'n', merkle_root: 'r' },
  }),
}));

vi.mock('../../store/bridge/districtConfig', () => ({
  getConfiguredDistrict: () => 'configured-district',
}));

vi.mock('../../hooks/useDistrictAggregate', () => ({
  useDistrictAggregate: (params: unknown) => {
    useDistrictAggregateMock();
    return aggregateResult;
  },
}));

const READY_SUMMARY: DistrictAggregateSummaryV1 = {
  schema_version: 'district-aggregate-summary-v1',
  district_hash: 'district-1',
  office: 'house',
  topic_id: 'topic-1',
  synthesis_id: 'synth-1',
  epoch: 3,
  cohortSize: 150,
  points: [
    { point_id: 'point-1', agree: 90, disagree: 60 },
    { point_id: 'point-2', agree: 40, disagree: 20 },
  ],
  computed_at: 1_700_000_000_000,
  source_snapshot_version: 'point-aggregate-snapshot-v1',
};

beforeEach(() => {
  aggregateResult = { summary: null, status: 'idle', minCohortSize: 100 };
  useDistrictAggregateMock.mockClear();
});

afterEach(() => cleanup());

describe('DistrictOfficeSentiment', () => {
  it('renders beta-local participation blurb (E4 copy)', () => {
    render(<DistrictOfficeSentiment />);
    const blurb = screen.getByTestId('district-sentiment-blurb');
    expect(blurb.textContent).toMatch(/beta-local civic sentiment aggregate/i);
    expect(blurb.textContent).toMatch(/local\s+office/i);
  });

  it('renders "not enough local signal yet" for the withheld small-cell case', () => {
    aggregateResult = { summary: null, status: 'withheld', minCohortSize: 100 };
    render(<DistrictOfficeSentiment topicId="topic-1" synthesisId="synth-1" epoch={3} />);
    const withheld = screen.getByTestId('district-sentiment-withheld');
    expect(withheld.textContent).toMatch(/not enough local signal yet/i);
    // Never a small-cell count.
    expect(screen.queryByTestId('district-sentiment-points')).not.toBeInTheDocument();
  });

  it('renders office, district, and topic/synthesis/epoch context', () => {
    aggregateResult = { summary: READY_SUMMARY, status: 'ready', minCohortSize: 100 };
    render(<DistrictOfficeSentiment topicId="topic-1" synthesisId="synth-1" epoch={3} />);
    expect(screen.getByTestId('district-sentiment-office').textContent).toMatch(/House office/i);
    expect(screen.getByTestId('district-sentiment-district').textContent).toContain('district-1');
    const context = screen.getByTestId('district-sentiment-context').textContent ?? '';
    expect(context).toContain('topic-1');
    expect(context).toContain('synth-1');
    expect(context).toContain('3');
  });

  it('renders per-point agree/disagree counts', () => {
    aggregateResult = { summary: READY_SUMMARY, status: 'ready', minCohortSize: 100 };
    render(<DistrictOfficeSentiment topicId="topic-1" synthesisId="synth-1" epoch={3} />);
    expect(screen.getByTestId('district-sentiment-agree-point-1').textContent).toContain('90');
    expect(screen.getByTestId('district-sentiment-disagree-point-1').textContent).toContain('60');
    expect(screen.getByTestId('district-sentiment-agree-point-2').textContent).toContain('40');
    expect(screen.getByTestId('district-sentiment-disagree-point-2').textContent).toContain('20');
  });

  it('renders cohort size and threshold status', () => {
    aggregateResult = { summary: READY_SUMMARY, status: 'ready', minCohortSize: 100 };
    render(<DistrictOfficeSentiment topicId="topic-1" synthesisId="synth-1" epoch={3} />);
    const cohort = screen.getByTestId('district-sentiment-cohort').textContent ?? '';
    expect(cohort).toContain('150');
    expect(cohort).toContain('100');
  });

  it('renders computed time and source snapshot version', () => {
    aggregateResult = { summary: READY_SUMMARY, status: 'ready', minCohortSize: 100 };
    render(<DistrictOfficeSentiment topicId="topic-1" synthesisId="synth-1" epoch={3} />);
    const provenance = screen.getByTestId('district-sentiment-provenance').textContent ?? '';
    expect(provenance).toMatch(/Computed/i);
    expect(provenance).toContain('point-aggregate-snapshot-v1');
  });

  it('renders a loading state', () => {
    aggregateResult = { summary: null, status: 'loading', minCohortSize: 100 };
    render(<DistrictOfficeSentiment topicId="topic-1" synthesisId="synth-1" epoch={3} />);
    expect(screen.getByTestId('district-sentiment-loading')).toBeInTheDocument();
  });
});
