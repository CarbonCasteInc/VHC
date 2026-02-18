/* @vitest-environment jsdom */

import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevModelPicker, getDevModelOverride } from './DevModelPicker';

describe('DevModelPicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders picker when DEV is true', () => {
    render(<DevModelPicker />);
    expect(screen.getByTestId('dev-model-picker')).toBeInTheDocument();
  });

  it('shows "default" label when no model is selected', () => {
    render(<DevModelPicker />);
    expect(screen.getByTestId('dev-model-picker-toggle')).toHaveTextContent('default');
  });

  it('starts collapsed (panel not visible)', () => {
    render(<DevModelPicker />);
    expect(screen.queryByTestId('dev-model-picker-panel')).not.toBeInTheDocument();
  });

  it('expands on toggle click and shows select', () => {
    render(<DevModelPicker />);
    fireEvent.click(screen.getByTestId('dev-model-picker-toggle'));
    expect(screen.getByTestId('dev-model-picker-panel')).toBeInTheDocument();
    expect(screen.getByTestId('dev-model-picker-select')).toBeInTheDocument();
  });

  it('collapses on second toggle click', () => {
    render(<DevModelPicker />);
    fireEvent.click(screen.getByTestId('dev-model-picker-toggle'));
    expect(screen.getByTestId('dev-model-picker-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dev-model-picker-toggle'));
    expect(screen.queryByTestId('dev-model-picker-panel')).not.toBeInTheDocument();
  });

  it('model selection updates localStorage', () => {
    render(<DevModelPicker />);
    fireEvent.click(screen.getByTestId('dev-model-picker-toggle'));
    const select = screen.getByTestId('dev-model-picker-select');
    fireEvent.change(select, { target: { value: 'gpt-4o' } });
    expect(localStorage.getItem('vh_dev_model_override')).toBe('gpt-4o');
    expect(screen.getByTestId('dev-model-picker-toggle')).toHaveTextContent('gpt-4o');
  });

  it('supports gpt-5.2 model selection', () => {
    render(<DevModelPicker />);
    fireEvent.click(screen.getByTestId('dev-model-picker-toggle'));
    const select = screen.getByTestId('dev-model-picker-select');

    fireEvent.change(select, { target: { value: 'openai-codex/gpt-5.2-codex' } });

    expect(localStorage.getItem('vh_dev_model_override')).toBe('openai-codex/gpt-5.2-codex');
    expect(screen.getByTestId('dev-model-picker-toggle')).toHaveTextContent('gpt-5.2');
  });

  it('dispatches a global model-change event when selection changes', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<DevModelPicker />);
    fireEvent.click(screen.getByTestId('dev-model-picker-toggle'));
    const select = screen.getByTestId('dev-model-picker-select');

    fireEvent.change(select, { target: { value: 'gpt-4o' } });
    expect(dispatchSpy).toHaveBeenCalled();
    expect(dispatchSpy.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'vh:dev-model-changed' });
    dispatchSpy.mockRestore();
  });

  it('"Auto/Default" clears localStorage', () => {
    localStorage.setItem('vh_dev_model_override', 'gpt-4o');
    render(<DevModelPicker />);
    fireEvent.click(screen.getByTestId('dev-model-picker-toggle'));
    const select = screen.getByTestId('dev-model-picker-select');
    fireEvent.change(select, { target: { value: '' } });
    expect(localStorage.getItem('vh_dev_model_override')).toBeNull();
    expect(screen.getByTestId('dev-model-picker-toggle')).toHaveTextContent('default');
  });

  it('shows current model name from localStorage on mount', () => {
    localStorage.setItem('vh_dev_model_override', 'claude-3-sonnet');
    render(<DevModelPicker />);
    expect(screen.getByTestId('dev-model-picker-toggle')).toHaveTextContent('claude-3-sonnet');
  });
});

describe('getDevModelOverride', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns null when no override is stored', () => {
    expect(getDevModelOverride()).toBeNull();
  });

  it('returns stored model value', () => {
    localStorage.setItem('vh_dev_model_override', 'gpt-4o');
    expect(getDevModelOverride()).toBe('gpt-4o');
  });

  it('returns null for empty or whitespace-only value', () => {
    localStorage.setItem('vh_dev_model_override', '   ');
    expect(getDevModelOverride()).toBeNull();
  });

  it('trims stored value', () => {
    localStorage.setItem('vh_dev_model_override', '  gpt-4o  ');
    expect(getDevModelOverride()).toBe('gpt-4o');
  });

  it('returns null when localStorage throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    expect(getDevModelOverride()).toBeNull();
    Storage.prototype.getItem = orig;
  });
});
