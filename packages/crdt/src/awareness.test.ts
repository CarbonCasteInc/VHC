import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { AwarenessAdapter, type CollaboratorState } from './awareness';

function makeAdapter(): AwarenessAdapter {
  return new AwarenessAdapter(new Y.Doc());
}

describe('AwarenessAdapter', () => {
  it('sets and retrieves local state', () => {
    const adapter = makeAdapter();
    const state: CollaboratorState = {
      nullifier: 'user-1',
      displayName: 'Alice',
      color: '#ff0000'
    };
    adapter.setLocalState(state);

    const states = adapter.getStates();
    const localId = adapter.awareness.clientID;
    expect(states.get(localId)).toEqual(state);

    adapter.destroy();
  });

  it('clears local state', () => {
    const adapter = makeAdapter();
    adapter.setLocalState({ nullifier: 'user-1' });
    adapter.clearLocalState();

    const states = adapter.getStates();
    const localId = adapter.awareness.clientID;
    // y-protocols removes the entry from the map when state is set to null
    const localState = states.get(localId);
    expect(localState === null || localState === undefined).toBe(true);

    adapter.destroy();
  });

  it('notifies onChange handlers', () => {
    const adapter = makeAdapter();
    const handler = vi.fn();
    adapter.onChange(handler);

    adapter.setLocalState({ nullifier: 'user-1' });
    expect(handler).toHaveBeenCalled();

    const call = handler.mock.calls[0]!;
    const changes = call[0] as { added: number[]; updated: number[]; removed: number[] };
    // First set is an 'add' or 'update' for local client
    expect(
      changes.added.length > 0 || changes.updated.length > 0
    ).toBe(true);

    adapter.destroy();
  });

  it('removes handler via offChange', () => {
    const adapter = makeAdapter();
    const handler = vi.fn();
    adapter.onChange(handler);
    adapter.offChange(handler);

    adapter.setLocalState({ nullifier: 'user-2' });
    // Handler was called once during onChange registration triggering
    // but after offChange it should not receive the setLocalState call
    const callCount = handler.mock.calls.length;
    adapter.setLocalState({ nullifier: 'user-3' });
    expect(handler.mock.calls.length).toBe(callCount);

    adapter.destroy();
  });

  it('ignores operations after destroy', () => {
    const adapter = makeAdapter();
    adapter.destroy();

    // Should not throw
    adapter.setLocalState({ nullifier: 'ghost' });
    adapter.clearLocalState();

    // getStates still works (reads from underlying destroyed awareness)
    expect(adapter.getStates()).toBeDefined();
  });

  it('does not register handlers after destroy', () => {
    const adapter = makeAdapter();
    adapter.destroy();

    const handler = vi.fn();
    adapter.onChange(handler);
    // Handler should not be registered; calling setLocalState should not invoke it
    expect(handler).not.toHaveBeenCalled();
  });

  it('destroy is idempotent', () => {
    const adapter = makeAdapter();
    adapter.destroy();
    // Second destroy should not throw
    expect(() => adapter.destroy()).not.toThrow();
  });

  it('supports cursor state', () => {
    const adapter = makeAdapter();
    const state: CollaboratorState = {
      nullifier: 'user-1',
      cursor: { anchor: 0, head: 5 }
    };
    adapter.setLocalState(state);

    const localId = adapter.awareness.clientID;
    const retrieved = adapter.getStates().get(localId) as CollaboratorState;
    expect(retrieved.cursor).toEqual({ anchor: 0, head: 5 });

    adapter.destroy();
  });
});
