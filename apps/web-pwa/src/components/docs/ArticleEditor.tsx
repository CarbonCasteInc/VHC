/**
 * ArticleEditor — Stage 1 single-author plain text/markdown editor.
 *
 * NO CRDT, NO Yjs — those are Stage 2.
 * Feature-gated by VITE_HERMES_DOCS_ENABLED.
 */

import React, { useCallback, useState } from 'react';
import { useDocsStore, type SourceContext } from '../../store/hermesDocs';

export const TITLE_MAX = 200;
export const CONTENT_MAX = 500_000;

const DOCUMENT_TYPES = ['article', 'draft', 'proposal', 'report', 'letter'] as const;
type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface ArticleEditorProps {
  /** Pre-populated text from CommentComposer CTA */
  initialContent?: string;
  /** Source linkage from forum context */
  sourceContext?: SourceContext;
  /** Callback after save or publish */
  onComplete?: (docId: string) => void;
}

export const ArticleEditor: React.FC<ArticleEditorProps> = ({
  initialContent = '',
  sourceContext,
  onComplete,
}) => {
  const { enabled, createDraft, saveDraft, publishArticle, getDraft } = useDocsStore();

  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState(initialContent);
  const [docType, setDocType] = useState<DocumentType>('article');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  if (!enabled) return null;

  const titleLen = title.length;
  const contentLen = content.length;
  const titleOverLimit = titleLen > TITLE_MAX;
  const contentOverLimit = contentLen > CONTENT_MAX;
  const canSave = title.trim().length > 0 && content.trim().length > 0 && !titleOverLimit && !contentOverLimit;

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw.length <= TITLE_MAX) {
      setTitle(raw);
    } else {
      setTitle(raw.slice(0, TITLE_MAX));
    }
  }, []);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    if (raw.length <= CONTENT_MAX) {
      setContent(raw);
    } else {
      setContent(raw.slice(0, CONTENT_MAX));
    }
  }, []);

  const handleSave = useCallback(() => {
    if (!canSave || saving) return;
    setSaving(true);

    try {
      if (!docId) {
        const doc = createDraft(content, sourceContext);
        if (doc) {
          setDocId(doc.id);
          saveDraft(doc.id, { title, type: docType });
        }
      } else {
        saveDraft(docId, { title, encryptedContent: content, type: docType });
      }
    } finally {
      setSaving(false);
    }
  }, [canSave, saving, docId, content, sourceContext, createDraft, saveDraft, title, docType]);

  const handlePublish = useCallback(() => {
    if (!canSave || publishing || published) return;
    setPublishing(true);

    try {
      let currentDocId = docId;
      if (!currentDocId) {
        const doc = createDraft(content, sourceContext);
        if (!doc) return;
        currentDocId = doc.id;
        setDocId(currentDocId);
        saveDraft(currentDocId, { title, type: docType });
      } else {
        saveDraft(currentDocId, { title, encryptedContent: content, type: docType });
      }
      publishArticle(currentDocId);
      setPublished(true);
      onComplete?.(currentDocId);
    } finally {
      setPublishing(false);
    }
  }, [canSave, publishing, published, docId, content, sourceContext, createDraft, saveDraft, title, docType, publishArticle, onComplete]);

  return (
    <div
      className="mx-auto max-w-2xl space-y-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700"
      data-testid="article-editor"
    >
      <h2 className="text-lg font-semibold" data-testid="editor-heading">
        {published ? 'Article Published' : docId ? 'Edit Article' : 'New Article'}
      </h2>

      {/* Title */}
      <div>
        <input
          className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          placeholder="Article title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={handleTitleChange}
          disabled={published}
          data-testid="article-title-input"
        />
        <div className="mt-1 text-xs text-slate-400" data-testid="title-counter">
          {titleLen}/{TITLE_MAX}
        </div>
      </div>

      {/* Document type selector */}
      <div>
        <select
          className="rounded border px-3 py-1.5 text-sm"
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocumentType)}
          disabled={published}
          data-testid="doc-type-select"
        >
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div>
        <textarea
          className="w-full resize-y rounded border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400"
          rows={12}
          placeholder="Write your article (Markdown supported)..."
          value={content}
          onChange={handleContentChange}
          disabled={published}
          data-testid="article-content-input"
        />
        <div className="mt-1 text-xs text-slate-400" data-testid="content-counter">
          {contentLen.toLocaleString()}/{CONTENT_MAX.toLocaleString()}
        </div>
      </div>

      {/* Source linkage display */}
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
            onClick={handleSave}
            disabled={!canSave || saving}
            data-testid="save-draft-btn"
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            className="rounded bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handlePublish}
            disabled={!canSave || publishing}
            data-testid="publish-btn"
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      )}

      {published && (
        <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700" data-testid="published-banner">
          ✅ Article published successfully.
        </div>
      )}
    </div>
  );
};
