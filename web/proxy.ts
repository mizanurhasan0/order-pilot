// Same-origin gateway to the Express API.
//
// The browser (services/http.ts) calls /api/* and /health on this Next.js server.
// This proxy checks that writes are same-origin, then rewrites the request to
// BACKEND_API_URL and adds X-Admin-Key for order routes. The key stays on the
// server and Express needs no CORS setup.
//
// There is no login: this dashboard is for testing, so anyone with its URL can see
// and change orders, locally or on Vercel. Use test data only.

import { NextResponse, type NextRequest } from 'next/server';
import type { ApiErrorCode } from '@/services/http';

export const config = {
  matcher: ['/api/:path*', '/health'],
};

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3000';

// The value shipped in .env.example. Treated as "not set" so a fresh checkout
// shows a setup hint instead of a confusing 401 from Express.
const ADMIN_KEY_PLACEHOLDER = 'put_the_exact_backend_admin_api_key_here';

// Only the Express routes the dashboard uses are reachable. Everything else under
// /api (for example the Messenger webhook) stays off this origin.
const isOrdersPath = (pathname: string) => pathname === '/api/orders' || pathname.startsWith('/api/orders/');
const isProductsPath = (pathname: string) => pathname === '/api/products' || pathname.startsWith('/api/products/');
const isAllowedPath = (pathname: string) => pathname === '/health' || isOrdersPath(pathname) || isProductsPath(pathname);

// Env is read per request so an edited .env.local applies without a restart. On Vercel
// both values come from the project's Environment Variables.

// Base URL without a trailing slash, or null when it is not a plain http(s) URL.
// Credentials, query strings and fragments are rejected because paths are appended to it.
function getBackendUrl(): string | null {
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

// The Express admin key, or null when it is missing, blank or still the placeholder.
function getAdminKey(): string | null {
  const key = (process.env.ADMIN_API_KEY ?? '').trim();
  return key === '' || key === ADMIN_KEY_PLACEHOLDER ? null : key;
}

// Errors carry a `code` that services/http.ts maps to ApiError. Nothing here may be
// cached: forwarded responses contain customer phone numbers and addresses.
function fail(status: number, code: ApiErrorCode, message: string): NextResponse {
  return NextResponse.json(
    { success: false, code, message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function originHostOf(origin: string | null): string | null {
  try {
    const url = new URL(origin ?? '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

const isJsonContentType = (value: string | null) =>
  (value ?? '').split(';')[0].trim().toLowerCase() === 'application/json';

export function proxy(request: NextRequest): NextResponse {
  const host = (request.headers.get('host') ?? '').trim().toLowerCase();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // CSRF: browsers always send Origin on PATCH, so a missing or foreign Origin
    // means the request did not come from this dashboard.
    if (originHostOf(request.headers.get('origin')) !== host) {
      return fail(403, 'FORBIDDEN', 'Cross-origin requests are not allowed.');
    }
    // Requiring JSON also rules out "simple" cross-site form posts.
    if (!isJsonContentType(request.headers.get('content-type'))) {
      return fail(415, 'BAD_REQUEST', 'Content-Type must be application/json.');
    }
  }

  // nextUrl.pathname is already normalised ("..", "%2e%2e"), and it is exactly the
  // path forwarded below, so this check and Express see the same route.
  const { pathname, search } = request.nextUrl;
  if (!isAllowedPath(pathname)) {
    return fail(404, 'NOT_FOUND', 'Not found.');
  }

  const ordersRoute = isOrdersPath(pathname);
  const adminKey = getAdminKey();
  if (ordersRoute && !adminKey) {
    return fail(503, 'NOT_CONFIGURED', 'Set ADMIN_API_KEY (web/.env.local, or the Vercel project settings) to the same value as the Express backend.');
  }

  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return fail(503, 'NOT_CONFIGURED', 'Set BACKEND_API_URL (web/.env.local, or the Vercel project settings) to a plain http(s) URL such as http://127.0.0.1:3000.');
  }

  // Never pass through a client-supplied key or this origin's cookies. The key is
  // attached only to order routes: products and health are public on Express.
  // Host is dropped so the backend sees its own host name, which Vercel routes by.
  const headers = new Headers(request.headers);
  headers.delete('x-admin-key');
  headers.delete('cookie');
  headers.delete('host');
  if (ordersRoute && adminKey) headers.set('X-Admin-Key', adminKey);

  // Concatenation (not new URL(path, base)) keeps any base path in BACKEND_API_URL.
  const response = NextResponse.rewrite(new URL(`${backendUrl}${pathname}${search}`), {
    request: { headers },
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
