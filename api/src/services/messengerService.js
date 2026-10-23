import { getSendApiConfig, invalidSendApiVars } from '../config.js';
import {
  CANCEL_ORDER_PAYLOAD,
  MENU_PAYLOAD,
  catalogPagePayload,
  confirmOrderPayload,
  orderProductPayload,
} from './payloads.js';

// Messenger Send API client (official Graph API endpoint): text with quick replies,
// generic (carousel) templates and button templates.
//
// There are deliberately no retries: after a timeout or a 5xx we cannot know
// whether Meta already delivered the message, and retrying could send the
// customer the same reply twice. The caller logs the result and moves on.
//
// No function here throws or rejects. Each resolves to either
//   { ok: true, messageId, recipientId }   (+ mode / navFailure / templateFailure)
//   { ok: false, reason, status, error, hint }
// and never contains the access token. Bad arguments give 'invalid_input' before
// any network call. This module does not log anything.

export const SEND_TIMEOUT_MS = 10_000;

const MAX_TEXT_LENGTH = 2000; // Messenger's limit for a text message
const MAX_ERROR_TEXT_LENGTH = 200;
const MAX_ELEMENTS = 10; // cards in one carousel
const MAX_BUTTONS = 3; // buttons per card / button template
const MAX_QUICK_REPLIES = 13;
const MAX_CARD_TEXT = 80; // card title and subtitle
const MAX_LABEL = 20; // button and quick reply titles
const MAX_BUTTON_TEMPLATE_TEXT = 640;
const MAX_PAYLOAD_LENGTH = 1000;
const IMAGE_ASPECT_RATIOS = ['square', 'horizontal'];
const RECIPIENT_FORMAT = /^\d+$/;

