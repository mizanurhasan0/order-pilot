import { getSendApiConfig, isAutoReplyEnabled } from '../config.js';
import { dedupeCache, orderStore, sessionStore } from '../store/index.js';
import { conversationKey } from '../store/sessionStore.js';
import { createKeyedQueue } from '../utils/keyedQueue.js';
import { maskId } from '../utils/maskId.js';
import { conversationService } from './conversationService.js';
import { sendOrderConfirmation, sendPhotoAndText, sendProductCatalog, sendTextMessage } from './messengerService.js';
import { parsePayload, referralPayload } from './payloads.js';

// The Messenger side of the order flow. For every webhook event it decides whether a real
// customer did something (typed text, tapped a quick reply or a button, sent an attachment,
// opened the chat through a product link),
// asks conversationService what to answer and sends those replies through the Send API.
//
// Events of ONE customer are handled and answered strictly in arrival order (per-customer
// queue); different customers run in parallel. The dedupe mark is made before anything is
// sent. Dedupe and sessions live in Redis when it is configured (see store/index.js), else in
// memory. The queue is always per process, so it orders one instance's events only.
//
// Logs carry rule names, ids and counts only. Message text, phone numbers, addresses, payload
// values (just their type), tokens and full PSIDs are never logged.

export { normalizeText } from '../utils/normalizeText.js';

const queue = createKeyedQueue();

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value !== '';

// --- reading an event ------------------------------------------------------------------

const payloadInput = (kind, payload) => ({
  kind,
  // A referral comes from a product link: the customer has not seen the product's card yet.
  input: { type: 'payload', payload, fromLink: kind === 'referral' },
  payloadType: parsePayload(payload)?.type ?? 'unknown', // the type prefix only, never the value
});

// What a message contains. One of our quick-reply payloads wins over its text; Messenger's own
// phone-number quick reply carries the number itself as payload, so it is read as the typed
// text it also contains. A message with only attachments (a photo, sticker, like, ...) reaches
// the conversation as { type: 'attachment' }: only the number of attachments is kept, their URLs
// are never read or fetched.
function readMessage(message) {
  const text = typeof message.text === 'string' ? message.text : '';
  const counts = {
    mid: message.mid,
    textLength: text.length,
    attachmentCount: Array.isArray(message.attachments) ? message.attachments.length : 0,
  };

  const quickReply = message.quick_reply?.payload;
  const isOurPayload = isNonEmptyString(quickReply) && (parsePayload(quickReply) !== null || text.trim() === '');
  if (isOurPayload) return { ...payloadInput('quick_reply', quickReply), ...counts };
  if (text.trim() !== '') return { kind: 'text', input: { type: 'text', text }, payloadType: null, ...counts };
  if (counts.attachmentCount > 0) {
    return { kind: 'attachment', input: { type: 'attachment' }, payloadType: null, ...counts };
  }
  return { kind: 'none', input: null, payloadType: null, ...counts };
}

// A new customer who opens the chat through a product link (see referralPayload) first taps
// Get Started, and Messenger puts the link's ref on that postback: the product wins over the
// welcome menu. Any other ref leaves the postback as it is.
function readPostback({ mid, payload, referral }) {
  const counts = { mid: isNonEmptyString(mid) ? mid : null, textLength: 0, attachmentCount: 0 };
  const fromLink = referralPayload(referral?.ref);
  if (fromLink) return { ...payloadInput('referral', fromLink), ...counts };
  return { ...payloadInput('postback', payload), ...counts };
}

// Describes what the customer did in an event that passed both skip checks.
function readCustomerInput(event) {
  if (isObject(event.message)) return readMessage(event.message);
  if (isObject(event.postback)) return readPostback(event.postback);

  // A customer who already chatted with the Page opened it again through a product link.
  const counts = { mid: null, textLength: 0, attachmentCount: 0 };
  return { ...payloadInput('referral', referralPayload(event.referral.ref)), ...counts };
}

// --- deciding whether to answer ----------------------------------------------------------

