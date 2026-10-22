// Axios instance shared by every service.
//
// The browser calls same-origin paths (/api/*, /health). proxy.ts forwards them to
// BACKEND_API_URL and adds X-Admin-Key on the server, so the key never reaches the
// browser and Express needs no CORS setup.

import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

export type ApiErrorCode =
  | 'BAD_REQUEST' // 400: invalid query or body
  | 'UNAUTHORIZED' // 401: Express rejected the admin key
  | 'FORBIDDEN' // 403: blocked by the proxy (cross-origin write)
  | 'NOT_FOUND' // 404: order or product does not exist
  | 'NOT_CONFIGURED' // 503 from the proxy: ADMIN_API_KEY / BACKEND_API_URL missing
  | 'BACKEND_UNREACHABLE' // the proxy could not reach Express
  | 'TIMEOUT'
  | 'NETWORK' // the dashboard server itself is unreachable
  | 'SERVER_ERROR'; // any other unexpected response

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (error: unknown, code?: ApiErrorCode): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code);

// True for requests cancelled through an AbortSignal; callers should ignore these.
export const isCanceled = (error: unknown) => axios.isCancel(error);

const KNOWN_CODES = new Set<string>([
  'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'NOT_CONFIGURED',
  'BACKEND_UNREACHABLE', 'TIMEOUT', 'NETWORK', 'SERVER_ERROR',
]);

// Express answers { success: false, message }; the proxy adds a `code` to its own errors.
type ErrorBody = { success?: boolean; message?: unknown; code?: unknown };

const asErrorBody = (data: unknown): ErrorBody | null =>
  data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as ErrorBody) : null;

function codeForStatus(status: number, isEnvelope: boolean): ApiErrorCode {
  if (status === 400 || status === 413 || status === 415) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  // A 5xx without an Express envelope comes from Next failing to reach the backend.
  if (status >= 500 && !isEnvelope) return 'BACKEND_UNREACHABLE';
  return 'SERVER_ERROR';
}

const FALLBACK_MESSAGES: Record<ApiErrorCode, string> = {
  BAD_REQUEST: 'The request was not accepted.',
  UNAUTHORIZED: 'The Express backend rejected the admin key.',
  FORBIDDEN: 'This request was blocked.',
  NOT_FOUND: 'Not found.',
  NOT_CONFIGURED: 'The dashboard is not configured.',
  BACKEND_UNREACHABLE: 'Cannot reach the Express backend. Is it running, and is BACKEND_API_URL right?',
  TIMEOUT: 'The Express backend took too long to answer.',
  NETWORK: 'Cannot reach the dashboard server.',
  SERVER_ERROR: 'The backend returned an unexpected response.',
};

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!(error instanceof AxiosError)) return new ApiError(FALLBACK_MESSAGES.SERVER_ERROR, 'SERVER_ERROR', 0);

  if (error.code === AxiosError.ECONNABORTED || error.code === AxiosError.ETIMEDOUT) {
    return new ApiError(FALLBACK_MESSAGES.TIMEOUT, 'TIMEOUT', 0);
  }
  if (!error.response) return new ApiError(FALLBACK_MESSAGES.NETWORK, 'NETWORK', 0);

  const { status, data } = error.response;
  const body = asErrorBody(data);
  const isEnvelope = body?.success === false;
  const code = typeof body?.code === 'string' && KNOWN_CODES.has(body.code)
    ? (body.code as ApiErrorCode)
    : codeForStatus(status, isEnvelope);
  // Express validation messages are safe to show ("status must be one of: ...").
  const message = isEnvelope && typeof body?.message === 'string' && body.message.trim()
    ? body.message
    : FALLBACK_MESSAGES[code];
  return new ApiError(message, code, status);
}

export const http = axios.create({
  baseURL: '/',
  timeout: 10_000,
  headers: { Accept: 'application/json' },
});

// Every failure leaves the client as an ApiError; cancellations pass through untouched.
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(isCanceled(error) ? error : toApiError(error)),
);

type Envelope<T> = { success: true; data: T };

// GET/PATCH helpers that unwrap Express's { success, data, ...meta } envelope.
export async function request<T extends { data: unknown }>(config: AxiosRequestConfig): Promise<T> {
  const response = await http.request<Envelope<unknown> & Record<string, unknown>>(config);
  const body = response.data;
  if (body === null || typeof body !== 'object' || body.success !== true || !('data' in body)) {
    throw new ApiError(FALLBACK_MESSAGES.SERVER_ERROR, 'SERVER_ERROR', response.status);
  }
  const rest: Record<string, unknown> = { ...body };
  delete rest.success;
  return rest as T;
}
