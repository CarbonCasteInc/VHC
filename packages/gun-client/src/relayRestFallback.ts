interface BrowserLocationLike {
  readonly href?: string;
  readonly origin?: string;
  readonly protocol?: string;
}

function browserLocation(): BrowserLocationLike | null {
  const candidate = (globalThis as { location?: BrowserLocationLike }).location;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

function normalizeEndpointPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function resolveRelayRestEndpointFromPeer(peer: string, path: string): string | null {
  try {
    const location = browserLocation();
    const base = typeof location?.href === 'string' && location.href
      ? location.href
      : 'http://127.0.0.1/';
    const url = new URL(peer, base);
    if (url.protocol === 'wss:') {
      url.protocol = 'https:';
    } else if (url.protocol === 'ws:') {
      url.protocol = 'http:';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    const endpointPath = normalizeEndpointPath(path);
    if (
      location
      && location.protocol === 'https:'
      && url.protocol === 'https:'
      && typeof location.origin === 'string'
      && location.origin
      && location.origin !== url.origin
    ) {
      return `${location.origin}${endpointPath}`;
    }
    return `${url.origin}${endpointPath}`;
  } catch {
    return null;
  }
}