async function messageSkipReason(message, cache) {
  if (message.is_echo) return 'echo'; // a message our own Page sent: never answer it
  if (!isNonEmptyString(message.mid)) return 'no_mid';
  if (!(await cache.markIfNew(message.mid))) return 'duplicate';
  return readMessage(message).kind === 'none' ? 'no_content' : null;
}

// Messenger gives postbacks a mid; without one the sender, time and payload identify the tap.
async function postbackSkipReason(postback, event, cache) {
  if (!isNonEmptyString(postback.payload)) return 'no_payload';
  const key = isNonEmptyString(postback.mid)
    ? postback.mid
    : `postback:${event.sender.id}:${event.timestamp}:${postback.payload}`;
  return (await cache.markIfNew(key)) ? null : 'duplicate';
}

// Only a product link is answered. A plain link to the Page, an ad or any other ref asks for
// nothing, and the bot never writes first. Referrals have no mid: the sender, time and product
// identify the click.
async function referralSkipReason(referral, event, cache) {
  const payload = referralPayload(referral.ref);
  if (payload === null) return 'unsupported_referral';
  return (await cache.markIfNew(`referral:${event.sender.id}:${event.timestamp}:${payload}`)) ? null : 'duplicate';
}

// Why an event must not be answered, from its structure alone, or null when it is a message,
// postback or referral from a customer. No side effects, so it runs before the event is queued.
function structuralSkipReason(entry, event, pageId) {
  if (entry.id !== pageId) return 'page_mismatch';
  if (!isObject(event)) return 'invalid_event';

  const senderId = event.sender?.id;
  if (!isNonEmptyString(senderId)) return 'no_sender';
  if (senderId === pageId) return 'self_sender';
  const recipientId = event.recipient?.id;
  if (recipientId !== undefined && recipientId !== null && recipientId !== pageId) {
    return 'recipient_mismatch';
  }

  if (isObject(event.message) || isObject(event.postback) || isObject(event.referral)) return null;
  return 'unsupported_event'; // delivery, read, reaction, ...
}

// The remaining checks for an event that passed structuralSkipReason(), including the dedupe
// mark (the only side effect, made before sending so a concurrent retry of the same mid can't
// send twice). Resolves to null when it is a real customer action.
function contentSkipReason(event, cache) {
  if (isObject(event.message)) return messageSkipReason(event.message, cache);
  if (isObject(event.postback)) return postbackSkipReason(event.postback, event, cache);
  return referralSkipReason(event.referral, event, cache);
}

const logIgnored = (reason) => console.log('[Messenger] Ignored event', JSON.stringify({ reason }));

// --- logging -------------------------------------------------------------------------------

const failureDetails = ({ reason, hint, code }) => ({ reason, hint, code });

// A send can succeed in a degraded way: the product list as plain text instead of the cards, the
// cards delivered but not the navigation buttons, or a question sent without its product photo.
function logDegradedSend(result) {
  if (result.templateFailure) {
    console.warn(
      '[SendAPI] Catalog template failed, text fallback used',
      JSON.stringify(failureDetails(result.templateFailure)),
    );
  }
  if (result.navFailure) {
    console.warn('[SendAPI] Catalog navigation failed', JSON.stringify(failureDetails(result.navFailure)));
  }
  if (result.photoFailure) {
    console.warn(
      '[SendAPI] Product photo failed, text sent without it',
      JSON.stringify(failureDetails(result.photoFailure)),
    );
  }
}

function logSendResult(senderId, reply, result) {
  if (result?.ok === true) {
    console.log(
      '[SendAPI] Reply sent successfully',
      JSON.stringify({ senderId, rule: reply.rule, messageId: result.messageId ?? null, mode: result.mode }),
    );
    logDegradedSend(result);
    return;
  }
  console.error(
    '[SendAPI] Reply failed',
    JSON.stringify({
      senderId,
      rule: reply.rule,
      reason: result?.reason ?? null,
      status: result?.status ?? null,
      code: result?.error?.code ?? null,
      subcode: result?.error?.subcode ?? null,
      hint: result?.hint ?? null,
      fbtraceId: result?.error?.fbtraceId ?? null,
    }),
  );
}

