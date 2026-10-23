import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import express from 'express';
import { processEntries } from '../services/autoReplyService.js';
import { maskId } from '../utils/maskId.js';
import { safeEqual } from '../utils/safeEqual.js';

const router = express.Router();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Webhook verification (GET)
//
// When the Callback URL is saved in the Meta App Dashboard, Meta sends a GET
// request to it with three query parameters:
//   hub.mode          always "subscribe"
//   hub.verify_token  the Verify Token typed into the dashboard
//   hub.challenge     a random string
// If the token matches ours, we must answer 200 and echo hub.challenge back as
// the raw response body. Anything else is rejected with 403.
router.get('/', (req, res) => {
  // Express 5 uses the "simple" query parser, so these dotted keys stay flat.
  // Repeated params (?hub.mode=a&hub.mode=b) become arrays, hence the string checks.
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  let reason = null;
  if (mode !== 'subscribe') {
    reason = 'invalid_mode';
  } else if (typeof token !== 'string' || !safeEqual(token, requireEnv('META_VERIFY_TOKEN'))) {
    reason = 'token_mismatch';
  } else if (typeof challenge !== 'string' || challenge === '') {
    reason = 'missing_challenge';
  }

  if (reason) {
    // Only the reason code is logged, never the token or the challenge.
    console.warn(`[webhook] verification rejected: ${reason}`);
    return res.sendStatus(403);
  }

  console.log('[webhook] verification succeeded');
  return res.status(200).type('text/plain').send(challenge);
});

// Signature validation (POST)
//
// Meta signs every event delivery and puts the result in the X-Hub-Signature-256
// header as "sha256=" + hex(HMAC-SHA256(raw request body, App Secret)). We
// recompute the HMAC with our App Secret over the exact bytes we received and
// compare. This proves the request came from Meta and was not altered. It only
// works on the untouched raw body: re-serialising parsed JSON can change key
// order, whitespace or escaping, which is why this route uses express.raw().
const SIGNATURE_FORMAT = /^sha256=[0-9a-f]{64}$/i;

// Returns null when the signature is valid, otherwise a short reason code.
function signatureProblem(header, rawBody) {
  if (typeof header !== 'string' || header === '') return 'missing_signature';
  if (!SIGNATURE_FORMAT.test(header)) return 'malformed_signature';

  const hmac = crypto.createHmac('sha256', requireEnv('META_APP_SECRET'));
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

// Event delivery (POST)
router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  // express.raw() leaves req.body undefined (or {}) when the content type does
  // not match or the body is empty. Validate against an empty Buffer in that
  // case so such requests go through the same check and are rejected.
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  // Nothing is parsed or trusted until the signature has been verified.
  const problem = signatureProblem(req.get('x-hub-signature-256'), rawBody);
  if (problem) {
    console.warn(`[webhook] event rejected: ${problem}`);
    return res.sendStatus(403);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.warn('[webhook] event rejected: invalid_json');
    return res.sendStatus(400);
  }

  if (!isObject(payload)) {
    console.warn('[webhook] event rejected: invalid_payload');
    return res.sendStatus(400);
  }
  if (payload.object !== 'page') {
    console.warn('[webhook] event rejected: unsupported_object');
    return res.sendStatus(404);
  }
  if (!Array.isArray(payload.entry)) {
    console.warn('[webhook] event rejected: invalid_entry');
    return res.sendStatus(400);
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

  // Meta only needs a quick 200, so acknowledge first. The automatic replies
  // are sent afterwards (fire-and-forget); processEntries never rejects, the
  // catch is only a safety net. On Vercel, waitUntil keeps the function alive
  // until the replies are sent; elsewhere it does nothing.
  res.status(200).type('text/plain').send('EVENT_RECEIVED');
  const replying = processEntries(payload.entry).catch((err) => {
    console.error('[AutoReply] Unexpected error', err?.name);
  });
  waitUntil(replying);
});

export default router;
