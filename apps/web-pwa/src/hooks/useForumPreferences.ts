import { useCallback, useState } from 'react';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

export type SlideToPostSetting = boolean | null;

const SLIDE_TO_POST_KEY = 'vh_forum_slide_to_post_v1';
const COMMENT_POST_COUNT_KEY = 'vh_forum_comment_post_count_v1';

function readSlideToPostSetting(): SlideToPostSetting {
  const raw = safeGetItem(SLIDE_TO_POST_KEY);
  if (raw === null) return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

function writeSlideToPostSetting(value: boolean) {
  safeSetItem(SLIDE_TO_POST_KEY, value ? 'true' : 'false');
}

function readCommentPostCount(): number {
  const raw = safeGetItem(COMMENT_POST_COUNT_KEY);
  const parsed = raw ? Number(raw) : 0;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function writeCommentPostCount(count: number) {
  safeSetItem(COMMENT_POST_COUNT_KEY, String(count));
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
