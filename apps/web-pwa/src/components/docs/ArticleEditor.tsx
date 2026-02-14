/**
 * ArticleEditor — dual-mode editor shell.
 *
 * Mode selection (via useEditorMode):
 *   Both VITE_HERMES_DOCS_ENABLED + VITE_DOCS_COLLAB_ENABLED true →
 *     lazy-loads CollabEditor, renders PresenceBar, shows Share button.
 *   Either flag false →
 *     Stage 1 single-author textarea (EXACT same behavior, no Yjs).
 *
 * Feature-gated by VITE_HERMES_DOCS_ENABLED at the top level.
 */

import React, { lazy, Suspense, useCallback, useState } from 'react';
import { useDocsStore, type SourceContext } from '../../store/hermesDocs';
import { useEditorMode, type EditorMode } from './useEditorMode';

export const TITLE_MAX = 200;
export const CONTENT_MAX = 500_000;

const DOCUMENT_TYPES = ['article', 'draft', 'proposal', 'report', 'letter'] as const;
type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Lazy-load CollabEditor only when collab mode is active
const LazyCollabEditor = lazy(() => import('./CollabEditor'));

export interface ArticleEditorProps {
  initialContent?: string;
  sourceContext?: SourceContext;
  onComplete?: (docId: string) => void;
  /** Current user nullifier (required for collab mode). */
  myNullifier?: string;
  /** Display name for presence (collab mode). */
  displayName?: string;
  /** Cursor color for presence (collab mode). */
  color?: string;
  /** Collaborator nullifiers from document metadata. */
  collaborators?: string[];
  /** Trust score for share gating (collab mode). */
  trustScore?: number;
  /** Auto-save handler for collab mode. */
  onAutoSave?: (stateBytes: Uint8Array) => Promise<void> | void;
  /** Override flags for testing. */
  _docsEnabled?: boolean;
  _collabEnabled?: boolean;
  _e2eMode?: boolean;
}

