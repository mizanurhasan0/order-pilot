import crypto from 'node:crypto';
import { describeSetting } from './config.js';
import { maskId } from './utils/maskId.js';
import { safeEqual } from './utils/safeEqual.js';

// The Messenger webhook: Meta's verification request (GET) and its signed event deliveries (POST).
//
// handleWebhook() is the framework-free core. Two adapters wrap it:
//   node(req, res, next?)   Express, Connect or plain node:http
//   fetchHandler(request)   Request -> Response (Next.js route handlers, Hono, Bun, Deno, Workers)
//
// Webhook verification (GET)
//
// When the Callback URL is saved in the Meta App Dashboard, Meta sends a GET
// request to it with three query parameters:
//   hub.mode          always "subscribe"
//   hub.verify_token  the Verify Token typed into the dashboard
//   hub.challenge     a random string
// If the token matches ours, we must answer 200 and echo hub.challenge back as
// the raw response body. Anything else is rejected with 403.
//
// Signature validation (POST)
//
// Meta signs every event delivery and puts the result in the X-Hub-Signature-256
// header as "sha256=" + hex(HMAC-SHA256(raw request body, App Secret)). We
// recompute the HMAC with our App Secret over the exact bytes we received and
// compare. This proves the request came from Meta and was not altered. It only
// works on the untouched raw body: re-serialising parsed JSON can change key
// order, whitespace or escaping, so the adapters read the raw bytes themselves.

export const MAX_BODY_BYTES = 1024 * 1024;

const SIGNATURE_FORMAT = /^sha256=[0-9a-f]{64}$/i;
const STATUS_TEXT = {
  200: 'OK',
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  503: 'Service Unavailable',
};
const TEXT_PLAIN = 'text/plain; charset=utf-8';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const plain = (status, body = STATUS_TEXT[status]) => ({ status, body });

// Only `application/json` bodies are read, like express.raw({ type: 'application/json' }).
const isJsonContentType = (value) => (value ?? '').split(';')[0].trim().toLowerCase() === 'application/json';

// Returns null when the signature is valid, otherwise a short reason code.
function signatureProblem(header, rawBody, appSecret) {
  if (typeof header !== 'string' || header === '') return 'missing_signature';
  if (!SIGNATURE_FORMAT.test(header)) return 'malformed_signature';

  const hmac = crypto.createHmac('sha256', appSecret);
  const expected = `sha256=${hmac.update(rawBody).digest('hex')}`;
  return safeEqual(header.toLowerCase(), expected) ? null : 'signature_mismatch';
}

// Classifies one messaging event and returns a log-safe description of it.
// Message text, attachment URLs, payload values and full PSIDs are never copied.
function describeEvent(event, pageId) {
  const timestamp = typeof event.timestamp === 'number' ? event.timestamp : null;
  const senderId = maskId(event.sender?.id);

  if (isObject(event.message)) {
    const { mid, text, attachments, is_echo: isEcho } = event.message;
    if (isEcho) {
      // Copy of a message our own Page sent; nothing to do with it.
      return { type: 'echo', pageId, mid: typeof mid === 'string' ? mid : null };
    }
    return {
      type: 'message',
      pageId,
      senderId,
      mid: typeof mid === 'string' ? mid : null,
      textLength: typeof text === 'string' ? text.length : 0,
      attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
      timestamp,
    };
  }

  if (isObject(event.postback)) {
    const { mid, payload, referral } = event.postback;
    return {
      type: 'postback',
      pageId,
      senderId,
      mid: typeof mid === 'string' ? mid : null,
      hasPayload: typeof payload === 'string' && payload !== '',
      hasRef: typeof referral?.ref === 'string' && referral.ref !== '', // Get Started through an m.me link
      timestamp,
    };
  }

  if (isObject(event.referral)) {
    // An existing chat opened again through an m.me link (messaging_referrals).
    const { ref } = event.referral;
    return { type: 'referral', pageId, senderId, hasRef: typeof ref === 'string' && ref !== '', timestamp };
  }

  // delivery, read, reaction, optin, ... : log which kind it was, nothing else.
  const envelopeKeys = ['sender', 'recipient', 'timestamp'];
  const kind = Object.keys(event).find((key) => !envelopeKeys.includes(key)) ?? 'none';
  return { type: 'unsupported', pageId, kind };
}

