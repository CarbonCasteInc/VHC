import React, { useState } from 'react';
import { Button } from '@vh/ui';
import { useForumStore } from '../../../store/hermesForum';

interface Props {
  threadId: string;
  parentId?: string;
  targetId?: string;
  type: 'reply' | 'counterpoint';
}

export const CommentComposer: React.FC<Props> = ({ threadId, parentId, targetId, type }) => {
  const { createComment } = useForumStore();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    try {
      await createComment(threadId, content.trim(), type, parentId, targetId);
      setContent('');
    } catch (err) {
      console.warn(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-card p-3 dark:border-slate-700">
      <textarea
        className="w-full resize-none rounded border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
        rows={3}
        placeholder={type === 'counterpoint' ? 'Add a counterpoint…' : 'Add a reply…'}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <Button size="sm" onClick={() => void handleSubmit()} disabled={!content.trim() || busy}>
        {busy ? 'Posting…' : 'Post'}
      </Button>
    </div>
  );
};
