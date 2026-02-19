/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBiasPointIds } from './useBiasPointIds';

const deriveAnalysisKeyMock = vi.hoisted(() => vi.fn());
const derivePointIdMock = vi.hoisted(() => vi.fn());
const getDevModelOverrideMock = vi.hoisted(() => vi.fn(() => null));

vi.mock('@vh/data-model', () => ({
  deriveAnalysisKey: (...args: unknown[]) => deriveAnalysisKeyMock(...args),
  derivePointId: (...args: unknown[]) => derivePointIdMock(...args),
}));

vi.mock('../dev/DevModelPicker', () => ({
  DEV_MODEL_CHANGED_EVENT: 'vh:model-changed',
  getDevModelOverride: () => getDevModelOverrideMock(),
}));

function HookHarness(props: {
  frames: ReadonlyArray<{ frame: string; reframe: string }>;
  analysisId?: string;
  topicId?: string;
  synthesisId?: string;
  epoch?: number;
  votingEnabled?: boolean;
}) {
  const pointIds = useBiasPointIds(props);
  return <pre data-testid="point-ids">{JSON.stringify(pointIds)}</pre>;
}

describe('useBiasPointIds', () => {
  beforeEach(() => {
    deriveAnalysisKeyMock.mockReset();
    derivePointIdMock.mockReset();
    getDevModelOverrideMock.mockReset();

    deriveAnalysisKeyMock.mockResolvedValue('analysis-key');
    derivePointIdMock.mockImplementation(async ({ column, text }: { column: string; text: string }) => `${column}:${text}`);
    getDevModelOverrideMock.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('derives deterministic frame/reframe point IDs when voting context is complete', async () => {
    render(
      <HookHarness
        frames={[{ frame: 'Frame A', reframe: 'Reframe A' }]}
        analysisId="story-1:prov-1"
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={2}
        votingEnabled
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"frame:0":"frame:Frame A"');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"reframe:0":"reframe:Reframe A"');
    });

    expect(deriveAnalysisKeyMock).toHaveBeenCalledWith({
      story_id: 'story-1',
      provenance_hash: 'prov-1',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:default',
    });
  });

  it('uses model override in analysis key scope when available', async () => {
    getDevModelOverrideMock.mockReturnValue('opus46');

    render(
      <HookHarness
        frames={[{ frame: 'Frame A', reframe: 'Reframe A' }]}
        analysisId="story-1:prov-1"
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={2}
        votingEnabled
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"frame:0":"frame:Frame A"');
    });

    expect(deriveAnalysisKeyMock).toHaveBeenCalledWith({
      story_id: 'story-1',
      provenance_hash: 'prov-1',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:opus46',
    });
  });

  it('returns empty map and skips derivation when analysisId is missing', async () => {
    render(
      <HookHarness
        frames={[{ frame: 'Frame A', reframe: 'Reframe A' }]}
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={2}
        votingEnabled
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('{}');
    });
    expect(deriveAnalysisKeyMock).not.toHaveBeenCalled();
    expect(derivePointIdMock).not.toHaveBeenCalled();
  });

  it('returns empty map and skips derivation when analysisId is malformed', async () => {
    render(
      <HookHarness
        frames={[{ frame: 'Frame A', reframe: 'Reframe A' }]}
        analysisId="story-without-separator"
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={2}
        votingEnabled
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('{}');
    });
    expect(deriveAnalysisKeyMock).not.toHaveBeenCalled();
    expect(derivePointIdMock).not.toHaveBeenCalled();
  });

  it('handles derivation failures by warning and returning empty map', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deriveAnalysisKeyMock.mockRejectedValue(new Error('boom'));

    render(
      <HookHarness
        frames={[{ frame: 'Frame A', reframe: 'Reframe A' }]}
        analysisId="story-1:prov-1"
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={2}
        votingEnabled
      />,
    );

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:bias-table] failed to derive point IDs',
        expect.any(Error),
      );
      expect(screen.getByTestId('point-ids')).toHaveTextContent('{}');
    });
  });
});
