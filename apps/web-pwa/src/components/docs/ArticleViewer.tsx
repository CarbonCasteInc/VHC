/**
 * ArticleViewer — Read-only render of a published HermesDocument.
 *
 * Feature-gated by VITE_HERMES_DOCS_ENABLED.
 */

import React from 'react';
import { useDocsStore } from '../../store/hermesDocs';

export interface ArticleViewerProps {
  docId: string;
}

export const ArticleViewer: React.FC<ArticleViewerProps> = ({ docId }) => {
  const { enabled, getDraft } = useDocsStore();

  if (!enabled) return null;

  const doc = getDraft(docId);
  if (!doc) {
    return (
      <div className="text-sm text-slate-400" data-testid="article-not-found">
        Article not found.
      </div>
    );
  }

  const publishedDate = doc.publishedAt
    ? new Date(doc.publishedAt).toLocaleDateString()
    : null;

  return (
    <article
      className="mx-auto max-w-2xl space-y-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700"
      data-testid="article-viewer"
    >
      <h1 className="text-xl font-bold" data-testid="article-title">
        {doc.title}
      </h1>

      <div className="flex gap-2 text-xs text-slate-400" data-testid="article-meta">
        <span>Type: {doc.type}</span>
        {publishedDate && <span>· Published: {publishedDate}</span>}
        <span>· By: {doc.owner}</span>
      </div>

      <div
        className="prose prose-sm max-w-none whitespace-pre-wrap"
        data-testid="article-content"
      >
        {doc.encryptedContent}
      </div>

      {doc.sourceTopicId && (
        <div className="text-xs text-slate-400" data-testid="article-source">
          Source topic: {doc.sourceTopicId}
          {doc.sourceThreadId && ` · Thread: ${doc.sourceThreadId}`}
        </div>
      )}
    </article>
  );
};
