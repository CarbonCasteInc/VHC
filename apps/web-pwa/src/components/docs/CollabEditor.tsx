/**
 * CollabEditor — TipTap + Yjs collaborative editor.
 *
 * Lazy-loaded via React.lazy() from ArticleEditor when collab is active.
 * Handles Yjs doc binding, provider init, awareness, and auto-save.
 *
 * Feature flags checked by parent; this component assumes collab is ON.
 * E2E mode uses MockGunYjsProvider (no Gun I/O, no encryption).
 */

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import {
  type AwarenessAdapter,
  type CollaboratorState,
  GunYjsProvider,
  MockGunYjsProvider,
  type GunYjsProviderConfig,
} from '@vh/crdt';
import { PresenceBar } from './PresenceBar';
import {
  createAutoSaveTimer,
  type CollabPeer,
} from '../../store/hermesDocsCollab';

// ── Types ─────────────────────────────────────────────────────────────

export interface CollabEditorProps {
  docId: string;
  documentKey: string;
  myNullifier: string;
  displayName?: string;
  color?: string;
  collaborators: string[];
  e2eMode: boolean;
  /** Provider config factory (for real Gun provider). */
  providerConfigFactory?: (
    ydoc: Y.Doc,
    docId: string,
    documentKey: string,
    myNullifier: string,
    collaborators: string[],
  ) => GunYjsProviderConfig;
  /** Called on auto-save with the encoded Yjs state. */
  onAutoSave?: (stateBytes: Uint8Array) => Promise<void> | void;
  /** Called when pending change count changes. */
  onPendingChange?: (count: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────

function awarenessToCollabPeers(
  awareness: AwarenessAdapter,
): Map<number, CollabPeer> {
  const peers = new Map<number, CollabPeer>();
  for (const [clientId, state] of awareness.getStates()) {
    if (state?.nullifier) {
      peers.set(clientId, {
        nullifier: state.nullifier,
        displayName: state.displayName,
        color: state.color,
        cursor: state.cursor,
      });
    }
  }
  return peers;
}

// ── Component ─────────────────────────────────────────────────────────

export const CollabEditor: React.FC<CollabEditorProps> = ({
  docId,
  documentKey,
  myNullifier,
  displayName = 'Anonymous',
  color = '#6366f1',
  collaborators,
  e2eMode,
  providerConfigFactory,
  onAutoSave,
  onPendingChange,
}) => {
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<GunYjsProvider | MockGunYjsProvider | null>(
    null,
  );
  const pendingRef = useRef(0);
  const [peers, setPeers] = React.useState<Map<number, CollabPeer>>(
    new Map(),
  );

  // Create Y.Doc once
  const ydoc = useMemo(() => {
    const doc = new Y.Doc();
    ydocRef.current = doc;
    return doc;
  }, []);

  // Init provider
  useEffect(() => {
    if (e2eMode) {
      const mock = new MockGunYjsProvider(ydoc);
      providerRef.current = mock;
      mock.awareness.setLocalState({
        nullifier: myNullifier,
        displayName,
        color,
      });
      return () => mock.destroy();
    }

    if (!providerConfigFactory) return;

    const config = providerConfigFactory(
      ydoc,
      docId,
      documentKey,
      myNullifier,
      collaborators,
    );
    const provider = new GunYjsProvider(config);
    providerRef.current = provider;

    provider.awareness.setLocalState({
      nullifier: myNullifier,
      displayName,
      color,
    });

    const handler = () => {
      setPeers(awarenessToCollabPeers(provider.awareness));
    };
    provider.awareness.onChange(handler);

    return () => {
      provider.awareness.offChange(handler);
      provider.destroy();
      providerRef.current = null;
    };
  }, [
    ydoc,
    docId,
    documentKey,
    myNullifier,
    displayName,
    color,
    collaborators,
    e2eMode,
    providerConfigFactory,
  ]);

  // Auto-save timer
  useEffect(() => {
    const cleanup = createAutoSaveTimer(
      () => ({ pendingChanges: pendingRef.current, collabEnabled: true }),
      async () => {
        if (!ydocRef.current || !onAutoSave) return;
        const state = Y.encodeStateAsUpdate(ydocRef.current);
        await onAutoSave(state);
        pendingRef.current = 0;
        onPendingChange?.(0);
      },
    );
    return cleanup;
  }, [onAutoSave, onPendingChange]);

  // Track local edits for pending count
  const handleUpdate = useCallback(() => {
    pendingRef.current += 1;
    onPendingChange?.(pendingRef.current);
  }, [onPendingChange]);

  useEffect(() => {
    ydoc.on('update', handleUpdate);
    return () => {
      ydoc.off('update', handleUpdate);
    };
  }, [ydoc, handleUpdate]);

  // TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider: providerRef.current ?? undefined,
        user: { name: displayName, color },
      }),
    ],
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[200px] px-3 py-2 focus:outline-none',
        'data-testid': 'collab-editor-content',
      },
    },
  });

  // Cleanup
  useEffect(() => {
    return () => {
      ydoc.destroy();
    };
  }, [ydoc]);

  return (
    <div data-testid="collab-editor">
      <PresenceBar peers={peers} myNullifier={myNullifier} />
      <div className="rounded border border-slate-200 dark:border-slate-700">
        <EditorContent editor={editor} />
      </div>
      {pendingRef.current > 0 && (
        <div
          className="mt-1 text-xs text-amber-500"
          data-testid="pending-indicator"
        >
          {pendingRef.current} unsaved change
          {pendingRef.current !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default CollabEditor;
