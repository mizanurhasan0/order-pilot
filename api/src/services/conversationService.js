import { randomUUID } from 'node:crypto';
import { orderStore, sessionStore } from '../store/index.js';
import { conversationKey, STEPS } from '../store/sessionStore.js';
import { normalizeText } from '../utils/normalizeText.js';
import { normalizeBdPhone, parseAddress, parseQuantity } from '../utils/validators.js';
import { PAYLOAD_TYPES, parsePayload } from './payloads.js';
import * as productService from './productService.js';
import * as texts from './replyTexts.js';

// The order conversation as a small state machine, one session per page + customer.
// handle() resolves to the list of Reply objects to send and never rejects: it only decides
// WHAT to answer; autoReplyService sends them. Its only I/O is the session and order stores,
// which may be in memory or in Redis. It does not log anything because the session holds the
// customer's phone number and address.
//
// Reply = { kind: 'text', rule, text, orderId? }
//       | { kind: 'catalog', rule, products, page, totalPages, navText, fallbackText }
//       | { kind: 'order_confirmation', rule, text, draftId }

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
    return [textReply('welcome', texts.WELCOME)];
  }

  async function cancel({ key }) {
    await sessions.reset(key);
    return [textReply('order_cancelled', texts.ORDER_CANCELLED)];
  }

  function sessionExpired() {
    return [textReply('session_expired', texts.SESSION_EXPIRED)];
  }

  // --- catalog ---

  async function showCatalog({ key }, page, rule) {
    const view = catalog.getCatalogPage(page);
    if (view.items.length === 0) return [textReply(rule, texts.CATALOG_EMPTY)];

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
    if (direction > 0 && !current.hasNext) return [textReply('catalog_edge', texts.CATALOG_EDGE_LAST)];
    if (direction < 0 && !current.hasPrev) return [textReply('catalog_edge', texts.CATALOG_EDGE_FIRST)];
    return showCatalog(ctx, current.page + direction, 'catalog_page');
  }

  // --- collecting the order: choose product -> quantity -> phone -> address -> confirm ---

  // Choosing a product only starts a draft. No order exists until the customer confirms.
  async function startOrder({ key }, productId) {
    const product = availableProduct(productId);
    if (!product) return [textReply('product_not_found', texts.PRODUCT_NOT_FOUND)];

    await sessions.update(key, { ...NO_DRAFT, step: STEPS.WAITING_FOR_QUANTITY, page: 1, productId: product.id });
    return [textReply('order_start', texts.orderStart(product))];
  }

  async function takeQuantity({ key }, raw) {
    const quantity = parseQuantity(raw);
    if (quantity === null) return [textReply('quantity_invalid', texts.QUANTITY_INVALID)];

    await sessions.update(key, { step: STEPS.WAITING_FOR_PHONE, quantity });
    return [textReply('quantity_ok', texts.ASK_PHONE)];
  }

  async function takePhone({ key }, raw) {
    const phone = normalizeBdPhone(raw);
    if (phone === null) return [textReply('phone_invalid', texts.PHONE_INVALID)];

    await sessions.update(key, { step: STEPS.WAITING_FOR_ADDRESS, phone });
    return [textReply('phone_ok', texts.ASK_ADDRESS)];
  }

  async function takeAddress({ key, session }, raw) {
    const address = parseAddress(raw);
    if (address === null) return [textReply('address_invalid', texts.ADDRESS_INVALID)];

    const product = availableProduct(session.productId);
    if (!product) return unavailableProduct(key);

    const draftId = newDraftId();
    await sessions.update(key, { step: STEPS.WAITING_FOR_CONFIRMATION, address, draftId });
    const subtotal = product.price * session.quantity;
    const summary = texts.orderSummary({
      name: product.name,
      quantity: session.quantity,
      unitPrice: product.price,
      subtotal,
      phone: session.phone,
      address,
    });
    return [{ kind: 'order_confirmation', rule: 'order_summary', text: summary, draftId }];
  }

  async function unavailableProduct(key) {
    await sessions.reset(key);
    return [textReply('order_cancelled', texts.ORDER_PRODUCT_UNAVAILABLE)];
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
    if (!created) return [textReply('order_duplicate', texts.orderDuplicate(order))];
    return [textReply('order_confirmed', texts.orderConfirmed(order), { orderId: order.id })];
  }

  function confirmCurrentDraft(ctx, raw, t) {
    if (CONFIRM_WORDS.has(t)) return confirmOrder(ctx);
    if (DECLINE_WORDS.has(t)) return cancel(ctx);
    return [textReply('confirm_invalid', texts.CONFIRM_INVALID)];
  }

  // A confirm button can be tapped long after its draft is gone, so check what it points at.
  async function confirmByPayload(ctx, draftId) {
    const { session, psid } = ctx;
    if (session.step === STEPS.WAITING_FOR_CONFIRMATION && isId(draftId) && session.draftId === draftId) {
      return confirmOrder(ctx);
    }
    const existing = isId(draftId) ? await orders.findByIdempotencyKey(draftId) : null;
    if (existing && existing.customerPsid === psid) {
      return [textReply('order_duplicate', texts.orderDuplicate(existing))];
    }
    return [textReply('confirm_stale', texts.CONFIRM_STALE)];
  }

  // --- the main menu (IDLE and BROWSING_PRODUCTS) ---

  async function showOrders({ psid }) {
    const recent = await orders.listByCustomer(psid, { limit: RECENT_ORDERS_LIMIT });
    return [textReply('order_info', texts.orderInfo(recent))];
  }

  function menuChoice(ctx, raw, t) {
    if (CATALOG_WORDS.has(t)) return showCatalog(ctx, 1, 'catalog');
    if (ORDER_INFO_WORDS.has(t)) return showOrders(ctx);
    if (SUPPORT_WORDS.has(t)) return [textReply('support', texts.SUPPORT)];

    if (ctx.session.step === STEPS.BROWSING_PRODUCTS) {
      if (NEXT_WORDS.has(t)) return turnPage(ctx, 1);
      if (PREVIOUS_WORDS.has(t)) return turnPage(ctx, -1);
    }

    const code = PRODUCT_CODE.exec(t);
    if (code) return startOrder(ctx, code[1]);
    return [textReply('fallback', texts.FALLBACK)];
  }

  const STEP_HANDLERS = {
    [STEPS.IDLE]: menuChoice,
    [STEPS.BROWSING_PRODUCTS]: menuChoice,
    [STEPS.WAITING_FOR_QUANTITY]: takeQuantity,
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
      if (!isId(pageId) || !isId(psid)) return [textReply('fallback', texts.FALLBACK)];

      const key = conversationKey(pageId, psid);
      const ctx = { key, psid, session: await sessions.get(key) };
      // Awaited here (not just returned) so a failing store lands in the catch below.
      if (input?.type === 'payload') return await handlePayload(ctx, input.payload);
      if (input?.type === 'text') return await handleText(ctx, input.text);
      return [textReply('fallback', texts.FALLBACK)];
    } catch {
      return [textReply('fallback', texts.FALLBACK)];
    }
  }

  return { handle };
}

export const conversationService = createConversationService();
