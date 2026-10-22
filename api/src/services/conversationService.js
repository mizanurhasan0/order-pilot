import { randomUUID } from 'node:crypto';
import { orderStore, sessionStore } from '../store/index.js';
import { conversationKey, STEPS } from '../store/sessionStore.js';
import { normalizeText } from '../utils/normalizeText.js';
import { normalizeBdPhone, parseAddress, parseQuantity } from '../utils/validators.js';
import { PAYLOAD_TYPES, parsePayload } from './payloads.js';
import * as productService from './productService.js';
import * as quick from './quickReplies.js';
import * as texts from './replyTexts.js';

// The order conversation as a small state machine, one session per page + customer.
// handle() resolves to the list of Reply objects to send and never rejects: it only decides
// WHAT to answer; autoReplyService sends them. Its only I/O is the session and order stores,
// which may be in memory or in Redis. It does not log anything because the session holds the
// customer's phone number and address.
//
// Reply = { kind: 'text', rule, text, quickReplies?, orderId? }
//       | { kind: 'catalog', rule, products, page, totalPages, navText, fallbackText }
//       | { kind: 'order_confirmation', rule, text, draftId }   (sent with Confirm / Cancel)

const words = (...list) => new Set(list.map(normalizeText));

const CANCEL_WORDS = words('cancel', 'বাতিল');
const MENU_WORDS = words('menu', 'মেনু', 'hi', 'hello', 'hey', 'start', 'হাই', 'হ্যালো');
const CONFIRM_WORDS = words('1', 'confirm', 'yes', 'y', 'হ্যাঁ', 'হ্যা');
const DECLINE_WORDS = words('2', 'no', 'n', 'না');
const CATALOG_WORDS = words('1', 'products', 'product', 'catalog', 'পণ্য', 'order', 'অর্ডার', 'view products');
const ORDER_INFO_WORDS = words('2', 'my order information', 'order information', 'my orders', 'my order');
const SUPPORT_WORDS = words('3', 'support', 'help');
const NEXT_WORDS = words('next');
const PREVIOUS_WORDS = words('previous', 'prev', 'back');

const PRODUCT_CODE = /^(?:order )?(p\d{1,5})$/;
const RECENT_ORDERS_LIMIT = 3;

// Everything a half-finished order stores in the session.
const NO_DRAFT = { productId: null, quantity: null, phone: null, address: null, draftId: null };

const textReply = (rule, text, extra) => ({ kind: 'text', rule, text, ...extra });
const menuReply = (rule, text) => textReply(rule, text, { quickReplies: quick.MENU });
const isId = (value) => typeof value === 'string' && value !== '';
const newDraftId = () => randomUUID().replaceAll('-', '').slice(0, 16);

