/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBiasPointIds } from './useBiasPointIds';

const deriveAnalysisKeyMock = vi.hoisted(() => vi.fn());
const derivePointIdMock = vi.hoisted(() => vi.fn());
const deriveSynthesisPointIdMock = vi.hoisted(() => vi.fn());
const getDevModelOverrideMock = vi.hoisted(() => vi.fn<() => string | null>(() => null));

vi.mock('@vh/data-model', () => ({
  deriveAnalysisKey: (...args: unknown[]) => deriveAnalysisKeyMock(...args),
  derivePointId: (...args: unknown[]) => derivePointIdMock(...args),
  deriveSynthesisPointId: (...args: unknown[]) => deriveSynthesisPointIdMock(...args),
}));

vi.mock('../dev/DevModelPicker', () => ({
  DEV_MODEL_CHANGED_EVENT: 'vh:model-changed',
  getDevModelOverride: () => getDevModelOverrideMock(),
}));

function HookHarness(props: {
  frames: ReadonlyArray<{
    frame_point_id?: string;
    frame: string;
    reframe_point_id?: string;
    reframe: string;
  }>;
  analysisId?: string;
  topicId?: string;
  synthesisId?: string;
  epoch?: number;
  votingEnabled?: boolean;
  synthesisPointIdMode?: 'persisted-or-derived' | 'persisted-only';
}) {
  const pointIds = useBiasPointIds(props);
  return <pre data-testid="point-ids">{JSON.stringify(pointIds)}</pre>;
}

describe('useBiasPointIds', () => {
  beforeEach(() => {
    deriveAnalysisKeyMock.mockReset();
    derivePointIdMock.mockReset();
    deriveSynthesisPointIdMock.mockReset();
    getDevModelOverrideMock.mockReset();

    deriveAnalysisKeyMock.mockResolvedValue('analysis-key');
    derivePointIdMock.mockImplementation(async ({ column, text }: { column: string; text: string }) => `legacy:${column}:${text}`);
    deriveSynthesisPointIdMock.mockImplementation(async ({ column, text }: { column: string; text: string }) => `synth:${column}:${text}`);
    getDevModelOverrideMock.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('derives legacy + synthesis point IDs when voting context is complete', async () => {
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
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"legacyPointIds":{"frame:0":"legacy:frame:Frame A","reframe:0":"legacy:reframe:Reframe A"}');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"synthesisPointIds":{"frame:0":"synth:frame:Frame A","reframe:0":"synth:reframe:Reframe A"}');
    });

    expect(deriveAnalysisKeyMock).toHaveBeenCalledWith({
      story_id: 'story-1',
      provenance_hash: 'prov-1',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:default',
    });
  });

  it('uses persisted synthesis point IDs when present', async () => {
    render(
      <HookHarness
        frames={[
          {
            frame_point_id: 'persisted-frame-point',
            frame: 'Frame A',
            reframe_point_id: 'persisted-reframe-point',
            reframe: 'Reframe A',
          },
        ]}
        analysisId="story-1:prov-1"
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={2}
        votingEnabled
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"legacyPointIds":{"frame:0":"legacy:frame:Frame A","reframe:0":"legacy:reframe:Reframe A"}');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"synthesisPointIds":{"frame:0":"persisted-frame-point","reframe:0":"persisted-reframe-point"}');
    });

    expect(deriveSynthesisPointIdMock).not.toHaveBeenCalled();
  });

  it('persisted-only synthesis mode never derives text-based canonical point IDs', async () => {
    render(
      <HookHarness
        frames={[
          {
            frame_point_id: 'persisted-frame-point',
            frame: 'Frame A',
            reframe: 'Reframe A',
          },
        ]}
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={2}
        votingEnabled
        synthesisPointIdMode="persisted-only"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"legacyPointIds":{}');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"synthesisPointIds":{"frame:0":"persisted-frame-point"}');
    });

    expect(deriveSynthesisPointIdMock).not.toHaveBeenCalled();
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
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"legacy:frame:Frame A"');
    });

    expect(deriveAnalysisKeyMock).toHaveBeenCalledWith({
      story_id: 'story-1',
      provenance_hash: 'prov-1',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:opus46',
    });
  });

  it('still derives synthesis IDs when analysisId is missing', async () => {
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
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"legacyPointIds":{}');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"synthesisPointIds":{"frame:0":"synth:frame:Frame A","reframe:0":"synth:reframe:Reframe A"}');
    });

    expect(deriveAnalysisKeyMock).not.toHaveBeenCalled();
    expect(derivePointIdMock).not.toHaveBeenCalled();
    expect(deriveSynthesisPointIdMock).toHaveBeenCalled();
  });

  it('still derives synthesis IDs when analysisId is malformed', async () => {
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
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"legacyPointIds":{}');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"synthesisPointIds":{"frame:0":"synth:frame:Frame A","reframe:0":"synth:reframe:Reframe A"}');
    });

    expect(deriveAnalysisKeyMock).not.toHaveBeenCalled();
    expect(derivePointIdMock).not.toHaveBeenCalled();
    expect(deriveSynthesisPointIdMock).toHaveBeenCalled();
  });

  it('legacy derivation failures do not block synthesis derivation', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deriveAnalysisKeyMock.mockRejectedValue(new Error('legacy-boom'));

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
        '[vh:bias-table] failed to derive legacy point IDs',
        expect.any(Error),
      );
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"legacyPointIds":{}');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"synthesisPointIds":{"frame:0":"synth:frame:Frame A","reframe:0":"synth:reframe:Reframe A"}');
    });
  });
});
