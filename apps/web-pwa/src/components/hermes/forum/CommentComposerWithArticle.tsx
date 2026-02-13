/**
 * CommentComposerWithArticle — integrates CommentComposer with ArticleEditor.
 *
 * When a reply exceeds 240 chars and the user clicks "Convert to Article",
 * this component shows the ArticleEditor pre-populated with the draft text.
 */

import React, { useCallback, useState } from 'react';
import { CommentComposer } from './CommentComposer';
import { ArticleEditor } from '../../docs/ArticleEditor';
import type { SourceContext } from '../../../store/hermesDocs';

export interface CommentComposerWithArticleProps {
  threadId: string;
  parentId?: string;
  isThreadCreation?: boolean;
  onSubmit?: () => Promise<void> | void;
  /** Source context for linking articles back to forum threads */
  sourceContext?: SourceContext;
}

export const CommentComposerWithArticle: React.FC<
  CommentComposerWithArticleProps
> = ({ threadId, parentId, isThreadCreation, onSubmit, sourceContext }) => {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftContent, setDraftContent] = useState('');

  const handleConvertToArticle = useCallback(
    (text: string) => {
      setDraftContent(text);
      setEditorOpen(true);
    },
    [],
  );

  const handleEditorComplete = useCallback(() => {
    setEditorOpen(false);
    setDraftContent('');
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
  }, []);

  const resolvedSourceContext: SourceContext | undefined = sourceContext ?? {
    sourceThreadId: threadId,
  };

  if (editorOpen) {
    return (
      <div data-testid="article-editor-overlay">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">
            Converting reply to article
          </span>
          <button
            className="text-sm text-slate-500 hover:text-slate-700"
            onClick={handleEditorClose}
            data-testid="close-editor-btn"
          >
            ✕ Back to reply
          </button>
        </div>
        <ArticleEditor
          initialContent={draftContent}
          sourceContext={resolvedSourceContext}
          onComplete={handleEditorComplete}
        />
      </div>
    );
  }

  return (
    <CommentComposer
      threadId={threadId}
      parentId={parentId}
      isThreadCreation={isThreadCreation}
      onSubmit={onSubmit}
      onConvertToArticle={handleConvertToArticle}
    />
  );
};
