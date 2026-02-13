import React, { useCallback, useMemo, useState } from 'react';
import { useForumStore } from '../../../store/hermesForum';
import { useForumPreferences } from '../../../hooks/useForumPreferences';
import { SlideToPost } from './SlideToPost';
import { Button } from '@vh/ui';

/** Reply character limits (spec-hermes-forum-v0 §2.4) */
export const REPLY_CHAR_LIMIT = 240;
export const REPLY_WARNING_THRESHOLD = 200;

interface Props {
  threadId: string;
  parentId?: string;
  /** When true this is a thread-creation context — no char cap */
  isThreadCreation?: boolean;
  onSubmit?: () => Promise<void> | void;
  onConvertToArticle?: (text: string) => void;
}

type Stance = 'concur' | 'counter' | 'discuss';

export const CommentComposer: React.FC<Props> = ({
  threadId,
  parentId,
  isThreadCreation,
  onSubmit,
  onConvertToArticle,
}) => {
  const { createComment } = useForumStore();
  const { slideToPostEnabled, setSlideToPostEnabled, commentPostCount, incrementCommentPostCount } =
    useForumPreferences();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [sliderValue, setSliderValue] = useState(50);
  const [overflowAttempted, setOverflowAttempted] = useState(false);

  const enforceLimit = !isThreadCreation;
  const charCount = content.length;
  const isWarning = enforceLimit && charCount >= REPLY_WARNING_THRESHOLD;
  const isAtLimit = enforceLimit && charCount >= REPLY_CHAR_LIMIT;
  const showCounter = enforceLimit && charCount >= REPLY_WARNING_THRESHOLD;
  const showCta = enforceLimit && (charCount >= REPLY_WARNING_THRESHOLD || overflowAttempted);
  const submitBlocked = enforceLimit && charCount > REPLY_CHAR_LIMIT;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const raw = e.target.value;
      if (enforceLimit && raw.length > REPLY_CHAR_LIMIT) {
        setContent(raw.slice(0, REPLY_CHAR_LIMIT));
        setOverflowAttempted(true);
        return;
      }
      setContent(raw);
    },
    [enforceLimit],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!enforceLimit) return;
      const paste = e.clipboardData.getData('text');
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = content.slice(0, start);
      const after = content.slice(end);
      const combined = before + paste + after;
      if (combined.length > REPLY_CHAR_LIMIT) {
        e.preventDefault();
        const allowed = REPLY_CHAR_LIMIT - before.length - after.length;
        const truncated = before + paste.slice(0, Math.max(0, allowed)) + after;
        setContent(truncated.slice(0, REPLY_CHAR_LIMIT));
        setOverflowAttempted(true);
      }
    },
    [enforceLimit, content],
  );

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
    if (!content.trim() || busy || submitBlocked) return;

    setBusy(true);
    try {
      const stance = sliderToStance(sliderValue);
      await createComment(threadId, content.trim(), stance, parentId);
      setContent('');
      setSliderValue(50);
      setOverflowAttempted(false);
      incrementCommentPostCount();
      await onSubmit?.();
    } catch (err) {
      console.warn('[vh:forum] Comment post failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleConvertClick = () => {
    onConvertToArticle?.(content);
  };

  const counterColor = isAtLimit ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-slate-400';

  return (
    <div
      className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
      style={{ backgroundColor: 'var(--comment-card-bg)' }}
      data-testid="comment-composer-container"
    >
      <textarea
        className="w-full resize-none rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        style={{
          backgroundColor: 'var(--summary-card-bg)',
          color: 'var(--comment-text)',
          borderColor: 'var(--thread-muted)',
        }}
        rows={3}
        placeholder="Write your reply..."
        value={content}
        data-testid="comment-composer"
        disabled={busy}
        maxLength={enforceLimit ? REPLY_CHAR_LIMIT : undefined}
        onChange={handleChange}
        onPaste={handlePaste}
      />

      {showCounter && (
        <div className="flex items-center justify-between text-xs" data-testid="char-counter">
          <span className={counterColor} data-testid="char-count">
            {charCount}/{REPLY_CHAR_LIMIT}
          </span>
        </div>
      )}

      {showCta && (
        <div data-testid="convert-to-article-cta">
          <button
            className="text-sm font-medium text-teal-600 hover:text-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleConvertClick}
            disabled={!onConvertToArticle}
            title={onConvertToArticle ? 'Convert to Article' : 'Coming soon'}
            data-testid="convert-to-article-btn"
          >
            📝 Convert to Article
          </button>
        </div>
      )}

      <div className="space-y-3">
        <SlideToPost
          value={sliderValue}
          onChange={setSliderValue}
          onCommit={slideToPostActive ? () => void handlePost() : undefined}
          disabled={!content.trim() || busy || submitBlocked}
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
            disabled={!content.trim() || busy || submitBlocked}
            data-testid="submit-comment-btn"
          >
            {busy ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </div>
    </div>
  );
};
