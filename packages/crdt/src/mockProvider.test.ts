import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { MockGunYjsProvider } from './mockProvider';

describe('MockGunYjsProvider', () => {
  it('creates an awareness adapter', () => {
    const doc = new Y.Doc();
    const mock = new MockGunYjsProvider(doc);
    expect(mock.awareness).toBeDefined();
    mock.destroy();
    doc.destroy();
  });

  it('subscribeToCollaborators is a no-op', () => {
    const doc = new Y.Doc();
    const mock = new MockGunYjsProvider(doc);
    // Should not throw
    mock.subscribeToCollaborators(['user-1', 'user-2']);
    mock.destroy();
    doc.destroy();
  });

  it('destroy is idempotent', () => {
    const doc = new Y.Doc();
    const mock = new MockGunYjsProvider(doc);
    mock.destroy();
    expect(() => mock.destroy()).not.toThrow();
    doc.destroy();
  });

  it('destroy cleans up awareness', () => {
    const doc = new Y.Doc();
    const mock = new MockGunYjsProvider(doc);
    mock.awareness.setLocalState({ nullifier: 'test' });
    mock.destroy();
    // After destroy, setLocalState is a no-op on the adapter
    mock.awareness.setLocalState({ nullifier: 'ghost' });
    doc.destroy();
  });
});
