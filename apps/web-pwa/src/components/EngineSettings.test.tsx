/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSettings } from './EngineSettings';
import { useRemoteEngineOptIn } from '../hooks/useRemoteEngineOptIn';

vi.mock('../hooks/useRemoteEngineOptIn', () => ({
  useRemoteEngineOptIn: vi.fn()
}));

describe('EngineSettings', () => {
  const mockedUseRemoteEngineOptIn = vi.mocked(useRemoteEngineOptIn);

  beforeEach(() => {
    vi.stubEnv('VITE_REMOTE_ENGINE_URL', 'https://remote.example/v1');
    mockedUseRemoteEngineOptIn.mockReturnValue({
      optedIn: false,
      setOptIn: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('renders toggle in off state by default', () => {
    render(<EngineSettings />);

    const toggle = screen.getByTestId('remote-engine-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId('engine-status-text')).toHaveTextContent('On-device only');
  });

  it('renders consent language mentioning remote AI server', () => {
    render(<EngineSettings />);

    expect(
      screen.getByText(/Allow remote AI fallback when on-device AI is unavailable\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/remote AI server/i)).toBeInTheDocument();
  });

  it('clicking toggle calls setOptIn with the next value', () => {
    const setOptIn = vi.fn();
    mockedUseRemoteEngineOptIn.mockReturnValue({
      optedIn: false,
      setOptIn
    });

    render(<EngineSettings />);
    fireEvent.click(screen.getByTestId('remote-engine-toggle'));

    expect(setOptIn).toHaveBeenCalledWith(true);
  });

  it('shows on-device only status when opted out', () => {
    mockedUseRemoteEngineOptIn.mockReturnValue({
      optedIn: false,
      setOptIn: vi.fn()
    });

    render(<EngineSettings />);

    expect(screen.getByTestId('engine-status-text')).toHaveTextContent('On-device only');
  });

  it('shows on-device first status when opted in', () => {
    mockedUseRemoteEngineOptIn.mockReturnValue({
      optedIn: true,
      setOptIn: vi.fn()
    });

    render(<EngineSettings />);

    expect(screen.getByTestId('engine-status-text')).toHaveTextContent('On-device first, remote fallback');
  });

  it('does not render when remote engine URL is empty', () => {
    vi.stubEnv('VITE_REMOTE_ENGINE_URL', '');

    render(<EngineSettings />);

    expect(screen.queryByTestId('remote-engine-toggle')).not.toBeInTheDocument();
    expect(screen.queryByText(/Engine Settings/i)).not.toBeInTheDocument();
  });
});
