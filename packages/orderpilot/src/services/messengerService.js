import { createSettings } from '../config.js';
import { SEND_TIMEOUT_MS, callGraph, describeFailure, failure } from '../graph.js';
import { DEFAULT_LANGUAGE } from './language.js';
import {
  CANCEL_ORDER_PAYLOAD,
  MENU_PAYLOAD,
  catalogPagePayload,
  confirmOrderPayload,
  orderProductPayload,
} from './payloads.js';

// Messenger Send API client (official Graph API endpoint): text with quick replies,
// generic (carousel) templates and button templates, plus the customer's Facebook language.
//
// createMessengerClient({ getConfig }) makes a client for one Page; getConfig() is asked on every
// call for { accessToken, pageId, version }, or null while the Page is not configured. The
// functions exported at the bottom are a client that reads the environment.
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

export { SEND_TIMEOUT_MS };
export const PROFILE_TIMEOUT_MS = 3_000; // the first reply waits for it

const MAX_TEXT_LENGTH = 2000; // Messenger's limit for a text message
const MAX_ELEMENTS = 10; // cards in one carousel
const MAX_BUTTONS = 3; // buttons per card / button template
const MAX_QUICK_REPLIES = 13;
const MAX_CARD_TEXT = 80; // card title and subtitle
const MAX_LABEL = 20; // button and quick reply titles
const MAX_BUTTON_TEMPLATE_TEXT = 640;
const MAX_PAYLOAD_LENGTH = 1000;
const IMAGE_ASPECT_RATIOS = ['square', 'horizontal'];
const RECIPIENT_FORMAT = /^\d+$/;

// Labels of the buttons this module builds itself (product cards, catalog navigation, the order
// confirmation), per language. Callers pass `language`; anything unknown gets Bangla.
const LABELS = {
  bn: {
    order: '🛒 অর্ডার করুন',
    product: '🛒',
    confirm: '✅ নিশ্চিত করুন',
    cancel: '❌ বাতিল',
    previous: '◀ আগের',
    next: 'পরের ▶',
    menu: '🏠 মেনু',
  },
  en: {
    order: '🛒 Order Now',
    product: '🛒',
    confirm: '✅ Confirm',
    cancel: '❌ Cancel',
    previous: '◀ Previous',
    next: 'Next ▶',
    menu: '🏠 Menu',
  },
};
const labelsFor = (language) => LABELS[language] ?? LABELS[DEFAULT_LANGUAGE];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isMissing = (value) => value === undefined || value === null;
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isValidRecipient = (value) => typeof value === 'string' && RECIPIENT_FORMAT.test(value);
const isValidText = (value) => isNonEmptyString(value) && value.length <= MAX_TEXT_LENGTH;
const countChars = (text) => Array.from(text).length;

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
function productElement(product, labels) {
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
    buttons: [{ title: labels.order, payload: orderProductPayload(product.id) }],
  };
}

// One "🛒 P001" quick reply per product on the page (a tap starts the order like Order Now),
// then Previous / Next only when there is such a page, and Menu.
function catalogQuickReplies(products, page, totalPages, labels) {
  const valid = Number.isInteger(page) && Number.isInteger(totalPages) && page >= 1 && page <= totalPages;
  if (!valid) return null;
  return [
    ...products
      .filter((product) => isObject(product) && isNonEmptyString(product.id))
      .map((product) => ({ title: `${labels.product} ${product.id}`, payload: orderProductPayload(product.id) })),
    page > 1 && { title: labels.previous, payload: catalogPagePayload(page - 1) },
    page < totalPages && { title: labels.next, payload: catalogPagePayload(page + 1) },
    { title: labels.menu, payload: MENU_PAYLOAD },
  ].filter(Boolean);
}

// ---------- Fallback ----------

// Plain text replaces a template only when Meta rejected the template itself (e.g. a bad
// image URL). After a timeout, network error, 5xx or any account/recipient problem the
// template may have been delivered, or the text would fail the same way.
const canFallBack = (result) =>
  result.reason === 'graph_error' && (result.hint === null || result.hint === 'invalid_parameter');

// The Send API settings from the environment (PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID,
// META_GRAPH_API_VERSION), read on every call.
const configFromEnv = () => createSettings().sendApi();

// ---------- The client ----------