const LABELS = {
  order: 'Order Now',
  product: '🛒',
  confirm: '✅ Confirm',
  cancel: '❌ Cancel',
  previous: '◀ Previous',
  next: 'Next ▶',
  menu: 'Menu',
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isMissing = (value) => value === undefined || value === null;
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isValidRecipient = (value) => typeof value === 'string' && RECIPIENT_FORMAT.test(value);
const isValidText = (value) => isNonEmptyString(value) && value.length <= MAX_TEXT_LENGTH;
const countChars = (text) => Array.from(text).length;

const failure = (reason, { status = null, error = null, hint = null } = {}) => ({
  ok: false,
  reason,
  status,
  error,
  hint,
});

// ---------- Builders (pure: the Send API object, or null for bad input) ----------

// Cuts by Unicode code points (never inside an emoji) and ends with "…" when something
// was removed, so the result has at most `max` characters.
function truncate(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

const isHttpsUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const isLabelled = (item) =>
  isObject(item) &&
  isNonEmptyString(item.title) &&
  isNonEmptyString(item.payload) &&
  item.payload.length <= MAX_PAYLOAD_LENGTH;

// Messenger fills this quick reply with the phone number on the customer's Facebook profile
// (and leaves it out when there is none). The tap arrives as a message whose text is the number.
const PHONE_QUICK_REPLY = 'user_phone_number';
const isPhoneQuickReply = (item) => isObject(item) && item.type === PHONE_QUICK_REPLY;

const button = ({ title, payload }) => ({ type: 'postback', title: truncate(title, MAX_LABEL), payload });
const quickReply = (item) =>
  isPhoneQuickReply(item)
    ? { content_type: PHONE_QUICK_REPLY }
    : { content_type: 'text', title: truncate(item.title, MAX_LABEL), payload: item.payload };

// Maps a list of { title, payload } items with `build`; null if the list or an item is bad.
function buildLabelled(items, { min, max, build, isValid = isLabelled }) {
  if (!Array.isArray(items) || items.length < min || items.length > max) return null;
  const list = Array.from(items); // turns holes of a sparse array into undefined
  return list.every(isValid) ? list.map(build) : null;
}

const buildButtons = (buttons) => buildLabelled(buttons, { min: 1, max: MAX_BUTTONS, build: button });

// A missing list means "no quick replies" (an empty array does too).
const buildQuickReplies = (items) =>
  isMissing(items)
    ? []
    : buildLabelled(items, {
        min: 0,
        max: MAX_QUICK_REPLIES,
        build: quickReply,
        isValid: (item) => isLabelled(item) || isPhoneQuickReply(item),
      });

// subtitle and imageUrl are optional; when given they must be valid.
function buildElement(element) {
  if (!isObject(element) || !isNonEmptyString(element.title)) return null;
  const buttons = buildButtons(element.buttons);
  if (buttons === null) return null;

  const hasSubtitle = !isMissing(element.subtitle);
  const hasImage = !isMissing(element.imageUrl);
  if (hasSubtitle && !isNonEmptyString(element.subtitle)) return null;
  if (hasImage && !isHttpsUrl(element.imageUrl)) return null;

  return {
    title: truncate(element.title, MAX_CARD_TEXT),
    ...(hasSubtitle && { subtitle: truncate(element.subtitle, MAX_CARD_TEXT) }),
    ...(hasImage && { image_url: element.imageUrl }),
    buttons,
  };
}

const templateMessage = (payload) => ({ attachment: { type: 'template', payload } });

function genericMessage(elements, imageAspectRatio) {
  if (!Array.isArray(elements) || elements.length < 1 || elements.length > MAX_ELEMENTS) return null;
  if (!IMAGE_ASPECT_RATIOS.includes(imageAspectRatio)) return null;
  const built = Array.from(elements, buildElement);
  if (built.includes(null)) return null;
  return templateMessage({
    template_type: 'generic',
    image_aspect_ratio: imageAspectRatio,
    elements: built,
  });
}

function buttonMessage(text, buttons) {
  const built = buildButtons(buttons);
  if (!isNonEmptyString(text) || built === null) return null;
  return templateMessage({
    template_type: 'button',
    text: truncate(text, MAX_BUTTON_TEMPLATE_TEXT),
    buttons: built,
  });
}

// "P001 · Name – ৳1250". The code matches the catalog's quick replies; a long name is
// shortened, never the code or the price.
function productElement(product) {
  const valid =
    isObject(product) &&
    isNonEmptyString(product.id) &&
    isNonEmptyString(product.name) &&
    Number.isSafeInteger(product.price) &&
    product.price > 0 &&
    isHttpsUrl(product.imageUrl);
  if (!valid) return null;

  const prefix = `${product.id} · `;
  const suffix = ` – ৳${product.price}`;
  return {
    title: `${prefix}${truncate(product.name.trim(), MAX_CARD_TEXT - countChars(prefix) - countChars(suffix))}${suffix}`,
    subtitle: isNonEmptyString(product.description) ? product.description : undefined,
    imageUrl: product.imageUrl,
    buttons: [{ title: LABELS.order, payload: orderProductPayload(product.id) }],
  };
}

// One "🛒 P001" quick reply per product on the page (a tap starts the order like Order Now),
// then Previous / Next only when there is such a page, and Menu.
function catalogQuickReplies(products, page, totalPages) {
  const valid = Number.isInteger(page) && Number.isInteger(totalPages) && page >= 1 && page <= totalPages;
  if (!valid) return null;
  return [
    ...products
      .filter((product) => isObject(product) && isNonEmptyString(product.id))
      .map((product) => ({ title: `${LABELS.product} ${product.id}`, payload: orderProductPayload(product.id) })),
    page > 1 && { title: LABELS.previous, payload: catalogPagePayload(page - 1) },
    page < totalPages && { title: LABELS.next, payload: catalogPagePayload(page + 1) },
    { title: LABELS.menu, payload: MENU_PAYLOAD },
  ].filter(Boolean);
}

// ---------- The request ----------

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

// The one place that talks to the Graph API. `message` is the already built Send API message.
async function postMessage(recipientId, message) {
  if (!isValidRecipient(recipientId)) return failure('invalid_input');
  if (invalidSendApiVars(process.env).length > 0) return failure('config');

  const { accessToken, pageId, version } = getSendApiConfig(process.env);

  let status;
  let rawBody;
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${pageId}/messages`, {
      method: 'POST',
      // The token travels only in this header, never in the URL.
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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

  // A 2xx with a JSON object means Meta accepted the message. A missing
  // message_id is reported as null instead of a failure, because treating an
  // accepted message as failed would invite a duplicate send. Anything that is
  // not a JSON object (HTML, empty body, an array, ...) is invalid_response.
  if (!isObject(body)) return failure('invalid_response', { status });

  return {
    ok: true,
    messageId: typeof body.message_id === 'string' ? body.message_id : null,
    recipientId,
  };
}

// ---------- Fallback and failure reporting ----------

// Plain text replaces a template only when Meta rejected the template itself (e.g. a bad
// image URL). After a timeout, network error, 5xx or any account/recipient problem the
// template may have been delivered, or the text would fail the same way.
const canFallBack = (result) =>
  result.reason === 'graph_error' && (result.hint === null || result.hint === 'invalid_parameter');

// What the caller may log about a failure: never the message text, never a token.
const describeFailure = (result) => ({
  reason: result.reason,
  hint: result.hint,
  code: result.error?.code ?? null,
});

// Sends the template; on a template-level rejection sends `fallbackText` instead.
// If the fallback fails too, that failure is returned.
async function sendTemplateOrText(recipientId, message, fallbackText, quickReplies) {
  const sent = await postMessage(recipientId, message);
  if (sent.ok) return { ...sent, mode: 'template' };
  if (!canFallBack(sent)) return sent;

  const text = await sendTextMessage(recipientId, fallbackText, { quickReplies });
  if (!text.ok) return text;
  return { ...text, mode: 'text_fallback', templateFailure: describeFailure(sent) };
}

// ---------- Public API ----------

// quickReplies: optional [{ title, payload }], at most 13.
export async function sendTextMessage(recipientId, text, options) {
  const quickReplies = buildQuickReplies(options?.quickReplies);
  if (!isValidText(text) || quickReplies === null) return failure('invalid_input');

  const message = quickReplies.length > 0 ? { text, quick_replies: quickReplies } : { text };
  return postMessage(recipientId, message);
}

// elements: 1..10 of { title, subtitle?, imageUrl?, buttons: [{ title, payload }] (1..3) }.
export async function sendGenericTemplate(recipientId, elements, options) {
  const message = genericMessage(elements, options?.imageAspectRatio ?? 'square');
  if (message === null) return failure('invalid_input');
  return postMessage(recipientId, message);
}

// buttons: 1..3 of { title, payload } (postback buttons).
export async function sendButtonTemplate(recipientId, text, buttons) {
  const message = buttonMessage(text, buttons);
  if (message === null) return failure('invalid_input');
  return postMessage(recipientId, message);
}

// Sends one carousel card per product, then `navText` with a "🛒 P001" quick reply per product
// and Previous / Next / Menu. Result: { ok: true, mode: 'template' | 'text_fallback', messageId,
// recipientId }, plus navFailure when only the navigation message failed (the carousel is not
// resent) or templateFailure when the carousel was replaced by `fallbackText`.
export async function sendProductCatalog(recipientId, options) {
  const { products, page, totalPages, navText, fallbackText } = isObject(options) ? options : {};
  const countOk = Array.isArray(products) && products.length >= 1 && products.length <= MAX_ELEMENTS;
  const quickReplies = countOk ? catalogQuickReplies(Array.from(products), page, totalPages) : null;
  if (!countOk || quickReplies === null || !isValidText(navText) || !isValidText(fallbackText)) {
    return failure('invalid_input');
  }

  // A product that cannot become a card (for example an http:// image after someone edited
  // the catalog) must not break the whole catalog: send the plain text list instead.
  const message = genericMessage(Array.from(products, productElement), 'square');
  if (message === null) {
    const text = await sendTextMessage(recipientId, fallbackText, { quickReplies });
    if (!text.ok) return text;
    return { ...text, mode: 'text_fallback', templateFailure: { reason: 'invalid_input', hint: null, code: null } };
  }

  const sent = await sendTemplateOrText(recipientId, message, fallbackText, quickReplies);
  // The text fallback already carries the quick replies; only a real carousel needs the nav message.
  if (!sent.ok || sent.mode !== 'template') return sent;

  const nav = await sendTextMessage(recipientId, navText, { quickReplies });
  return nav.ok ? sent : { ...sent, navFailure: describeFailure(nav) };
}

// A product photo, then `text` with its quick replies. The photo is an extra: when it fails (for
// example Meta cannot fetch the image) the text is sent anyway. Result: the text's result with
// mode 'photo', or mode 'text_only' plus photoFailure.
export async function sendPhotoAndText(recipientId, options) {
  const { imageUrl, text, quickReplies } = isObject(options) ? options : {};
  if (!isValidRecipient(recipientId) || !isValidText(text) || buildQuickReplies(quickReplies) === null) {
    return failure('invalid_input');
  }

  const photo = isHttpsUrl(imageUrl)
    ? await postMessage(recipientId, { attachment: { type: 'image', payload: { url: imageUrl } } })
    : failure('invalid_input');
  const sent = await sendTextMessage(recipientId, text, { quickReplies });
  if (!sent.ok) return sent;
  return photo.ok ? { ...sent, mode: 'photo' } : { ...sent, mode: 'text_only', photoFailure: describeFailure(photo) };
}

// Order summary with ✅ Confirm / ❌ Cancel quick replies. Quick replies arrive as ordinary
// messages, so confirming does not depend on the Page's postback subscription.
export async function sendOrderConfirmation(recipientId, options) {
  const { text, draftId } = isObject(options) ? options : {};
  if (!isNonEmptyString(draftId) || !isValidText(text)) return failure('invalid_input');

  const quickReplies = [
    { title: LABELS.confirm, payload: confirmOrderPayload(draftId) },
    { title: LABELS.cancel, payload: CANCEL_ORDER_PAYLOAD },
  ];
  const sent = await sendTextMessage(recipientId, text, { quickReplies });
  return sent.ok ? { ...sent, mode: 'quick_replies' } : sent;
}
