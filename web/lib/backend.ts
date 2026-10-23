// Where the Express API lives. Server-only: used by proxy.ts and the public product
// preview route (app/p/[id]/route.ts).

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3000';

// Base URL without a trailing slash, or null when it is not a plain http(s) URL.
// Credentials, query strings and fragments are rejected because paths are appended to it.
// Read per call so an edited .env.local applies without a restart.
export function getBackendUrl(): string | null {
  const raw = (process.env.BACKEND_API_URL ?? '').trim() || DEFAULT_BACKEND_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
