/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { DistrictAggregateSummaryV1 } from '@vh/data-model';

const resolveClientFromAppStoreMock = vi.hoisted(() => vi.fn());
const readDistrictAggregateSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('../store/clientResolver', () => ({
  resolveClientFromAppStore: () => resolveClientFromAppStoreMock(),
}));

vi.mock('@vh/gun-client', () => ({
  readDistrictAggregateSummary: (...args: unknown[]) => readDistrictAggregateSummaryMock(...args),
}));

import { useDistrictAggregate, type UseDistrictAggregateParams } from './useDistrictAggregate';

function Harness(params: UseDistrictAggregateParams) {
  const { summary, status } = useDistrictAggregate(params);
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="cohort">{summary?.cohortSize ?? 'none'}</span>
    </div>
  );
}

const SUMMARY: DistrictAggregateSummaryV1 = {
  schema_version: 'district-aggregate-summary-v1',
  district_hash: 'district-1',
  office: 'house',
  topic_id: 'topic-1',
  synthesis_id: 'synth-1',
  epoch: 3,
  cohortSize: 150,
  points: [{ point_id: 'point-1', agree: 90, disagree: 60 }],
  computed_at: 1,
  source_snapshot_version: 'point-aggregate-snapshot-v1',
};

const TUPLE: UseDistrictAggregateParams = {
  topicId: 'topic-1',
  synthesisId: 'synth-1',
  epoch: 3,
  districtHash: 'district-1',
};

beforeEach(() => {
  resolveClientFromAppStoreMock.mockReset();
  readDistrictAggregateSummaryMock.mockReset();
  resolveClientFromAppStoreMock.mockReturnValue({} as never);
});

afterEach(() => cleanup());

describe('useDistrictAggregate', () => {
  it('is idle without a full tuple', async () => {
    render(<Harness topicId="topic-1" />);
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(readDistrictAggregateSummaryMock).not.toHaveBeenCalled();
  });

  it('is idle when no client is available', async () => {
    resolveClientFromAppStoreMock.mockReturnValue(null);
    render(<Harness {...TUPLE} />);
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(readDistrictAggregateSummaryMock).not.toHaveBeenCalled();
  });

  it('reports ready when a matching above-threshold summary is published', async () => {
    readDistrictAggregateSummaryMock.mockResolvedValue(SUMMARY);
    render(<Harness {...TUPLE} />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('cohort').textContent).toBe('150');
  });

  it('reports withheld when no record is published (small-cell / not materialized)', async () => {
    readDistrictAggregateSummaryMock.mockResolvedValue(null);
    render(<Harness {...TUPLE} />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('withheld'));
    expect(screen.getByTestId('cohort').textContent).toBe('none');
  });

  it('reports withheld when the published record is for a different tuple', async () => {
    readDistrictAggregateSummaryMock.mockResolvedValue({ ...SUMMARY, epoch: 99 });
    render(<Harness {...TUPLE} />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('withheld'));
  });

  it('reports error when the read throws', async () => {
    readDistrictAggregateSummaryMock.mockRejectedValue(new Error('boom'));
    render(<Harness {...TUPLE} />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
  });
});
