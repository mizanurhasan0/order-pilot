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
//       | { kind: 'text_with_photo', rule, imageUrl, text, quickReplies }   (the photo goes first)
//       | { kind: 'catalog', rule, products, page, totalPages, navText, fallbackText }
//       | { kind: 'order_confirmation', rule, text, draftId }   (sent with Confirm / Cancel)

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

const textReply = (rule, text, extra) => ({ kind: 'text', rule, text, ...extra });
const menuReply = (rule, text) => textReply(rule, text, { quickReplies: quick.MENU });
const isId = (value) => typeof value === 'string' && value !== '';
const newDraftId = () => randomUUID().replaceAll('-', '').slice(0, 16);

const phoneQuestion = (rule, previousPhone) =>
  textReply(rule, texts.askPhone(previousPhone), { quickReplies: quick.phone(previousPhone) });
const addressQuestion = (rule, previousAddress) =>
  textReply(rule, texts.askAddress(previousAddress), { quickReplies: quick.address(previousAddress) });

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

  // An answer that is not part of the order (My orders, Support). Outside an order it comes with
  // the menu buttons; in the middle of one, the current question follows instead.
  async function infoReply(ctx, rule, text) {
    if (!isOrdering(ctx.session)) return [menuReply(rule, text)];
    return [textReply(rule, text), ...(await resume(ctx))];
  }

  function support(ctx) {
    return infoReply(ctx, 'support', texts.SUPPORT);
  }

  // A button from an earlier step (Messenger can still show it after a restart).
  function inStep(ctx, step, run) {
    if (ctx.session.step === step) return run();
    return isOrdering(ctx.session) ? resume(ctx) : [menuReply('button_stale', texts.BUTTON_STALE)];
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
  // A returning customer is offered the phone and address of their last order together after
  // the quantity. Choosing new details still offers each of them on its own (📱 / 🏠 buttons),
  // so the customer can keep one and change the other.

  // Choosing a product only starts a draft. No order exists until the customer confirms.
  // A customer who came through a product link has not seen the product's card, so the question
  // comes with its photo.
  async function startOrder({ key }, productId, { withPhoto = false } = {}) {
    const product = availableProduct(productId);
    if (!product) return [menuReply('product_not_found', texts.PRODUCT_NOT_FOUND)];

    await sessions.update(key, { ...NO_DRAFT, step: STEPS.WAITING_FOR_QUANTITY, page: 1, productId: product.id });
    const reply = textReply('order_start', texts.orderStart(product), { quickReplies: quick.QUANTITY });
    return [withPhoto ? { ...reply, kind: 'text_with_photo', imageUrl: product.imageUrl } : reply];
  }

  // The phone and address of the customer's last order, each null when missing or no longer valid.
  async function previousDetailsOf(psid) {
    const [last] = await orders.listByCustomer(psid, { limit: 1 });
    return { phone: normalizeBdPhone(last?.phone), address: parseAddress(last?.address) };
  }

  async function takeQuantity({ key, psid }, raw) {
    const quantity = parseQuantity(raw);
    if (quantity === null) {
      return [textReply('quantity_invalid', texts.QUANTITY_INVALID, { quickReplies: quick.QUANTITY })];
    }

    const previous = await previousDetailsOf(psid);
    if (previous.phone && previous.address) {
      await sessions.update(key, { step: STEPS.WAITING_FOR_SAVED_DETAILS, quantity, ...previous });
      return [textReply('saved_details', texts.savedDetails(previous), { quickReplies: quick.SAVED_DETAILS })];
    }
    await sessions.update(key, { step: STEPS.WAITING_FOR_PHONE, quantity });
    return [phoneQuestion('quantity_ok', previous.phone)];
  }

  function useSavedDetails(ctx) {
    const { phone, address } = ctx.session;
    return showSummary(ctx, { phone, address });
  }

  async function askNewDetails({ key, psid }) {
    const previous = await previousDetailsOf(psid);
    await sessions.update(key, { step: STEPS.WAITING_FOR_PHONE, phone: null, address: null });
    return [phoneQuestion('new_details', previous.phone)];
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

  async function takePhone({ key, psid }, raw) {
    const phone = normalizeBdPhone(raw);
    const previous = await previousDetailsOf(psid);
    if (phone === null) {
      return [textReply('phone_invalid', texts.PHONE_INVALID, { quickReplies: quick.phone(previous.phone) })];
    }

    await sessions.update(key, { step: STEPS.WAITING_FOR_ADDRESS, phone });
    return [addressQuestion('phone_ok', previous.address)];
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
      return [textReply('address_invalid', texts.ADDRESS_INVALID, { quickReplies: quick.address(previous.address) })];
    }
    return showSummary(ctx, { phone: ctx.session.phone, address });
  }

  // The 🏠 button: the address of the last order (asked again if it is gone in the meantime).
  async function usePreviousAddress(ctx) {
    const { address } = await previousDetailsOf(ctx.psid);
    return address ? showSummary(ctx, { phone: ctx.session.phone, address }) : resume(ctx);
  }

  const summaryOf = (product, quantity, { phone, address }) =>
    texts.orderSummary({
      name: product.name,
      quantity,
      unitPrice: product.price,
      subtotal: product.price * quantity,
      phone,
      address,
    });

  async function showSummary({ key, session }, { phone, address }) {
    const product = availableProduct(session.productId);
    if (!product) return unavailableProduct(key);

    const draftId = newDraftId();
    await sessions.update(key, { step: STEPS.WAITING_FOR_CONFIRMATION, phone, address, draftId });
    const summary = summaryOf(product, session.quantity, { phone, address });
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
    return isOrdering(session) ? resume(ctx) : [menuReply('confirm_stale', texts.CONFIRM_STALE)];
  }

  // --- keeping an order in progress ---

  // Mid-order, anything that is not an answer to the current question (a greeting, Menu, an old
  // button, a sticker) keeps the draft and asks the current question again under `note`.
  // Only Cancel, or choosing another product, ends the draft.
  async function resume(ctx, note = texts.ORDER_IN_PROGRESS) {
    const { key, psid, session } = ctx;
    const product = availableProduct(session.productId);
    if (!product) return unavailableProduct(key);

    const again = (question, quickReplies) =>
      textReply('order_resumed', texts.resumed(note, question), { quickReplies });

    switch (session.step) {
      case STEPS.WAITING_FOR_QUANTITY:
        return [again(texts.orderStart(product), quick.QUANTITY)];
      case STEPS.WAITING_FOR_SAVED_DETAILS:
        return [again(texts.savedDetails(session), quick.SAVED_DETAILS)];
      case STEPS.WAITING_FOR_PHONE: {
        const previous = await previousDetailsOf(psid);
        return [again(texts.askPhone(previous.phone), quick.phone(previous.phone))];
      }
      case STEPS.WAITING_FOR_ADDRESS: {
        const previous = await previousDetailsOf(psid);
        return [again(texts.askAddress(previous.address), quick.address(previous.address))];
      }
      default: {
        // WAITING_FOR_CONFIRMATION: the same draft id, so the Confirm button keeps working.
        const summary = summaryOf(product, session.quantity, session);
        return [
          { kind: 'order_confirmation', rule: 'order_resumed', text: texts.resumed(note, summary), draftId: session.draftId },
        ];
      }
    }
  }

  // --- the main menu (IDLE and BROWSING_PRODUCTS) ---

  async function showOrders(ctx) {
    const recent = await orders.listByCustomer(ctx.psid, { limit: RECENT_ORDERS_LIMIT });
    return infoReply(ctx, 'order_info', texts.orderInfo(recent));
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
      default: // MENU, GET_STARTED and anything we do not recognise
        return isOrdering(ctx.session) ? resume(ctx) : welcome(ctx);
    }
  }

  function handleText(ctx, text) {
    const raw = typeof text === 'string' ? text : '';
    const t = normalizeText(raw);
    if (CANCEL_WORDS.has(t)) return cancel(ctx);
    if (MENU_WORDS.has(t)) return isOrdering(ctx.session) ? resume(ctx) : welcome(ctx);
    if (ctx.session.expired) return sessionExpired();

    const stepHandler = STEP_HANDLERS[ctx.session.step];
    return stepHandler ? stepHandler(ctx, raw, t) : welcome(ctx);
  }

  // Photos, stickers, likes, voice notes: never opened or downloaded. In the middle of an order
  // they repeat the current question; otherwise the bot explains that it reads text only.
  function handleAttachment(ctx) {
    if (isOrdering(ctx.session)) return resume(ctx, texts.ATTACHMENT_IN_ORDER);
    return [menuReply('attachment', texts.ATTACHMENT)];
  }

  async function handle(request) {
    try {
      const { pageId, psid, input } = request ?? {};
      if (!isId(pageId) || !isId(psid)) return [menuReply('fallback', texts.FALLBACK)];

      const key = conversationKey(pageId, psid);
      const ctx = { key, psid, session: await sessions.get(key) };
      // Awaited here (not just returned) so a failing store lands in the catch below.
      if (input?.type === 'payload') {
        return await handlePayload(ctx, input.payload, { fromLink: input.fromLink === true });
      }
      if (input?.type === 'text') return await handleText(ctx, input.text);
      if (input?.type === 'attachment') return await handleAttachment(ctx);
      return [menuReply('fallback', texts.FALLBACK)];
    } catch {
      return [menuReply('fallback', texts.FALLBACK)];
    }
  }

  return { handle };
}

export const conversationService = createConversationService();