export function createMessengerClient({ getConfig = configFromEnv } = {}) {
  // `path` under the configured version, or 'config' while the Page is not configured.
  async function call(path, options) {
    const config = getConfig();
    if (!config) return failure('config');
    return callGraph(config, typeof path === 'function' ? path(config) : path, options);
  }

  // `message` is the already built Send API message.
  async function postMessage(recipientId, message) {
    if (!isValidRecipient(recipientId)) return failure('invalid_input');

    const sent = await call(({ pageId }) => `${pageId}/messages`, {
      method: 'POST',
      body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message },
    });
    if (!sent.ok) return sent;

    // A 2xx with a JSON object means Meta accepted the message. A missing message_id is reported
    // as null instead of a failure, because treating an accepted message as failed would invite a
    // duplicate send.
    return {
      ok: true,
      messageId: typeof sent.body.message_id === 'string' ? sent.body.message_id : null,
      recipientId,
    };
  }

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

  // quickReplies: optional [{ title, payload }], at most 13.
  async function sendTextMessage(recipientId, text, options) {
    const quickReplies = buildQuickReplies(options?.quickReplies);
    if (!isValidText(text) || quickReplies === null) return failure('invalid_input');

    const message = quickReplies.length > 0 ? { text, quick_replies: quickReplies } : { text };
    return postMessage(recipientId, message);
  }

  // elements: 1..10 of { title, subtitle?, imageUrl?, buttons: [{ title, payload }] (1..3) }.
  async function sendGenericTemplate(recipientId, elements, options) {
    const message = genericMessage(elements, options?.imageAspectRatio ?? 'square');
    if (message === null) return failure('invalid_input');
    return postMessage(recipientId, message);
  }

  // buttons: 1..3 of { title, payload } (postback buttons).
  async function sendButtonTemplate(recipientId, text, buttons) {
    const message = buttonMessage(text, buttons);
    if (message === null) return failure('invalid_input');
    return postMessage(recipientId, message);
  }

  // Sends one carousel card per product, then `navText` with a "🛒 P001" quick reply per product
  // and Previous / Next / Menu. Result: { ok: true, mode: 'template' | 'text_fallback', messageId,
  // recipientId }, plus navFailure when only the navigation message failed (the carousel is not
  // resent) or templateFailure when the carousel was replaced by `fallbackText`.
  async function sendProductCatalog(recipientId, options) {
    const { products, page, totalPages, navText, fallbackText, language } = isObject(options) ? options : {};
    const labels = labelsFor(language);
    const countOk = Array.isArray(products) && products.length >= 1 && products.length <= MAX_ELEMENTS;
    const quickReplies = countOk ? catalogQuickReplies(Array.from(products), page, totalPages, labels) : null;
    if (!countOk || quickReplies === null || !isValidText(navText) || !isValidText(fallbackText)) {
      return failure('invalid_input');
    }

    // A product that cannot become a card (for example an http:// image after someone edited
    // the catalog) must not break the whole catalog: send the plain text list instead.
    const message = genericMessage(Array.from(products, (product) => productElement(product, labels)), 'square');
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
  async function sendPhotoAndText(recipientId, options) {
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
  async function sendOrderConfirmation(recipientId, options) {
    const { text, draftId, language } = isObject(options) ? options : {};
    if (!isNonEmptyString(draftId) || !isValidText(text)) return failure('invalid_input');

    const labels = labelsFor(language);
    const quickReplies = [
      { title: labels.confirm, payload: confirmOrderPayload(draftId) },
      { title: labels.cancel, payload: CANCEL_ORDER_PAYLOAD },
    ];
    const sent = await sendTextMessage(recipientId, text, { quickReplies });
    return sent.ok ? { ...sent, mode: 'quick_replies' } : sent;
  }

  // The customer's Facebook language (User Profile API, `locale`, for example "en_US" or "bn_IN").
  // Meta answers only for customers who messaged the Page, and for the public only once the app has
  // Advanced Access to user profiles. Accounts made with a phone number have no profile.
  // Result: { ok: true, locale } (locale is null when Meta sends none) or a failure.
  async function getUserLocale(recipientId) {
    if (!isValidRecipient(recipientId)) return failure('invalid_input');
    const read = await call(`${recipientId}?fields=locale`, { timeoutMs: PROFILE_TIMEOUT_MS });
    if (!read.ok) return read;
    return { ok: true, locale: isNonEmptyString(read.body.locale) ? read.body.locale.trim() : null };
  }

  return Object.freeze({
    sendTextMessage,
    sendGenericTemplate,
    sendButtonTemplate,
    sendProductCatalog,
    sendPhotoAndText,
    sendOrderConfirmation,
    getUserLocale,
  });
}

// A client for the Page in the environment, read on every call.
export const {
  sendTextMessage,
  sendGenericTemplate,
  sendButtonTemplate,
  sendProductCatalog,
  sendPhotoAndText,
  sendOrderConfirmation,
  getUserLocale,
} = createMessengerClient();
