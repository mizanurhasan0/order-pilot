import { randomUUID } from 'node:crypto';
import { orderStore, preferenceStore, sessionStore } from '../store/index.js';
import { conversationKey, STEPS } from '../store/sessionStore.js';
import { normalizeText } from '../utils/normalizeText.js';
import { normalizeBdPhone, parseAddress, parseQuantity } from '../utils/validators.js';
import { DEFAULT_LANGUAGE, isLanguage } from './language.js';
import { PAYLOAD_TYPES, parsePayload } from './payloads.js';
import * as productService from './productService.js';
import { quickRepliesFor } from './quickReplies.js';
import { resumed, textsFor } from './replyTexts.js';

// The order conversation as a small state machine, one session per page + customer.
// handle() resolves to the list of Reply objects to send and never rejects: it only decides
// WHAT to answer; autoReplyService sends them. Its only I/O is the session, order and preference
// stores, which may be in memory or in Redis. It does not log anything because the session holds
// the customer's phone number and address.
//
// Every reply is in the customer's language (Bangla unless they have English, see
// services/language.js): ctx.t holds that language's texts and ctx.q its quick replies.
//
// Reply = { kind: 'text', rule, text, quickReplies?, orderId? }
//       | { kind: 'text_with_photo', rule, imageUrl, text, quickReplies }   (the photo goes first)
//       | { kind: 'catalog', rule, products, page, totalPages, navText, fallbackText, language }
//       | { kind: 'order_confirmation', rule, text, draftId, language }   (sent with Confirm / Cancel)

const words = (...list) => new Set(list.map(normalizeText));

const CANCEL_WORDS = words('cancel', 'cancel order', 'delete', 'বাতিল', 'বাতিল করুন');
const MENU_WORDS = words('menu', 'মেনু', 'hi', 'hello', 'hey', 'start', 'হাই', 'হ্যালো');
const CONFIRM_WORDS = words('1', 'confirm', 'yes', 'y', 'হ্যাঁ', 'হ্যা', 'নিশ্চিত');
const DECLINE_WORDS = words('2', 'no', 'n', 'না');
const CATALOG_WORDS = words(
  '1',
  'products',
  'product',
  'catalog',
  'পণ্য',
  'পণ্য দেখুন',
  'order',
  'অর্ডার',
  'view products',
);
const ORDER_INFO_WORDS = words('2', 'my order information', 'order information', 'my orders', 'my order', 'আমার অর্ডার');
const SUPPORT_WORDS = words('3', 'support', 'help', 'সহায়তা');
const NEXT_WORDS = words('next', 'পরের', 'পরবর্তী');
const PREVIOUS_WORDS = words('previous', 'prev', 'back', 'আগের', 'পূর্ববর্তী');
// Typing a language's name switches to it, like the 🌐 button.
const LANGUAGE_WORDS = {
  en: words('english', 'ইংরেজি', 'ইংলিশ'),
  bn: words('bangla', 'bengali', 'bangla language', 'বাংলা'),
};

const PRODUCT_CODE = /^(?:order )?(p\d{1,5})$/;
const RECENT_ORDERS_LIMIT = 3;

// Everything a half-finished order stores in the session.
const NO_DRAFT = { productId: null, quantity: null, phone: null, address: null, draftId: null };

// The steps of an order in progress. In them only an answer to the current question, Cancel or
// choosing another product changes the order; anything else asks the question again (resume).
const ORDER_STEPS = new Set([
  STEPS.WAITING_FOR_QUANTITY,
  STEPS.WAITING_FOR_SAVED_DETAILS,
  STEPS.WAITING_FOR_PHONE,
  STEPS.WAITING_FOR_ADDRESS,
  STEPS.WAITING_FOR_CONFIRMATION,
]);
const isOrdering = (session) => ORDER_STEPS.has(session.step);

const languageNamed = (t) => Object.keys(LANGUAGE_WORDS).find((language) => LANGUAGE_WORDS[language].has(t)) ?? null;

