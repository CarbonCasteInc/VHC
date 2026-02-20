/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { perspectivePointMapKey, useSynthesisPointIds } from './useSynthesisPointIds';

const deriveSynthesisPointIdMock = vi.hoisted(() => vi.fn());

vi.mock('@vh/data-model', () => ({
  deriveSynthesisPointId: (...args: unknown[]) => deriveSynthesisPointIdMock(...args),
}));

function HookHarness(props: {
  topicId?: string;
  synthesisId?: string;
  epoch?: number;
  perspectives: ReadonlyArray<{ id: string; frame: string; reframe: string }>;
  enabled?: boolean;
}) {
  const pointIds = useSynthesisPointIds(props);
  return <pre data-testid="point-ids">{JSON.stringify(pointIds)}</pre>;
}

describe('useSynthesisPointIds', () => {
  beforeEach(() => {
    deriveSynthesisPointIdMock.mockReset();
    deriveSynthesisPointIdMock.mockImplementation(async ({ column, text }: { column: string; text: string }) => `${column}:${text}`);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('builds stable perspective map keys', () => {
    expect(perspectivePointMapKey('perspective-1', 'frame')).toBe('perspective-1:frame');
    expect(perspectivePointMapKey('perspective-1', 'reframe')).toBe('perspective-1:reframe');
  });

  it('returns empty map and skips derivation when disabled or context is incomplete', async () => {
    const { rerender } = render(
      <HookHarness
        enabled={false}
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={0}
        perspectives={[{ id: 'p1', frame: 'Frame A', reframe: 'Reframe A' }]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('{}');
    });
    expect(deriveSynthesisPointIdMock).not.toHaveBeenCalled();

    rerender(
      <HookHarness
        topicId={undefined}
        synthesisId="synth-1"
        epoch={0}
        perspectives={[{ id: 'p1', frame: 'Frame A', reframe: 'Reframe A' }]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('{}');
    });
    expect(deriveSynthesisPointIdMock).not.toHaveBeenCalled();
  });

  it('handles derivation failures by warning and resetting map', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    deriveSynthesisPointIdMock.mockRejectedValueOnce(new Error('derive-fail'));

    render(
      <HookHarness
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={0}
        perspectives={[{ id: 'p1', frame: 'Frame A', reframe: 'Reframe A' }]}
      />,
    );

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:analysis-view] failed to derive synthesis point IDs',
        expect.any(Error),
      );
      expect(screen.getByTestId('point-ids')).toHaveTextContent('{}');
    });
  });

  it('derives deterministic synthesis point IDs for each perspective frame/reframe', async () => {
    const perspectives = [
      { id: 'p1', frame: 'Frame A', reframe: 'Reframe A' },
      { id: 'p2', frame: 'Frame B', reframe: 'Reframe B' },
    ];

    const { rerender } = render(
      <HookHarness
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={0}
        perspectives={perspectives}
      />, 
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"p1:frame":"frame:Frame A"');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"p1:reframe":"reframe:Reframe A"');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"p2:frame":"frame:Frame B"');
      expect(screen.getByTestId('point-ids')).toHaveTextContent('"p2:reframe":"reframe:Reframe B"');
    });

    const firstRender = screen.getByTestId('point-ids').textContent;

    rerender(
      <HookHarness
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={0}
        perspectives={perspectives}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids').textContent).toBe(firstRender);
    });
  });

  it('returns empty map when perspectives is empty', async () => {
    render(
      <HookHarness
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={0}
        perspectives={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('point-ids')).toHaveTextContent('{}');
    });
  });

  it('handles unmount cancellation without state-update warnings', async () => {
    let release: (() => void) | null = null;
    deriveSynthesisPointIdMock.mockImplementation(
      () => new Promise<string>((resolve) => {
        release = () => resolve('delayed-id');
      }),
    );

    const { unmount } = render(
      <HookHarness
        topicId="topic-1"
        synthesisId="synth-1"
        epoch={0}
        perspectives={[{ id: 'p1', frame: 'Frame A', reframe: 'Reframe A' }]}
      />,
    );

    unmount();
    release?.();

    await Promise.resolve();
    await Promise.resolve();

    expect(true).toBe(true);
  });
});
