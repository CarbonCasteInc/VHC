import { useCallback, useState } from 'react';

export type SlideToPostSetting = boolean | null;

const SLIDE_TO_POST_KEY = 'vh_forum_slide_to_post_v1';
const COMMENT_POST_COUNT_KEY = 'vh_forum_comment_post_count_v1';

function getStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function readSlideToPostSetting(): SlideToPostSetting {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SLIDE_TO_POST_KEY);
    if (raw === null) return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function writeSlideToPostSetting(value: boolean) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(SLIDE_TO_POST_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

function readCommentPostCount(): number {
  const storage = getStorage();
  if (!storage) return 0;
  try {
    const raw = storage.getItem(COMMENT_POST_COUNT_KEY);
    const parsed = raw ? Number(raw) : 0;
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

function writeCommentPostCount(count: number) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(COMMENT_POST_COUNT_KEY, String(count));
  } catch {
    /* ignore */
  }
}

export function useForumPreferences() {
  const [slideToPostEnabled, setSlideToPostEnabledState] = useState<SlideToPostSetting>(() => readSlideToPostSetting());
  const [commentPostCount, setCommentPostCount] = useState(() => readCommentPostCount());

  const setSlideToPostEnabled = useCallback((value: boolean) => {
    setSlideToPostEnabledState(value);
    writeSlideToPostSetting(value);
  }, []);

  const incrementCommentPostCount = useCallback(() => {
    const next = readCommentPostCount() + 1;
    writeCommentPostCount(next);
    setCommentPostCount(next);
    return next;
  }, []);

  return {
    slideToPostEnabled,
    setSlideToPostEnabled,
    commentPostCount,
    incrementCommentPostCount
  };
}