export const ArticleEditor: React.FC<ArticleEditorProps> = ({
  initialContent = '',
  sourceContext,
  onComplete,
  myNullifier = '',
  displayName,
  color,
  collaborators = [],
  trustScore = 1,
  onAutoSave,
  _docsEnabled,
  _collabEnabled,
  _e2eMode,
}) => {
  const { enabled, createDraft, saveDraft, publishArticle } = useDocsStore();

  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState(initialContent);
  const [docType, setDocType] = useState<DocumentType>('article');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const { mode, collabProps } = useEditorMode({
    docId,
    myNullifier,
    displayName,
    color,
    collaborators,
    onAutoSave,
    _docsEnabled,
    _collabEnabled,
    _e2eMode,
  });

  if (!enabled) return null;

  const isCollab = mode === 'collab' && !published;
  const titleLen = title.length;
  const contentLen = content.length;
  const canSave =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    titleLen <= TITLE_MAX &&
    contentLen <= CONTENT_MAX;

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTitle(raw.length <= TITLE_MAX ? raw : raw.slice(0, TITLE_MAX));
  }, []);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    setContent(raw.length <= CONTENT_MAX ? raw : raw.slice(0, CONTENT_MAX));
  }, []);

  const handleSave = useCallback(() => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (!docId) {
        const doc = createDraft(content, sourceContext);
        if (doc) { setDocId(doc.id); saveDraft(doc.id, { title, type: docType }); }
      } else {
        saveDraft(docId, { title, encryptedContent: content, type: docType });
      }
    } finally { setSaving(false); }
  }, [canSave, saving, docId, content, sourceContext, createDraft, saveDraft, title, docType]);

  const handlePublish = useCallback(() => {
    if (!canSave || publishing || published) return;
    setPublishing(true);
    try {
      let cid = docId;
      if (!cid) {
        const doc = createDraft(content, sourceContext);
        if (!doc) return;
        cid = doc.id;
        setDocId(cid);
        saveDraft(cid, { title, type: docType });
      } else {
        saveDraft(cid, { title, encryptedContent: content, type: docType });
      }
      publishArticle(cid);
      setPublished(true);
      onComplete?.(cid);
    } finally { setPublishing(false); }
  }, [canSave, publishing, published, docId, content, sourceContext, createDraft, saveDraft, title, docType, publishArticle, onComplete]);

  return (
    <div
      className="mx-auto max-w-2xl space-y-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700"
      data-testid="article-editor"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" data-testid="editor-heading">
          {published ? 'Article Published' : docId ? 'Edit Article' : 'New Article'}
        </h2>
        {isCollab && !published && (
          <button
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            onClick={() => setShareOpen(true)}
            data-testid="share-btn"
          >
            Share
          </button>
        )}
      </div>

      {/* Title */}
      <div>
        <input
          className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          placeholder="Article title" value={title} maxLength={TITLE_MAX}
          onChange={handleTitleChange} disabled={published}
          data-testid="article-title-input"
        />
        <div className="mt-1 text-xs text-slate-400" data-testid="title-counter">
          {titleLen}/{TITLE_MAX}
        </div>
      </div>

      {/* Document type selector */}
      <div>
        <select className="rounded border px-3 py-1.5 text-sm" value={docType}
          onChange={(e) => setDocType(e.target.value as DocumentType)}
          disabled={published} data-testid="doc-type-select">
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Content — mode-switched */}
      {isCollab && collabProps ? (
        <Suspense fallback={<div data-testid="collab-loading">Loading editor…</div>}>
          <LazyCollabEditor {...collabProps} />
        </Suspense>
      ) : (
        <div>
          <textarea
            className="w-full resize-y rounded border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400"
            rows={12} placeholder="Write your article (Markdown supported)..."
            value={content} onChange={handleContentChange} disabled={published}
            data-testid="article-content-input"
          />
          <div className="mt-1 text-xs text-slate-400" data-testid="content-counter">
            {contentLen.toLocaleString()}/{CONTENT_MAX.toLocaleString()}
          </div>
        </div>
      )}

      {/* Source linkage */}
      {sourceContext && (
        <div className="text-xs text-slate-400" data-testid="source-linkage">
          Source: {sourceContext.sourceThreadId && `Thread ${sourceContext.sourceThreadId}`}
          {sourceContext.sourceTopicId && ` · Topic ${sourceContext.sourceTopicId}`}
        </div>
      )}

      {/* Actions */}
      {!published && (
        <div className="flex gap-2">
          <button
            className="rounded bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave} disabled={!canSave || saving} data-testid="save-draft-btn">
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            className="rounded bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handlePublish} disabled={!canSave || publishing} data-testid="publish-btn">
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      )}

      {published && (
        <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700" data-testid="published-banner">
          ✅ Article published successfully.
        </div>
      )}

      {/* ShareModal — lazy-loaded alongside collab */}
      {isCollab && shareOpen && (
        <Suspense fallback={null}>
          <ShareModalLoader
            docId={docId ?? ''}
            onClose={() => setShareOpen(false)}
            collaborators={collaborators}
            myNullifier={myNullifier}
            trustScore={trustScore}
          />
        </Suspense>
      )}
    </div>
  );
};

// ── Lazy ShareModal wrapper ───────────────────────────────────────────

const LazyShareModal = lazy(() =>
  import('./ShareModal').then((m) => ({ default: m.ShareModal })),
);

interface ShareModalLoaderProps {
  docId: string;
  onClose: () => void;
  collaborators: string[];
  myNullifier: string;
  trustScore: number;
}

const ShareModalLoader: React.FC<ShareModalLoaderProps> = ({
  docId, onClose, collaborators, myNullifier, trustScore,
}) => (
  <LazyShareModal
    docId={docId}
    isOpen={true}
    onClose={onClose}
    existingCollaborators={collaborators.map((n) => ({ nullifier: n, role: 'editor' as const }))}
    ownerNullifier={myNullifier}
    trustScore={trustScore}
    onShareKey={async () => {}}
    onRemove={async () => {}}
  />
);
