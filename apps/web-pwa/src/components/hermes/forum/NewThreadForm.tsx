import React, { useState } from 'react';
import type { HermesThread } from '@vh/types';
import { useForumStore } from '../../../store/hermesForum';

interface Props {
  sourceSynthesisId?: string;
  sourceEpoch?: number;
  defaultTitle?: string;
  sourceUrl?: string;
  topicId?: string;
  threadId?: string;
  onSuccess?: (thread: HermesThread) => void;
}

export const NewThreadForm: React.FC<Props> = ({
  sourceSynthesisId,
  sourceEpoch,
  defaultTitle,
  sourceUrl,
  topicId,
  threadId,
  onSuccess,
}) => {
  const { createThread } = useForumStore();
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const opts = sourceUrl || topicId || threadId
        ? {
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(topicId ? { topicId } : {}),
            ...(threadId ? { threadId } : {}),
            isHeadline: true as const,
          }
        : undefined;
      const thread = await createThread(
        title.trim(),
        content.trim(),
        parsedTags,
        sourceSynthesisId ? { sourceSynthesisId, sourceEpoch } : undefined,
        opts,
      );
      setTitle('');
      setContent('');
      setTags('');
      onSuccess?.(thread);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Thread creation failed';
      console.warn('[vh:forum] Thread creation failed:', err);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = { backgroundColor: 'var(--summary-card-bg)', color: 'var(--thread-text)', borderColor: 'var(--thread-muted)' };

  return (
    <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: 'var(--thread-surface)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--thread-title)' }}>Start a new thread</p>
      <div className="mt-3 space-y-2">
        <input
          className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          style={inputStyle}
          placeholder="Title"
          value={title}
          data-testid="thread-title"
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          style={inputStyle}
          rows={4}
          placeholder="Content (Markdown)"
          value={content}
          data-testid="thread-content"
          onChange={(e) => setContent(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          style={inputStyle}
          placeholder="Tags (comma separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition hover:shadow-md disabled:opacity-50"
          style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
          onClick={() => void handleSubmit()}
          disabled={busy || !title.trim() || !content.trim()}
          data-testid="submit-thread-btn"
        >
          {busy ? 'Posting…' : 'Post thread'}
        </button>
        {error && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            role="alert"
            data-testid="thread-form-error"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
};
