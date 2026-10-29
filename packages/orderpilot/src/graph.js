// The one place that talks to the Graph API (graph.facebook.com), shared by the Messenger client
// and connect().
//
// No function here throws or rejects. Each resolves to { ok: true, body } (a JSON object) or to
//   { ok: false, reason, status, error, hint }
// and never contains the access token. The token travels in the Authorization header only, never
// in the URL. This module does not log anything.

export const SEND_TIMEOUT_MS = 10_000;

const MAX_ERROR_TEXT_LENGTH = 200;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const failure = (reason, { status = null, error = null, hint = null } = {}) => ({
  ok: false,
  reason,
  status,
  error,
  hint,
});

// fetch() with AbortSignal.timeout() rejects with a DOMException named
// 'TimeoutError' (or 'AbortError' on some runtimes); everything else is a network problem.
const isTimeout = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

// The body is read as text first so an empty or non-JSON body can never throw.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hintFor(code, subcode) {
  if (code === 190) return 'invalid_access_token';
  if (code === 10 && subcode === 2018278) return 'outside_messaging_window';
  if (code === 10 || code === 200) return 'permission_denied';
  if (code === 100) return 'invalid_parameter';
  if (code === 551) return 'recipient_unavailable';
  if ([4, 17, 32, 613].includes(code)) return 'rate_limited';
  return null;
}

// Copies only the fields we log. Strings are redacted before they are cut, so
// a token that straddles the length limit cannot leak as a prefix.
function normalizeGraphError(graphError, accessToken) {
  const safeText = (value) =>
    typeof value === 'string' && value !== ''
      ? value.replaceAll(accessToken, '[redacted]').slice(0, MAX_ERROR_TEXT_LENGTH)
      : null;
  const safeInt = (value) => (Number.isInteger(value) ? value : null);

  return {
    code: safeInt(graphError.code),
    subcode: safeInt(graphError.error_subcode),
    type: safeText(graphError.type),
    fbtraceId: safeText(graphError.fbtrace_id),
    message: safeText(graphError.message),
  };
}

// `path` under `version`, authorised with `accessToken`.
export async function callGraph(
  { accessToken, version },
  path,
  { method = 'GET', body: requestBody, timeoutMs = SEND_TIMEOUT_MS } = {},
) {
  let status;
  let rawBody;
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(requestBody !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(requestBody !== undefined && { body: JSON.stringify(requestBody) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = Number.isInteger(res.status) ? res.status : null;
    rawBody = await res.text();
  } catch (err) {
    return failure(isTimeout(err) ? 'timeout' : 'network');
  }

  const body = parseJson(rawBody);

  // A Graph "error" object wins over the status code, even on a 2xx.
  if (isObject(body) && isObject(body.error)) {
    const error = normalizeGraphError(body.error, accessToken);
    return failure('graph_error', { status, error, hint: hintFor(error.code, error.subcode) });
  }
  if (status === null || status < 200 || status >= 300) return failure('http_error', { status });

  // Anything that is not a JSON object (HTML, empty body, an array, ...) is invalid_response.
  if (!isObject(body)) return failure('invalid_response', { status });
  return { ok: true, body };
}

// What a caller may log about a failure: never the message text, never a token.
export const describeFailure = (result) => ({
  reason: result.reason,
  hint: result.hint,
  code: result.error?.code ?? null,
});
