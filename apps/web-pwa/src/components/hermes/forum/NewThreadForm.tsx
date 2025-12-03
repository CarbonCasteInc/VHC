import React, { useState } from 'react';
import { Button } from '@vh/ui';
import { useForumStore } from '../../../store/hermesForum';

interface Props {
  sourceAnalysisId?: string;
  defaultTitle?: string;
}

export const NewThreadForm: React.FC<Props> = ({ sourceAnalysisId, defaultTitle }) => {
  const { createThread } = useForumStore();
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim() || busy) return;
    setBusy(true);
    try {
      await createThread(title.trim(), content.trim(), tags.split(',').map((t) => t.trim()).filter(Boolean), sourceAnalysisId);
      setTitle('');
      setContent('');
      setTags('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm dark:border-slate-700">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Start a new thread</p>
      <div className="mt-3 space-y-2">
        <input
          className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
          rows={4}
          placeholder="Content (Markdown)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <input
          className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
          placeholder="Tags (comma separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <Button size="sm" onClick={() => void handleSubmit()} disabled={busy || !title.trim() || !content.trim()}>
          {busy ? 'Posting…' : 'Post thread'}
        </Button>
      </div>
    </div>
  );
};