export function createConversationService({
  sessions = sessionStore,
  orders = orderStore,
  catalog = productService,
} = {}) {
  const availableProduct = (id) => {
    const product = isId(id) ? catalog.getProductById(id) : null;
    return product?.available === true ? product : null;
  };

  // --- commands that work in every step ---

  async function welcome({ key }) {
    await sessions.reset(key);
    return [menuReply('welcome', texts.WELCOME)];
  }

  async function cancel({ key }) {
    await sessions.reset(key);
    return [menuReply('order_cancelled', texts.ORDER_CANCELLED)];
  }

  function sessionExpired() {
    return [menuReply('session_expired', texts.SESSION_EXPIRED)];
  }

  function support() {
    return [menuReply('support', texts.SUPPORT)];
  }

  // A quick reply that belongs to an earlier step (Messenger can still show it after a restart).
  function inStep(ctx, step, run) {
    return ctx.session.step === step ? run() : [menuReply('button_stale', texts.BUTTON_STALE)];
  }

  // --- catalog ---

  async function showCatalog({ key }, page, rule) {
    const view = catalog.getCatalogPage(page);
    if (view.items.length === 0) return [menuReply(rule, texts.CATALOG_EMPTY)];

    await sessions.update(key, { ...NO_DRAFT, step: STEPS.BROWSING_PRODUCTS, page: view.page });
    return [
      {
        kind: 'catalog',
        rule,
        products: view.items,
        page: view.page,
        totalPages: view.totalPages,
        navText: texts.catalogNav(view),
        fallbackText: texts.catalogFallback(view.items, view.page, view.totalPages),
      },
    ];
  }

  function turnPage(ctx, direction) {
    const current = catalog.getCatalogPage(ctx.session.page);
    if (direction > 0 && !current.hasNext) return [menuReply('catalog_edge', texts.CATALOG_EDGE_LAST)];
    if (direction < 0 && !current.hasPrev) return [menuReply('catalog_edge', texts.CATALOG_EDGE_FIRST)];
    return showCatalog(ctx, current.page + direction, 'catalog_page');
  }

  // --- collecting the order: choose product -> quantity -> phone -> address -> confirm ---
  // A returning customer skips phone and address: after the quantity they are offered the
  // ones from their last order.

  // Choosing a product only starts a draft. No order exists until the customer confirms.
  async function startOrder({ key }, productId) {
    const product = availableProduct(productId);
    if (!product) return [menuReply('product_not_found', texts.PRODUCT_NOT_FOUND)];

    await sessions.update(key, { ...NO_DRAFT, step: STEPS.WAITING_FOR_QUANTITY, page: 1, productId: product.id });
    return [textReply('order_start', texts.orderStart(product), { quickReplies: quick.QUANTITY })];
  }

  // The phone and address of the customer's last order, when both are still valid.
  async function savedDetailsOf(psid) {
    const [last] = await orders.listByCustomer(psid, { limit: 1 });
    const phone = normalizeBdPhone(last?.phone);
    const address = parseAddress(last?.address);
    return phone && address ? { phone, address } : null;
  }

  async function takeQuantity({ key, psid }, raw) {
    const quantity = parseQuantity(raw);
    if (quantity === null) {
      return [textReply('quantity_invalid', texts.QUANTITY_INVALID, { quickReplies: quick.QUANTITY })];
    }

    const saved = await savedDetailsOf(psid);
    if (saved) {
      await sessions.update(key, { step: STEPS.WAITING_FOR_SAVED_DETAILS, quantity, ...saved });
      return [textReply('saved_details', texts.savedDetails(saved), { quickReplies: quick.SAVED_DETAILS })];
    }
    await sessions.update(key, { step: STEPS.WAITING_FOR_PHONE, quantity });
    return [textReply('quantity_ok', texts.ASK_PHONE, { quickReplies: quick.PHONE })];
  }

  function useSavedDetails(ctx) {
    const { phone, address } = ctx.session;
    return showSummary(ctx, { phone, address });
  }

  async function askNewDetails({ key }) {
    await sessions.update(key, { step: STEPS.WAITING_FOR_PHONE, phone: null, address: null });
    return [textReply('new_details', texts.ASK_PHONE, { quickReplies: quick.PHONE })];
  }

  function chooseSavedDetails(ctx, raw, t) {
    if (CONFIRM_WORDS.has(t)) return useSavedDetails(ctx);
    if (DECLINE_WORDS.has(t)) return askNewDetails(ctx);
    // A new number typed straight away: take it and go on to the address.
    if (normalizeBdPhone(raw) !== null) return takePhone(ctx, raw);
    return [
      textReply('saved_details_invalid', texts.SAVED_DETAILS_INVALID, { quickReplies: quick.SAVED_DETAILS }),
    ];
  }

  async function takePhone({ key }, raw) {
    const phone = normalizeBdPhone(raw);
    if (phone === null) return [textReply('phone_invalid', texts.PHONE_INVALID, { quickReplies: quick.PHONE })];

    await sessions.update(key, { step: STEPS.WAITING_FOR_ADDRESS, phone });
    return [textReply('phone_ok', texts.ASK_ADDRESS, { quickReplies: quick.ADDRESS })];
  }

  function takeAddress(ctx, raw) {
    const address = parseAddress(raw);
    if (address === null) {
      return [textReply('address_invalid', texts.ADDRESS_INVALID, { quickReplies: quick.ADDRESS })];
    }
    return showSummary(ctx, { phone: ctx.session.phone, address });
  }

  async function showSummary({ key, session }, { phone, address }) {
    const product = availableProduct(session.productId);
    if (!product) return unavailableProduct(key);

    const draftId = newDraftId();
    await sessions.update(key, { step: STEPS.WAITING_FOR_CONFIRMATION, phone, address, draftId });
    const summary = texts.orderSummary({
      name: product.name,
      quantity: session.quantity,
      unitPrice: product.price,
      subtotal: product.price * session.quantity,
      phone,
      address,
    });
    return [{ kind: 'order_confirmation', rule: 'order_summary', text: summary, draftId }];
  }

  async function unavailableProduct(key) {
    await sessions.reset(key);
    return [menuReply('order_cancelled', texts.ORDER_PRODUCT_UNAVAILABLE)];
  }

  // The ONLY place an order is created. The draft id is the idempotency key, so a double
  // tap, a retried webhook or "text then button" can never produce a second order.
  async function confirmOrder({ key, psid, session }) {
    const product = availableProduct(session.productId);
    if (!product) return unavailableProduct(key);

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
    if (!created) return [orderDuplicate(order)];
    return [
      textReply('order_confirmed', texts.orderConfirmed(order), { orderId: order.id, quickReplies: quick.AFTER_ORDER }),
    ];
  }

  const orderDuplicate = (order) =>
    textReply('order_duplicate', texts.orderDuplicate(order), { quickReplies: quick.AFTER_ORDER });

  // Sent like the summary, so the Confirm / Cancel buttons come back with it.
  function confirmCurrentDraft(ctx, raw, t) {
    if (CONFIRM_WORDS.has(t)) return confirmOrder(ctx);
    if (DECLINE_WORDS.has(t)) return cancel(ctx);
    return [
      { kind: 'order_confirmation', rule: 'confirm_invalid', text: texts.CONFIRM_INVALID, draftId: ctx.session.draftId },
    ];
  }

  // A confirm button can be tapped long after its draft is gone, so check what it points at.
  async function confirmByPayload(ctx, draftId) {
    const { session, psid } = ctx;
    if (session.step === STEPS.WAITING_FOR_CONFIRMATION && isId(draftId) && session.draftId === draftId) {
      return confirmOrder(ctx);
    }
    const existing = isId(draftId) ? await orders.findByIdempotencyKey(draftId) : null;
    if (existing && existing.customerPsid === psid) return [orderDuplicate(existing)];
    return [menuReply('confirm_stale', texts.CONFIRM_STALE)];
  }

  // --- the main menu (IDLE and BROWSING_PRODUCTS) ---

  async function showOrders({ psid }) {
    const recent = await orders.listByCustomer(psid, { limit: RECENT_ORDERS_LIMIT });
    return [menuReply('order_info', texts.orderInfo(recent))];
  }

  function menuChoice(ctx, raw, t) {
    if (CATALOG_WORDS.has(t)) return showCatalog(ctx, 1, 'catalog');
    if (ORDER_INFO_WORDS.has(t)) return showOrders(ctx);
    if (SUPPORT_WORDS.has(t)) return support();

    if (ctx.session.step === STEPS.BROWSING_PRODUCTS) {
      if (NEXT_WORDS.has(t)) return turnPage(ctx, 1);
      if (PREVIOUS_WORDS.has(t)) return turnPage(ctx, -1);
    }

    const code = PRODUCT_CODE.exec(t);
    if (code) return startOrder(ctx, code[1]);
    return [menuReply('fallback', texts.FALLBACK)];
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

  function handlePayload(ctx, payload) {
    const parsed = parsePayload(payload);
    switch (parsed?.type) {
      case PAYLOAD_TYPES.ORDER_PRODUCT:
        return startOrder(ctx, parsed.arg);
      case PAYLOAD_TYPES.CATALOG_PAGE:
        return showCatalog(ctx, Number(parsed.arg), 'catalog_page');
      case PAYLOAD_TYPES.CONFIRM_ORDER:
        return confirmByPayload(ctx, parsed.arg);
      case PAYLOAD_TYPES.CANCEL_ORDER:
        return cancel(ctx);
      case PAYLOAD_TYPES.MY_ORDERS:
        return showOrders(ctx);
      case PAYLOAD_TYPES.SUPPORT:
        return support();
      case PAYLOAD_TYPES.QUANTITY:
        return inStep(ctx, STEPS.WAITING_FOR_QUANTITY, () => takeQuantity(ctx, parsed.arg ?? ''));
      case PAYLOAD_TYPES.USE_SAVED_DETAILS:
        return inStep(ctx, STEPS.WAITING_FOR_SAVED_DETAILS, () => useSavedDetails(ctx));
      case PAYLOAD_TYPES.NEW_DETAILS:
        return inStep(ctx, STEPS.WAITING_FOR_SAVED_DETAILS, () => askNewDetails(ctx));
      default: // MENU, GET_STARTED and anything we do not recognise
        return welcome(ctx);
    }
  }

  function handleText(ctx, text) {
    const raw = typeof text === 'string' ? text : '';
    const t = normalizeText(raw);
    if (CANCEL_WORDS.has(t)) return cancel(ctx);
    if (MENU_WORDS.has(t)) return welcome(ctx);
    if (ctx.session.expired) return sessionExpired();

    const stepHandler = STEP_HANDLERS[ctx.session.step];
    return stepHandler ? stepHandler(ctx, raw, t) : welcome(ctx);
  }

  async function handle(request) {
    try {
      const { pageId, psid, input } = request ?? {};
      if (!isId(pageId) || !isId(psid)) return [menuReply('fallback', texts.FALLBACK)];

      const key = conversationKey(pageId, psid);
      const ctx = { key, psid, session: await sessions.get(key) };
      // Awaited here (not just returned) so a failing store lands in the catch below.
      if (input?.type === 'payload') return await handlePayload(ctx, input.payload);
      if (input?.type === 'text') return await handleText(ctx, input.text);
      return [menuReply('fallback', texts.FALLBACK)];
    } catch {
      return [menuReply('fallback', texts.FALLBACK)];
    }
  }

  return { handle };
}

export const conversationService = createConversationService();
