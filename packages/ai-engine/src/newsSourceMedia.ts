const VIDEO_PATH_SEGMENT_REGEX = /\/(?:video|videos|watch|live)(?:\/|$)/i;
const VIDEO_QUERY_PARAM_REGEX = /(?:^|[?&])v=[^&]+/i;
const VIDEO_EXTENSION_REGEX = /\.(?:mp4|m3u8|mov|webm)(?:$|[?#])/i;
const VIDEO_HOST_SUFFIXES = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'dailymotion.com',
  'rumble.com',
  'twitch.tv',
];
const VIDEO_TITLE_REGEX =
  /^(?:video|watch|livestream|live video|clip)\b[:\-\s]?/i;

function hostnameMatchesVideoHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return VIDEO_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

export function isLikelyVideoUrl(rawUrl: string): boolean {
  const normalized = rawUrl.trim();
  if (!normalized) {
    return false;
  }

  if (VIDEO_EXTENSION_REGEX.test(normalized)) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return false;
  }

  if (hostnameMatchesVideoHost(parsed.hostname)) {
    return true;
  }

  const pathname = parsed.pathname.toLowerCase();
  if (VIDEO_PATH_SEGMENT_REGEX.test(pathname)) {
    return true;
  }

  return VIDEO_QUERY_PARAM_REGEX.test(parsed.search);
}

export function isLikelyVideoTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim();
  if (!normalized) {
    return false;
  }

  return VIDEO_TITLE_REGEX.test(normalized);
}

export function isLikelyVideoSourceEntry(entry: {
  readonly url: string;
  readonly title?: string | null;
}): boolean {
  return isLikelyVideoUrl(entry.url) || isLikelyVideoTitle(entry.title);
}

export const newsSourceMediaInternal = {
  hostnameMatchesVideoHost,
  VIDEO_EXTENSION_REGEX,
  VIDEO_HOST_SUFFIXES,
  VIDEO_PATH_SEGMENT_REGEX,
  VIDEO_QUERY_PARAM_REGEX,
  VIDEO_TITLE_REGEX,
};
