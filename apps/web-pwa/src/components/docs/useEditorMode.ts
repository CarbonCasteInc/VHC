/**
 * useEditorMode — mode-selection hook for ArticleEditor.
 *
 * Reads both feature flags to determine editor mode:
 *   - 'textarea': Stage 1 single-author (either flag off)
 *   - 'collab':   Stage 2 TipTap+Yjs (both flags on)
 *
 * When mode is 'collab', resolves CollabEditor props from store state.
 * When mode is 'textarea', returns null collabProps — no Yjs init.
 *
 * Dual-gate precedence: both VITE_HERMES_DOCS_ENABLED AND
 * VITE_DOCS_COLLAB_ENABLED must be 'true' for collab mode.
 * When collab flag is off, textarea mode is preserved even if
 * the document has collaborators.
 */

import { readEnvFlag, loadDocumentKey } from '../../store/hermesDocsCollab';
import type { CollabEditorProps } from './CollabEditor';

// ── Types ─────────────────────────────────────────────────────────────

export type EditorMode = 'textarea' | 'collab';

export interface CollabPropsResolved {
  docId: string;
  documentKey: string;
  myNullifier: string;
  displayName?: string;
  color?: string;
  collaborators: string[];
  e2eMode: boolean;
  onAutoSave?: CollabEditorProps['onAutoSave'];
}

export interface EditorModeResult {
  mode: EditorMode;
  collabProps: CollabPropsResolved | null;
}

// ── Flag reading ──────────────────────────────────────────────────────

/** @internal exported for testing */
export function resolveMode(
  docsEnabled?: boolean,
  collabEnabled?: boolean,
): EditorMode {
  const docs = docsEnabled ?? readEnvFlag('VITE_HERMES_DOCS_ENABLED');
  const collab = collabEnabled ?? readEnvFlag('VITE_DOCS_COLLAB_ENABLED');
  return docs && collab ? 'collab' : 'textarea';
}

/** @internal exported for testing */
export function resolveE2E(override?: boolean): boolean {
  return override ?? readEnvFlag('VITE_E2E_MODE');
}

// ── Hook ──────────────────────────────────────────────────────────────

export interface UseEditorModeOpts {
  docId: string | null;
  myNullifier: string;
  displayName?: string;
  color?: string;
  collaborators: string[];
  onAutoSave?: CollabEditorProps['onAutoSave'];
  /** Override flags for testing. */
  _docsEnabled?: boolean;
  _collabEnabled?: boolean;
  _e2eMode?: boolean;
}

/**
 * Determine editor mode and resolve collab props.
 *
 * Pure derivation — no side effects, no provider init.
 * Provider init happens inside CollabEditor itself.
 */
export function useEditorMode(opts: UseEditorModeOpts): EditorModeResult {
  const mode = resolveMode(opts._docsEnabled, opts._collabEnabled);

  if (mode === 'textarea' || !opts.docId) {
    return { mode: 'textarea', collabProps: null };
  }

  const e2eMode = resolveE2E(opts._e2eMode);
  const documentKey = loadDocumentKey(opts.myNullifier, opts.docId) ?? '';

  return {
    mode: 'collab',
    collabProps: {
      docId: opts.docId,
      documentKey,
      myNullifier: opts.myNullifier,
      displayName: opts.displayName,
      color: opts.color,
      collaborators: opts.collaborators,
      e2eMode,
      onAutoSave: opts.onAutoSave,
    },
  };
}
