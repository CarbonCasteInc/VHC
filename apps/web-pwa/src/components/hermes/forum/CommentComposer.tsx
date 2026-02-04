import React, { useMemo, useState } from 'react';
import { useForumStore } from '../../../store/hermesForum';
import { useForumPreferences } from '../../../hooks/useForumPreferences';
import { SlideToPost } from './SlideToPost';
import { Button } from '@vh/ui';

interface Props {
  threadId: string;
  parentId?: string;
  onSubmit?: () => Promise<void> | void;
}

type Stance = 'concur' | 'counter' | 'discuss';

export const CommentComposer: React.FC<Props> = ({ threadId, parentId, onSubmit }) => {
  const { createComment } = useForumStore();
  const { slideToPostEnabled, setSlideToPostEnabled, commentPostCount, incrementCommentPostCount } =
    useForumPreferences();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [sliderValue, setSliderValue] = useState(50);

  const sliderToStance = (pos: number): Stance => {
    if (pos <= 30) return 'concur';
    if (pos >= 70) return 'counter';
    return 'discuss';
  };

  const getButtonColor = (pos: number): string => {
    if (pos <= 30) return 'var(--concur-button)';
    if (pos >= 70) return 'var(--counter-button)';
    return 'var(--discuss-button)';
  };

  const slideToPostActive = slideToPostEnabled === true;
  const shouldPromptSlideToPost = slideToPostEnabled === null && commentPostCount >= 2 && !busy;
  const slideToPostStatus = useMemo(() => {
    if (slideToPostEnabled === null) return 'Off (default)';
    return slideToPostEnabled ? 'On' : 'Off';
  }, [slideToPostEnabled]);

  const handlePost = async () => {
    if (!content.trim() || busy) return;

    setBusy(true);
    try {
      const stance = sliderToStance(sliderValue);
      await createComment(threadId, content.trim(), stance, parentId);
      setContent('');
      setSliderValue(50);
      incrementCommentPostCount();
      await onSubmit?.();
    } catch (err) {
      console.warn('[vh:forum] Comment post failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
      style={{ backgroundColor: 'var(--comment-card-bg)' }}
      data-testid="comment-composer-container"
    >
      <textarea
        className="w-full resize-none rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        style={{ backgroundColor: 'var(--summary-card-bg)', color: 'var(--comment-text)', borderColor: 'var(--thread-muted)' }}
        rows={3}
        placeholder="Write your reply..."
        value={content}
        data-testid="comment-composer"
        disabled={busy}
        onChange={(e) => setContent(e.target.value)}
      />

      <div className="space-y-3">
        <SlideToPost
          value={sliderValue}
          onChange={setSliderValue}
          onCommit={slideToPostActive ? () => void handlePost() : undefined}
          disabled={!content.trim() || busy}
        />

        {shouldPromptSlideToPost && (
          <div
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm"
            data-testid="slide-to-post-prompt"
          >
            <p className="font-semibold">Enable Slide to Post?</p>
            <p className="mt-1 text-xs text-slate-600">
              After the first two posts, you can make replies faster by submitting on slider release. You can change
              this later in your Wallet settings. Current: {slideToPostStatus}.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setSlideToPostEnabled(true)}>
                Enable
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSlideToPostEnabled(false)}>
                Not now
              </Button>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <button
            className="rounded-lg px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: getButtonColor(sliderValue) }}
            onClick={() => void handlePost()}
            disabled={!content.trim() || busy}
            data-testid="submit-comment-btn"
          >
            {busy ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </div>
    </div>
  );
};