// Ids and amounts only: the order holds a phone number and an address, which stay out of logs.
async function logOrderCreated(reply) {
  if (reply.rule !== 'order_confirmed' || !reply.orderId) return;
  const order = await orderStore.get(reply.orderId);
  if (!order) return;
  console.log(
    '[Order] Order created',
    JSON.stringify({
      orderId: order.id,
      productId: order.productId,
      quantity: order.quantity,
      subtotal: order.subtotal,
    }),
  );
}

// Only the error class is logged: messages can echo request details.
function logUnexpected(err) {
  const name = typeof err?.name === 'string' ? err.name : 'UnknownError';
  console.error('[AutoReply] Unexpected error', JSON.stringify({ name }));
}

// --- answering -----------------------------------------------------------------------------

const SENDERS = {
  text: (psid, reply) => sendTextMessage(psid, reply.text, { quickReplies: reply.quickReplies }),
  text_with_photo: (psid, { imageUrl, text, quickReplies }) => sendPhotoAndText(psid, { imageUrl, text, quickReplies }),
  catalog: (psid, reply) => sendProductCatalog(psid, reply),
  order_confirmation: (psid, reply) => sendOrderConfirmation(psid, { text: reply.text, draftId: reply.draftId }),
};

// Sends the replies one by one, in order. After the first failure the rest are dropped: the
// customer must not get a later message (say, the phone question) without the earlier one.
async function sendReplies(psid, replies, step) {
  const maskedPsid = maskId(psid);
  for (const reply of replies) {
    console.log('[AutoReply] Matching reply rule', JSON.stringify({ rule: reply.rule, step }));
    await logOrderCreated(reply);

    const result = await SENDERS[reply.kind](psid, reply);
    logSendResult(maskedPsid, reply, result);
    if (result?.ok !== true) return;
  }
}

// Runs in the customer's queue slot. The step is read AFTER handle(), so the log shows where
// the conversation is now.
async function answerCustomer(pageId, psid, input) {
  const replies = await conversationService.handle({ pageId, psid, input });
  const { step } = await sessionStore.get(conversationKey(pageId, psid));
  await sendReplies(psid, replies, step);
}

async function handleEvent(entry, event, pageId, cache) {
  try {
    const structural = structuralSkipReason(entry, event, pageId);
    if (structural) {
      logIgnored(structural);
      return;
    }

    // The dedupe check and the queue slot both start before anything is awaited, so one
    // customer's events keep their arrival order even when the checks (Redis round trips with a
    // Redis store) finish out of order. The slot of a skipped event does nothing.
    const psid = event.sender.id;
    const { input, kind, mid, payloadType, textLength, attachmentCount } = readCustomerInput(event);
    const skip = contentSkipReason(event, cache);
    const answered = queue.run(conversationKey(pageId, psid), async () => {
      if (await skip.catch(() => 'check_failed')) return; // reported below
      await answerCustomer(pageId, psid, input);
    });

    // Reported at once: a duplicate never waits behind a reply that is still in flight.
    const reason = await skip;
    if (reason) {
      logIgnored(reason);
      return;
    }
    console.log(
      '[Messenger] Incoming customer message',
      JSON.stringify({ pageId, senderId: maskId(psid), mid, kind, payloadType, textLength, attachmentCount }),
    );
    await answered;
  } catch (err) {
    logUnexpected(err);
  }
}

// Answers the customer actions in an already signature-verified webhook `entry` array.
// Never rejects, so the caller can fire and forget it after acknowledging Meta.
export async function processEntries(entries, options) {
  try {
    if (!isAutoReplyEnabled() || !Array.isArray(entries)) return;

    const cache = options?.cache ?? dedupeCache;
    const { pageId } = getSendApiConfig();
    const pending = [];
    for (const entry of entries) {
      if (!isObject(entry) || !Array.isArray(entry.messaging)) continue;
      for (const event of entry.messaging) {
        pending.push(handleEvent(entry, event, pageId, cache));
      }
    }
    await Promise.allSettled(pending);
  } catch (err) {
    logUnexpected(err);
  }
}
