/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

// ── Mock heavy deps before import ─────────────────────────────────────

vi.mock('@tiptap/react', () => ({
  useEditor: () => null,
  EditorContent: ({ editor }: any) => (
    <div data-testid="mock-editor-content">editor-content</div>
  ),
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: () => ({}) },
}));

vi.mock('@tiptap/extension-collaboration', () => ({
  default: { configure: () => ({}) },
}));

vi.mock('@tiptap/extension-collaboration-cursor', () => ({
  default: { configure: () => ({}) },
}));

vi.mock('yjs', () => {
  class MockDoc {
    private handlers: Record<string, Function[]> = {};
    on(event: string, handler: Function) {
      (this.handlers[event] ??= []).push(handler);
    }
    off(event: string, handler: Function) {
      this.handlers[event] = (this.handlers[event] ?? []).filter((h) => h !== handler);
    }
    destroy() {
      this.handlers = {};
    }
  }
  return {
    Doc: MockDoc,
    encodeStateAsUpdate: () => new Uint8Array([1, 2, 3]),
  };
});

const mockSetLocalState = vi.fn();
const mockAwarenessDestroy = vi.fn();
const mockGetStates = vi.fn(() => new Map());

vi.mock('@vh/crdt', () => ({
  GunYjsProvider: vi.fn(),
  MockGunYjsProvider: vi.fn().mockImplementation(() => ({
    awareness: {
      setLocalState: mockSetLocalState,
      getStates: mockGetStates,
      onChange: vi.fn(),
      offChange: vi.fn(),
      destroy: mockAwarenessDestroy,
    },
    destroy: vi.fn(),
  })),
}));

vi.mock('../../store/hermesDocsCollab', () => ({
  createAutoSaveTimer: (_getState: any, _onSave: any) => () => {},
}));

import { CollabEditor } from './CollabEditor';

describe('CollabEditor', () => {
  beforeEach(() => {
    mockSetLocalState.mockClear();
    mockAwarenessDestroy.mockClear();
    mockGetStates.mockClear();
  });
  afterEach(() => cleanup());

  const baseProps = {
    docId: 'doc-1',
    documentKey: 'key-1',
    myNullifier: 'my-null',
    displayName: 'Alice',
    color: '#f00',
    collaborators: ['peer-1'],
    e2eMode: true,
  };

  it('renders the collab editor container', () => {
    render(<CollabEditor {...baseProps} />);
    expect(screen.getByTestId('collab-editor')).toBeInTheDocument();
  });

  it('renders TipTap editor content', () => {
    render(<CollabEditor {...baseProps} />);
    expect(screen.getByTestId('mock-editor-content')).toBeInTheDocument();
  });

  it('sets local awareness state in e2e mode', () => {
    render(<CollabEditor {...baseProps} />);
    expect(mockSetLocalState).toHaveBeenCalledWith({
      nullifier: 'my-null',
      displayName: 'Alice',
      color: '#f00',
    });
  });

  it('renders without presence bar when no peers', () => {
    render(<CollabEditor {...baseProps} />);
    expect(screen.queryByTestId('presence-bar')).not.toBeInTheDocument();
  });

  it('uses default displayName and color', () => {
    render(
      <CollabEditor
        docId="d"
        documentKey="k"
        myNullifier="n"
        collaborators={[]}
        e2eMode={true}
      />,
    );
    expect(mockSetLocalState).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Anonymous', color: '#6366f1' }),
    );
  });
});