const textReply = (rule, text, extra) => ({ kind: 'text', rule, text, ...extra });
const menuReply = (ctx, rule, text) => textReply(rule, text, { quickReplies: ctx.q.MENU });
const isId = (value) => typeof value === 'string' && value !== '';
const newDraftId = () => randomUUID().replaceAll('-', '').slice(0, 16);

// What every reply needs to know about the customer's language.
const languageContext = (language) => ({ language, t: textsFor(language), q: quickRepliesFor(language) });

// For a request that cannot be read at all: nobody to look a language up for.
const DEFAULT_FALLBACK = (() => {
  const ctx = languageContext(DEFAULT_LANGUAGE);
  return () => [menuReply(ctx, 'fallback', ctx.t.FALLBACK)];
})();

const phoneQuestion = (ctx, rule, previousPhone) =>
  textReply(rule, ctx.t.askPhone(previousPhone), { quickReplies: ctx.q.phone(previousPhone) });
const addressQuestion = (ctx, rule, previousAddress) =>
  textReply(rule, ctx.t.askAddress(previousAddress), { quickReplies: ctx.q.address(previousAddress) });

export function createConversationService({
  sessions = sessionStore,
  orders = orderStore,
  preferences = preferenceStore,
  catalog = productService,
} = {}) {
  const availableProduct = (id) => {
    const product = isId(id) ? catalog.getProductById(id) : null;
    return product?.available === true ? product : null;
  };

  // --- commands that work in every step ---

  async function welcome(ctx) {
    await sessions.reset(ctx.key);
    return [menuReply(ctx, 'welcome', ctx.t.WELCOME)];
  }

  async function cancel(ctx) {
    await sessions.reset(ctx.key);
    return [menuReply(ctx, 'order_cancelled', ctx.t.ORDER_CANCELLED)];
  }

  function sessionExpired(ctx) {
    return [menuReply(ctx, 'session_expired', ctx.t.SESSION_EXPIRED)];
  }

  // An answer that is not part of the order (My orders, Support). Outside an order it comes with
  // the menu buttons; in the middle of one, the current question follows instead.
  async function infoReply(ctx, rule, text) {
    if (!isOrdering(ctx.session)) return [menuReply(ctx, rule, text)];
    return [textReply(rule, text), ...(await resume(ctx))];
  }

  function support(ctx) {
    return infoReply(ctx, 'support', ctx.t.SUPPORT);
  }

  // A button from an earlier step (Messenger can still show it after a restart).
  function inStep(ctx, step, run) {
    if (ctx.session.step === step) return run();
    return isOrdering(ctx.session) ? resume(ctx) : [menuReply(ctx, 'button_stale', ctx.t.BUTTON_STALE)];
  }

  // The 🌐 button, or a language's name typed. Remembered for the customer (not the session).
  // In the middle of an order the order is kept and its question asked again in the new language.
  async function switchLanguage(ctx, language) {
    await preferences.setLanguage(ctx.key, language);
    const next = { ...ctx, ...languageContext(language) };
    if (isOrdering(ctx.session)) return resume(next, next.t.LANGUAGE_CHANGED_IN_ORDER);

    await sessions.reset(ctx.key);
    return [menuReply(next, 'language_changed', resumed(next.t.LANGUAGE_CHANGED, next.t.WELCOME))];
  }

  // --- catalog ---

  async function showCatalog(ctx, page, rule) {
    const view = catalog.getCatalogPage(page);
    if (view.items.length === 0) return [menuReply(ctx, rule, ctx.t.CATALOG_EMPTY)];

    await sessions.update(ctx.key, { ...NO_DRAFT, step: STEPS.BROWSING_PRODUCTS, page: view.page });
    return [
      {
        kind: 'catalog',
        rule,
        products: view.items,
        page: view.page,
        totalPages: view.totalPages,
        navText: ctx.t.catalogNav(view),
        fallbackText: ctx.t.catalogFallback(view.items, view.page, view.totalPages),
        language: ctx.language,
      },
    ];
  }

  function turnPage(ctx, direction) {
    const current = catalog.getCatalogPage(ctx.session.page);
    if (direction > 0 && !current.hasNext) return [menuReply(ctx, 'catalog_edge', ctx.t.CATALOG_EDGE_LAST)];
    if (direction < 0 && !current.hasPrev) return [menuReply(ctx, 'catalog_edge', ctx.t.CATALOG_EDGE_FIRST)];
    return showCatalog(ctx, current.page + direction, 'catalog_page');
  }

  // --- collecting the order: choose product -> quantity -> phone -> address -> confirm ---
  // A returning customer is offered the phone and address of their last order together after
  // the quantity. Choosing new details still offers each of them on its own (📱 / 🏠 buttons),
  // so the customer can keep one and change the other.

  // Choosing a product only starts a draft. No order exists until the customer confirms.
  // A customer who came through a product link has not seen the product's card, so the question
  // comes with its photo.
  async function startOrder(ctx, productId, { withPhoto = false } = {}) {
    const product = availableProduct(productId);
    if (!product) return [menuReply(ctx, 'product_not_found', ctx.t.PRODUCT_NOT_FOUND)];

    await sessions.update(ctx.key, { ...NO_DRAFT, step: STEPS.WAITING_FOR_QUANTITY, page: 1, productId: product.id });
    const reply = textReply('order_start', ctx.t.orderStart(product), { quickReplies: ctx.q.QUANTITY });
    return [withPhoto ? { ...reply, kind: 'text_with_photo', imageUrl: product.imageUrl } : reply];
  }

  // The phone and address of the customer's last order, each null when missing or no longer valid.
  async function previousDetailsOf(psid) {
    const [last] = await orders.listByCustomer(psid, { limit: 1 });
    return { phone: normalizeBdPhone(last?.phone), address: parseAddress(last?.address) };
  }

  async function takeQuantity(ctx, raw) {
    const quantity = parseQuantity(raw);
    if (quantity === null) {
      return [textReply('quantity_invalid', ctx.t.QUANTITY_INVALID, { quickReplies: ctx.q.QUANTITY })];
    }

    const previous = await previousDetailsOf(ctx.psid);
    if (previous.phone && previous.address) {
      await sessions.update(ctx.key, { step: STEPS.WAITING_FOR_SAVED_DETAILS, quantity, ...previous });
      return [textReply('saved_details', ctx.t.savedDetails(previous), { quickReplies: ctx.q.SAVED_DETAILS })];
    }
    await sessions.update(ctx.key, { step: STEPS.WAITING_FOR_PHONE, quantity });
    return [phoneQuestion(ctx, 'quantity_ok', previous.phone)];
  }

  function useSavedDetails(ctx) {
    const { phone, address } = ctx.session;
    return showSummary(ctx, { phone, address });
  }

  async function askNewDetails(ctx) {
    const previous = await previousDetailsOf(ctx.psid);
    await sessions.update(ctx.key, { step: STEPS.WAITING_FOR_PHONE, phone: null, address: null });
    return [phoneQuestion(ctx, 'new_details', previous.phone)];
  }

  function chooseSavedDetails(ctx, raw, t) {
    if (CONFIRM_WORDS.has(t)) return useSavedDetails(ctx);
    if (DECLINE_WORDS.has(t)) return askNewDetails(ctx);
    // A new number typed straight away: take it and go on to the address.
    if (normalizeBdPhone(raw) !== null) return takePhone(ctx, raw);
    return [
      textReply('saved_details_invalid', ctx.t.SAVED_DETAILS_INVALID, { quickReplies: ctx.q.SAVED_DETAILS }),
    ];
  }

  async function takePhone(ctx, raw) {
    const phone = normalizeBdPhone(raw);
    const previous = await previousDetailsOf(ctx.psid);
    if (phone === null) {
      return [textReply('phone_invalid', ctx.t.PHONE_INVALID, { quickReplies: ctx.q.phone(previous.phone) })];
    }

    await sessions.update(ctx.key, { step: STEPS.WAITING_FOR_ADDRESS, phone });
    return [addressQuestion(ctx, 'phone_ok', previous.address)];
  }

  // The 📱 button: the number of the last order (asked again if it is gone in the meantime).
  async function usePreviousPhone(ctx) {
    const { phone } = await previousDetailsOf(ctx.psid);
    return phone ? takePhone(ctx, phone) : resume(ctx);
  }

  async function takeAddress(ctx, raw) {
    const address = parseAddress(raw);
    if (address === null) {
      const previous = await previousDetailsOf(ctx.psid);
      return [textReply('address_invalid', ctx.t.ADDRESS_INVALID, { quickReplies: ctx.q.address(previous.address) })];
    }
    return showSummary(ctx, { phone: ctx.session.phone, address });
  }

  // The 🏠 button: the address of the last order (asked again if it is gone in the meantime).
  async function usePreviousAddress(ctx) {
    const { address } = await previousDetailsOf(ctx.psid);
    return address ? showSummary(ctx, { phone: ctx.session.phone, address }) : resume(ctx);
  }

  const summaryOf = (ctx, product, quantity, { phone, address }) =>
    ctx.t.orderSummary({
      name: product.name,
      quantity,
      unitPrice: product.price,
      subtotal: product.price * quantity,
      phone,
      address,
    });

  const confirmationReply = (ctx, rule, text, draftId) => ({
    kind: 'order_confirmation',
    rule,
    text,
    draftId,
    language: ctx.language,
  });

  async function showSummary(ctx, { phone, address }) {
    const { key, session } = ctx;
    const product = availableProduct(session.productId);
    if (!product) return unavailableProduct(ctx);

    const draftId = newDraftId();
    await sessions.update(key, { step: STEPS.WAITING_FOR_CONFIRMATION, phone, address, draftId });
    return [confirmationReply(ctx, 'order_summary', summaryOf(ctx, product, session.quantity, { phone, address }), draftId)];
  }

  async function unavailableProduct(ctx) {
    await sessions.reset(ctx.key);
    return [menuReply(ctx, 'order_cancelled', ctx.t.ORDER_PRODUCT_UNAVAILABLE)];
  }

  // The ONLY place an order is created. The draft id is the idempotency key, so a double
  // tap, a retried webhook or "text then button" can never produce a second order.
  async function confirmOrder(ctx) {
    const { key, psid, session } = ctx;
    const product = availableProduct(session.productId);
    if (!product) return unavailableProduct(ctx);

    const { order, created } = await orders.create(
      {
        productId: product.id,
        productName: product.name,
        quantity: session.quantity,
        unitPrice: product.price,
        currency: product.currency,
        customerPsid: psid,
        phone: session.phone,
        address: session.address,
      },
      { idempotencyKey: session.draftId },
    );
    await sessions.reset(key); // before replying: whatever happens next, the draft is finished
    if (!created) return [orderDuplicate(ctx, order)];
    return [
      textReply('order_confirmed', ctx.t.orderConfirmed(order), { orderId: order.id, quickReplies: ctx.q.AFTER_ORDER }),
    ];
  }

  const orderDuplicate = (ctx, order) =>
    textReply('order_duplicate', ctx.t.orderDuplicate(order), { quickReplies: ctx.q.AFTER_ORDER });

  // Sent like the summary, so the Confirm / Cancel buttons come back with it.
  function confirmCurrentDraft(ctx, raw, t) {
    if (CONFIRM_WORDS.has(t)) return confirmOrder(ctx);
    if (DECLINE_WORDS.has(t)) return cancel(ctx);
    return [confirmationReply(ctx, 'confirm_invalid', ctx.t.CONFIRM_INVALID, ctx.session.draftId)];
  }

  // A confirm button can be tapped long after its draft is gone, so check what it points at.
  async function confirmByPayload(ctx, draftId) {
    const { session, psid } = ctx;
    if (session.step === STEPS.WAITING_FOR_CONFIRMATION && isId(draftId) && session.draftId === draftId) {
      return confirmOrder(ctx);
    }
    const existing = isId(draftId) ? await orders.findByIdempotencyKey(draftId) : null;
    if (existing && existing.customerPsid === psid) return [orderDuplicate(ctx, existing)];
    return isOrdering(session) ? resume(ctx) : [menuReply(ctx, 'confirm_stale', ctx.t.CONFIRM_STALE)];
  }

  // --- keeping an order in progress ---

  // Mid-order, anything that is not an answer to the current question (a greeting, Menu, an old
  // button, a sticker) keeps the draft and asks the current question again under `note`.
  // Only Cancel, or choosing another product, ends the draft.
  async function resume(ctx, note = ctx.t.ORDER_IN_PROGRESS) {
    const { psid, session } = ctx;
    const product = availableProduct(session.productId);
    if (!product) return unavailableProduct(ctx);

    const again = (question, quickReplies) => textReply('order_resumed', resumed(note, question), { quickReplies });

    switch (session.step) {
      case STEPS.WAITING_FOR_QUANTITY:
        return [again(ctx.t.orderStart(product), ctx.q.QUANTITY)];
      case STEPS.WAITING_FOR_SAVED_DETAILS:
        return [again(ctx.t.savedDetails(session), ctx.q.SAVED_DETAILS)];
      case STEPS.WAITING_FOR_PHONE: {
        const previous = await previousDetailsOf(psid);
        return [again(ctx.t.askPhone(previous.phone), ctx.q.phone(previous.phone))];
      }
      case STEPS.WAITING_FOR_ADDRESS: {
        const previous = await previousDetailsOf(psid);
        return [again(ctx.t.askAddress(previous.address), ctx.q.address(previous.address))];
      }
      default: {
        // WAITING_FOR_CONFIRMATION: the same draft id, so the Confirm button keeps working.
        const summary = summaryOf(ctx, product, session.quantity, session);
        return [confirmationReply(ctx, 'order_resumed', resumed(note, summary), session.draftId)];
      }
    }
  }

  // --- the main menu (IDLE and BROWSING_PRODUCTS) ---

  async function showOrders(ctx) {
    const recent = await orders.listByCustomer(ctx.psid, { limit: RECENT_ORDERS_LIMIT });
    return infoReply(ctx, 'order_info', ctx.t.orderInfo(recent));
  }

  function menuChoice(ctx, raw, t) {
    if (CATALOG_WORDS.has(t)) return showCatalog(ctx, 1, 'catalog');
    if (ORDER_INFO_WORDS.has(t)) return showOrders(ctx);
    if (SUPPORT_WORDS.has(t)) return support(ctx);

    if (ctx.session.step === STEPS.BROWSING_PRODUCTS) {
      if (NEXT_WORDS.has(t)) return turnPage(ctx, 1);
      if (PREVIOUS_WORDS.has(t)) return turnPage(ctx, -1);
    }

    const code = PRODUCT_CODE.exec(t);
    if (code) return startOrder(ctx, code[1]);
    return [menuReply(ctx, 'fallback', ctx.t.FALLBACK)];
  }

  const STEP_HANDLERS = {
    [STEPS.IDLE]: menuChoice,
    [STEPS.BROWSING_PRODUCTS]: menuChoice,
    [STEPS.WAITING_FOR_QUANTITY]: takeQuantity,
    [STEPS.WAITING_FOR_SAVED_DETAILS]: chooseSavedDetails,
    [STEPS.WAITING_FOR_PHONE]: takePhone,
    [STEPS.WAITING_FOR_ADDRESS]: takeAddress,
    [STEPS.WAITING_FOR_CONFIRMATION]: confirmCurrentDraft,
  };

  // --- entry points ---

  // MENU, GET_STARTED and anything we do not recognise.
  const notAnAnswer = (ctx) => (isOrdering(ctx.session) ? resume(ctx) : welcome(ctx));

  function handlePayload(ctx, payload, { fromLink = false } = {}) {
    const parsed = parsePayload(payload);
    switch (parsed?.type) {
      case PAYLOAD_TYPES.ORDER_PRODUCT:
        return startOrder(ctx, parsed.arg, { withPhoto: fromLink });
      case PAYLOAD_TYPES.CATALOG_PAGE:
        return isOrdering(ctx.session) ? resume(ctx) : showCatalog(ctx, Number(parsed.arg), 'catalog_page');
      case PAYLOAD_TYPES.CONFIRM_ORDER:
        return confirmByPayload(ctx, parsed.arg);
      case PAYLOAD_TYPES.CANCEL_ORDER:
        return cancel(ctx);
      case PAYLOAD_TYPES.MY_ORDERS:
        return showOrders(ctx);
      case PAYLOAD_TYPES.SUPPORT:
        return support(ctx);
      case PAYLOAD_TYPES.QUANTITY:
        return inStep(ctx, STEPS.WAITING_FOR_QUANTITY, () => takeQuantity(ctx, parsed.arg ?? ''));
      case PAYLOAD_TYPES.USE_SAVED_DETAILS:
        return inStep(ctx, STEPS.WAITING_FOR_SAVED_DETAILS, () => useSavedDetails(ctx));
      case PAYLOAD_TYPES.NEW_DETAILS:
        return inStep(ctx, STEPS.WAITING_FOR_SAVED_DETAILS, () => askNewDetails(ctx));
      case PAYLOAD_TYPES.USE_SAVED_PHONE:
        return inStep(ctx, STEPS.WAITING_FOR_PHONE, () => usePreviousPhone(ctx));
      case PAYLOAD_TYPES.USE_SAVED_ADDRESS:
        return inStep(ctx, STEPS.WAITING_FOR_ADDRESS, () => usePreviousAddress(ctx));
      case PAYLOAD_TYPES.LANGUAGE:
        return isLanguage(parsed.arg) ? switchLanguage(ctx, parsed.arg) : notAnAnswer(ctx);
      default:
        return notAnAnswer(ctx);
    }
  }

  function handleText(ctx, text) {
    const raw = typeof text === 'string' ? text : '';
    const t = normalizeText(raw);
    if (CANCEL_WORDS.has(t)) return cancel(ctx);
    const language = languageNamed(t);
    if (language) return switchLanguage(ctx, language);
    if (MENU_WORDS.has(t)) return notAnAnswer(ctx);
    if (ctx.session.expired) return sessionExpired(ctx);

    const stepHandler = STEP_HANDLERS[ctx.session.step];
    return stepHandler ? stepHandler(ctx, raw, t) : welcome(ctx);
  }

  // Photos, stickers, likes, voice notes: never opened or downloaded. In the middle of an order
  // they repeat the current question; otherwise the bot explains that it reads text only.
  function handleAttachment(ctx) {
    if (isOrdering(ctx.session)) return resume(ctx, ctx.t.ATTACHMENT_IN_ORDER);
    return [menuReply(ctx, 'attachment', ctx.t.ATTACHMENT)];
  }

  async function handle(request) {
    try {
      const { pageId, psid, input } = request ?? {};
      if (!isId(pageId) || !isId(psid)) return DEFAULT_FALLBACK();

      const key = conversationKey(pageId, psid);
      const [session, stored] = await Promise.all([sessions.get(key), preferences.getLanguage(key)]);
      const ctx = { key, psid, session, ...languageContext(stored ?? DEFAULT_LANGUAGE) };
      // Awaited here (not just returned) so a failing store lands in the catch below.
      if (input?.type === 'payload') {
        return await handlePayload(ctx, input.payload, { fromLink: input.fromLink === true });
      }
      if (input?.type === 'text') return await handleText(ctx, input.text);
      if (input?.type === 'attachment') return await handleAttachment(ctx);
      return [menuReply(ctx, 'fallback', ctx.t.FALLBACK)];
    } catch {
      return DEFAULT_FALLBACK();
    }
  }

  return { handle };
}

export const conversationService = createConversationService();
