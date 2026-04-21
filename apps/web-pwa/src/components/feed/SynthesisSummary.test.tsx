/* @vitest-environment jsdom */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach } from 'vitest';
import type { TopicSynthesisV2 } from '@vh/data-model';
import { SynthesisSummary } from './SynthesisSummary';

const NOW = 1_700_000_000_000;

function makeSynthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'topic-42',
    epoch: 3,
    synthesis_id: 'synth-001',
    inputs: {},
    quorum: { required: 3, received: 3, reached_at: NOW, timed_out: false, selection_rule: 'deterministic' },
    facts_summary: 'Key facts about the topic.',
    frames: [
      { frame_point_id: 'frame-point-a', frame: 'Frame A', reframe_point_id: 'reframe-point-a', reframe: 'Reframe A' },
      { frame_point_id: 'frame-point-b', frame: 'Frame B', reframe_point_id: 'reframe-point-b', reframe: 'Reframe B' },
    ],
    warnings: [],
    divergence_metrics: { disagreement_score: 0.2, source_dispersion: 0.3, candidate_count: 3 },
    provenance: { candidate_ids: ['c1', 'c2', 'c3'], provider_mix: [{ provider_id: 'local', count: 3 }] },
    created_at: NOW,
    ...overrides,
  };
}

describe('SynthesisSummary', () => {
  afterEach(() => cleanup());

  it('renders facts_summary', () => {
    render(<SynthesisSummary synthesis={makeSynthesis()} />);
    expect(screen.getByTestId('synthesis-facts')).toHaveTextContent('Key facts about the topic.');
  });

  it('renders collapsed frames toggle with count', () => {
    render(<SynthesisSummary synthesis={makeSynthesis()} />);
    const toggle = screen.getByTestId('synthesis-frames-toggle');
    expect(toggle).toHaveTextContent('2 perspectives');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands frames on click', () => {
    render(<SynthesisSummary synthesis={makeSynthesis()} />);
    fireEvent.click(screen.getByTestId('synthesis-frames-toggle'));

    expect(screen.getByTestId('synthesis-frames-list')).toBeInTheDocument();
    expect(screen.getByTestId('synthesis-frame-0')).toHaveTextContent('Frame A');
    expect(screen.getByTestId('synthesis-frame-0')).toHaveTextContent('Reframe A');
    expect(screen.getByTestId('synthesis-frame-1')).toHaveTextContent('Frame B');
  });

  it('collapses frames on second click', () => {
    render(<SynthesisSummary synthesis={makeSynthesis()} />);
    const toggle = screen.getByTestId('synthesis-frames-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('synthesis-frames-list')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('synthesis-frames-list')).not.toBeInTheDocument();
  });

  it('hides frames section when no frames', () => {
    render(<SynthesisSummary synthesis={makeSynthesis({ frames: [] })} />);
    expect(screen.queryByTestId('synthesis-frames-section')).not.toBeInTheDocument();
  });

  it('shows warnings when present', () => {
    render(<SynthesisSummary synthesis={makeSynthesis({ warnings: ['Bias alert'] })} />);
    expect(screen.getByTestId('synthesis-warnings')).toHaveTextContent('Bias alert');
  });

  it('hides warnings section when empty', () => {
    render(<SynthesisSummary synthesis={makeSynthesis({ warnings: [] })} />);
    expect(screen.queryByTestId('synthesis-warnings')).not.toBeInTheDocument();
  });

  it('shows divergence indicator when score > 0.5', () => {
    render(
      <SynthesisSummary
        synthesis={makeSynthesis({
          divergence_metrics: { disagreement_score: 0.75, source_dispersion: 0.4, candidate_count: 5 },
        })}
      />,
    );
    expect(screen.getByTestId('synthesis-divergence')).toHaveTextContent('High divergence');
  });

  it('hides divergence indicator when score <= 0.5', () => {
    render(<SynthesisSummary synthesis={makeSynthesis()} />);
    expect(screen.queryByTestId('synthesis-divergence')).not.toBeInTheDocument();
  });

  it('shows singular "1 perspective" for single frame', () => {
    render(
      <SynthesisSummary
        synthesis={makeSynthesis({
          frames: [{ frame_point_id: 'solo-frame-point', frame: 'Solo', reframe_point_id: 'solo-reframe-point', reframe: 'Reframe' }],
        })}
      />,
    );
    expect(screen.getByTestId('synthesis-frames-toggle')).toHaveTextContent('1 perspective');
  });

  it('renders multiple warnings as separate paragraphs', () => {
    render(
      <SynthesisSummary synthesis={makeSynthesis({ warnings: ['Warning one', 'Warning two'] })} />,
    );
    const container = screen.getByTestId('synthesis-warnings');
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});