// One value per name: a repeated parameter (?hub.mode=a&hub.mode=b) counts as missing.
const single = (params, name) => {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
};

export function createWebhook({ settings, processEntries, waitUntil }) {
  function notConfigured(name) {
    console.error(`[webhook] not configured: ${describeSetting(name)} is missing`);
    return plain(503);
  }

  function verify(params) {
    const verifyToken = settings.verifyToken();
    if (!verifyToken) return notConfigured('verifyToken');

    const mode = single(params, 'hub.mode');
    const token = single(params, 'hub.verify_token');
    const challenge = single(params, 'hub.challenge');

    let reason = null;
    if (mode !== 'subscribe') {
      reason = 'invalid_mode';
    } else if (typeof token !== 'string' || !safeEqual(token, verifyToken)) {
      reason = 'token_mismatch';
    } else if (typeof challenge !== 'string' || challenge === '') {
      reason = 'missing_challenge';
    }

    if (reason) {
      // Only the reason code is logged, never the token or the challenge.
      console.warn(`[webhook] verification rejected: ${reason}`);
      return plain(403);
    }

    console.log('[webhook] verification succeeded');
    return plain(200, challenge);
  }

  function receive(rawBody, signature) {
    const appSecret = settings.appSecret();
    if (!appSecret) return notConfigured('appSecret');

    // Nothing is parsed or trusted until the signature has been verified.
    const problem = signatureProblem(signature, rawBody, appSecret);
    if (problem) {
      console.warn(`[webhook] event rejected: ${problem}`);
      return plain(403);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      console.warn('[webhook] event rejected: invalid_json');
      return plain(400);
    }

    if (!isObject(payload)) {
      console.warn('[webhook] event rejected: invalid_payload');
      return plain(400);
    }
    if (payload.object !== 'page') {
      console.warn('[webhook] event rejected: unsupported_object');
      return plain(404);
    }
    if (!Array.isArray(payload.entry)) {
      console.warn('[webhook] event rejected: invalid_entry');
      return plain(400);
    }

    // From here on the payload is signed by Meta. Malformed entries and events
    // are skipped rather than rejected, so Meta does not keep retrying delivery.
    const counts = {};
    let events = 0;
    let skipped = 0;

    for (const entry of payload.entry) {
      if (!isObject(entry)) {
        skipped += 1;
        continue;
      }
      if (!Array.isArray(entry.messaging)) continue;

      const pageId = typeof entry.id === 'string' ? entry.id : null;
      for (const event of entry.messaging) {
        if (!isObject(event)) {
          skipped += 1;
          continue;
        }
        const info = describeEvent(event, pageId);
        console.log('[webhook] event', JSON.stringify(info));
        counts[info.type] = (counts[info.type] ?? 0) + 1;
        events += 1;
      }
    }

    console.log('[webhook] received', JSON.stringify({ entries: payload.entry.length, events, skipped, counts }));

    // Meta only needs a quick 200, so the caller acknowledges first and the replies follow
    // (`work`). processEntries never rejects; the catch is only a safety net.
    const work = processEntries(payload.entry).catch((err) => {
      console.error('[AutoReply] Unexpected error', err?.name);
    });
    return { ...plain(200, 'EVENT_RECEIVED'), work };
  }

  // The framework-free core. `body` is the raw request body (a Buffer; empty when there is none).
  // Resolves to { status, body } plus `work` (the replies) for an accepted delivery.
  function handleWebhook({ method, query, headers, body }) {
    const params = query instanceof URLSearchParams ? query : new URLSearchParams(query ?? '');
    if (method === 'GET') return verify(params);
    if (method === 'POST') {
      const signature = typeof headers?.get === 'function' ? headers.get('x-hub-signature-256') : headers?.['x-hub-signature-256'];
      return receive(Buffer.isBuffer(body) ? body : Buffer.alloc(0), signature ?? undefined);
    }
    return plain(405);
  }

  // Keeps a serverless function alive until the replies are sent (Vercel's waitUntil, a Worker's
  // ctx.waitUntil). Without it, a long-running server simply carries on after the response.
  function keepAlive(work, extra) {
    const hook = typeof extra === 'function' ? extra : waitUntil;
    if (work && typeof hook === 'function') hook(work);
  }

  // ---------- Express, Connect, node:http ----------

  // The raw body: a Buffer an earlier express.raw() left in req.body, or the request stream.
  // Resolves to a Buffer, or rejects with an error carrying `status` (400, 413 or 415).
  function readNodeBody(req) {
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    if (!isJsonContentType(req.headers['content-type'])) return Promise.resolve(Buffer.alloc(0));
    if (req.readableEnded) {
      // Something (express.json(), a body parser) read the body already: the signature cannot be
      // checked any more. Mount the webhook before it.
      console.warn('[webhook] request body already consumed: mount the webhook before any body parser');
      return Promise.resolve(Buffer.alloc(0));
    }
    const encoding = (req.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
    if (encoding !== 'identity') return Promise.reject(Object.assign(new Error('Unsupported encoding'), { status: 415 }));
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Promise.reject(Object.assign(new Error('Payload too large'), { status: 413 }));
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        if (error) reject(error);
        else resolve(value);
      };
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          finish(Object.assign(new Error('Payload too large'), { status: 413 }));
          req.resume(); // drain the rest without keeping it
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => finish(null, Buffer.concat(chunks)));
      req.on('error', () => finish(Object.assign(new Error('Bad request body'), { status: 400 })));
      req.on('aborted', () => finish(Object.assign(new Error('Request aborted'), { status: 400 })));
    });
  }

  function send(res, { status, body }) {
    res.statusCode = status;
    res.setHeader('Content-Type', TEXT_PLAIN);
    res.end(body);
  }

  // Express: app.use('/webhook', bot.webhook) or app.get/post('/webhook', bot.webhook).
  // node:http: http.createServer(bot.webhook) or call it for the webhook path.
  async function node(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Mounted with app.use(): only the mount path itself is the webhook; a deeper path goes on.
    const mounted = typeof next === 'function' && req.route === undefined && req.baseUrl !== undefined;
    if (mounted && url.pathname !== '/') return next();
    if (req.method !== 'GET' && req.method !== 'POST') {
      if (typeof next === 'function') return next();
      res.setHeader('Allow', 'GET, POST');
      return send(res, plain(405));
    }

    let body = Buffer.alloc(0);
    if (req.method === 'POST') {
      try {
        body = await readNodeBody(req);
      } catch (err) {
        // Express gets the error, so its error handler answers as for any other bad body.
        if (typeof next === 'function') return next(err);
        return send(res, plain(err.status ?? 400));
      }
    }

    const result = handleWebhook({ method: req.method, query: url.searchParams, headers: req.headers, body });
    send(res, result);
    keepAlive(result.work);
  }

  // ---------- fetch-style: Request -> Response ----------

  // Next.js route handler: export const GET = bot.fetchHandler; export const POST = bot.fetchHandler;
  // A Worker can pass its context: (request, env, ctx) -> fetchHandler(request, { waitUntil: ctx.waitUntil.bind(ctx) }).
  // With no waitUntil at all, the replies are sent before the response, so a serverless platform
  // cannot stop them halfway.
  const toResponse = ({ status, body }) =>
    new Response(body, { status, headers: { 'Content-Type': TEXT_PLAIN, ...(status === 405 && { Allow: 'GET, POST' }) } });

  async function fetchHandler(request, context) {
    const url = new URL(request.url);
    let body = Buffer.alloc(0);
    if (request.method === 'POST' && isJsonContentType(request.headers.get('content-type'))) {
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return toResponse(plain(413));
      body = Buffer.from(await request.arrayBuffer());
      if (body.length > MAX_BODY_BYTES) return toResponse(plain(413));
    }

    const result = handleWebhook({ method: request.method, query: url.searchParams, headers: request.headers, body });
    const hook = typeof context?.waitUntil === 'function' ? context.waitUntil : waitUntil;
    if (result.work && typeof hook !== 'function') await result.work;
    else keepAlive(result.work, hook);
    return toResponse(result);
  }

  return { handleWebhook, node, fetchHandler };
}
