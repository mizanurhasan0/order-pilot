import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_PAGE_SIZE, createCatalog } from '../src/catalog.js';
import { createConversationService } from '../src/services/conversationService.js';
import {
  CANCEL_ORDER_PAYLOAD,
  MENU_PAYLOAD,
  MY_ORDERS_PAYLOAD,
  NEW_DETAILS_PAYLOAD,
  SUPPORT_PAYLOAD,
  USE_SAVED_ADDRESS_PAYLOAD,
  USE_SAVED_DETAILS_PAYLOAD,
  USE_SAVED_PHONE_PAYLOAD,
  catalogPagePayload,
  confirmOrderPayload,
  orderProductPayload,
  quantityPayload,
} from '../src/services/payloads.js';
import { products } from './fixtures/products.js';
import * as quick from '../src/services/quickReplies.js';
import * as texts from '../src/services/replyTexts.js';
import { createOrderStore } from '../src/store/orderStore.js';
import { createPreferenceStore } from '../src/store/preferenceStore.js';
import { SESSION_TTL_MS, STEPS, conversationKey, createSessionStore } from '../src/store/sessionStore.js';

const ALICE = { pageId: 'page-1', psid: '1000000001' };
const BOB = { pageId: 'page-1', psid: '1000000002' };
const ALICE_ON_OTHER_PAGE = { pageId: 'page-2', psid: ALICE.psid };

const PHONE = '01712345678';
const ADDRESS = 'House 12, Road 3, Tangail Sadar';
const FIRST = products[0];
const SECOND = products[1];
const CATALOG = createCatalog(products);
const getCatalogPage = (page) => CATALOG.getCatalogPage(page);
const TOTAL_PAGES = (await getCatalogPage(1)).totalPages;

// A fresh engine per test with its own stores and a clock the test controls.
function setup({ catalog = CATALOG } = {}) {
  let time = 1_000_000;
  const clock = {
    now: () => time,
    advance(ms) {
      time += ms;
    },
  };
  const sessions = createSessionStore({ now: clock.now });
  const orders = createOrderStore();
  const preferences = createPreferenceStore();
  const service = createConversationService({ sessions, orders, preferences, catalog });

  const handle = (who, input) => service.handle({ ...who, input });
  return {
    clock,
    sessions,
    orders,
    preferences,
    catalog,
    service,
    say: (text, who = ALICE) => handle(who, { type: 'text', text }),
    tap: (payload, who = ALICE) => handle(who, { type: 'payload', payload }),
    session: (who = ALICE) => sessions.get(conversationKey(who.pageId, who.psid)),
  };
}

// Takes a customer through every question and returns the order summary reply.
async function reachSummary(h, who = ALICE, { product = FIRST, quantity = '2', phone = PHONE, address = ADDRESS } = {}) {
  await h.tap(orderProductPayload(product.id), who);
  await h.say(quantity, who);
  await h.say(phone, who);
  return (await h.say(address, who))[0];
}

function summaryText(product, quantity, phone, address) {
  return `🛍️ আপনার অর্ডার:

পণ্য: ${product.name}
পরিমাণ: ${quantity}
একক দাম: ৳${product.price}
মোট দাম: ৳${product.price * quantity}
মোবাইল: ${phone}
ঠিকানা: ${address}

ডেলিভারি চার্জ: এখনো যোগ করা হয়নি

অর্ডারটি নিশ্চিত করবেন?

1. ✅ নিশ্চিত করুন
2. ❌ বাতিল করুন`;
}

// A small catalog whose products the test can change after the conversation has started.
function createFakeCatalog(items) {
  return {
    items,
    getProductById: (id) => items.find((item) => item.id === String(id).trim().toUpperCase()) ?? null,
    getCatalogPage: () => ({
      items: items.filter((item) => item.available),
      page: 1,
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
    }),
  };
}

const fakeProduct = (overrides = {}) => ({
  id: 'P900',
  name: 'Test Saree',
  description: 'A product used only by tests.',
  category: 'Saree',
  price: 500,
  currency: 'BDT',
  imageUrl: 'https://images.example.com/test.jpg',
  available: true,
  ...overrides,
});

function assertSingleText(replies, rule, text) {
  assert.equal(replies.length, 1);
  assert.equal(replies[0].kind, 'text');
  assert.equal(replies[0].rule, rule);
  if (text !== undefined) assert.equal(replies[0].text, text);
}

// --- welcome, menu and the main menu choices -----------------------------------------------

test('greetings reply with the welcome menu', async () => {
  const h = setup();
  for (const greeting of ['Hi', 'hello', 'HEY', 'start', 'menu', 'মেনু', 'হাই', 'হ্যালো', '  Hi!  ']) {
    assertSingleText(await h.say(greeting), 'welcome', texts.WELCOME);
  }
});

test('welcome-type payloads show the menu: MENU, GET_STARTED and unknown payloads', async () => {
  const h = setup();
  for (const payload of [MENU_PAYLOAD, 'GET_STARTED', 'SOMETHING_ELSE', 'ORDER_PRODUCT_X', '', null, 42]) {
    assertSingleText(await h.tap(payload), 'welcome', texts.WELCOME);
  }
});

test('2 in the menu with no orders says there are none; 3 and help show support', async () => {
  const h = setup();
  assertSingleText(await h.say('2'), 'order_info', texts.orderInfo([]));
  assertSingleText(await h.say('3'), 'support', texts.SUPPORT);
  assertSingleText(await h.say('Help'), 'support', texts.SUPPORT);
  assertSingleText(await h.say('support'), 'support', texts.SUPPORT);
});

test('anything else in the menu gets the fallback and changes nothing', async () => {
  const h = setup();
  for (const text of ['what is the price?', '4', 'next', 'previous', '😀', '']) {
    assertSingleText(await h.say(text), 'fallback', texts.FALLBACK);
  }
  assert.equal(h.session().step, STEPS.IDLE);
});

test('"2" shows only the customer\'s own latest orders, without phone or address', async () => {
  const h = setup();
  const make = (customerPsid, n) =>
    h.orders.create({
      productId: FIRST.id,
      productName: FIRST.name,
      quantity: n,
      unitPrice: FIRST.price,
      currency: 'BDT',
      customerPsid,
      phone: '01999999999',
      address: 'A secret street address 99',
    }).order;
  const mine = [make(ALICE.psid, 1), make(ALICE.psid, 2), make(ALICE.psid, 3), make(ALICE.psid, 4)];
  const bobs = make(BOB.psid, 5);

  for (const input of ['2', 'my orders', 'My Order Information', 'order information']) {
    const [reply] = await h.say(input);
    assert.equal(reply.rule, 'order_info');
    assert.ok(!reply.text.includes(mine[0].id), 'only the 3 newest orders are listed');
    for (const order of mine.slice(1)) {
      assert.ok(reply.text.includes(`${order.id} – ${FIRST.name} × ${order.quantity} – ৳${order.subtotal} – অপেক্ষমাণ`));
    }
    assert.ok(!reply.text.includes(bobs.id));
    assert.ok(!reply.text.includes('01999999999'));
    assert.ok(!reply.text.includes('secret street'));
  }
  assert.ok((await h.say('2', BOB))[0].text.includes(bobs.id));
});

// --- catalog ---------------------------------------------------------------------------------

test('1 shows catalog page 1 with the navigation and fallback texts', async () => {
  const h = setup();
  const [reply, ...rest] = await h.say('1');
  const page = await getCatalogPage(1);

  assert.equal(rest.length, 0);
  assert.equal(reply.kind, 'catalog');
  assert.equal(reply.rule, 'catalog');
  assert.equal(reply.page, 1);
  assert.equal(reply.totalPages, page.totalPages);
  assert.equal(reply.products.length, CATALOG_PAGE_SIZE);
  assert.deepEqual(
    reply.products.map((product) => product.id),
    page.items.map((product) => product.id),
  );
  assert.equal(reply.navText, texts.catalogNav({ page: 1, totalPages: page.totalPages }));
  assert.equal(reply.fallbackText, texts.catalogFallback(page.items, 1, page.totalPages));
  assert.ok(reply.fallbackText.includes(`${page.items[0].id} – ${page.items[0].name} – ৳${page.items[0].price}`));
  assert.equal(h.session().step, STEPS.BROWSING_PRODUCTS);
  assert.equal(h.session().page, 1);
});

test('catalog aliases: products, catalog, order, view products, পণ্য, অর্ডার, ১', async () => {
  const h = setup();
  for (const text of ['products', 'Product', 'catalog', 'order', 'View Products', 'পণ্য', 'অর্ডার', '১']) {
    const [reply] = await h.say(text);
    assert.equal(reply.kind, 'catalog', text);
    assert.equal(reply.page, 1);
  }
});

test('CATALOG_PAGE payload shows that page and remembers it', async () => {
  const h = setup();
  const [reply] = await h.tap(catalogPagePayload(2));
  const expected = await getCatalogPage(2);
  assert.equal(reply.kind, 'catalog');
  assert.equal(reply.rule, 'catalog_page');
  assert.equal(reply.page, expected.page);
  assert.deepEqual(
    reply.products.map((product) => product.id),
    expected.items.map((product) => product.id),
  );
  assert.equal(h.session().step, STEPS.BROWSING_PRODUCTS);
  assert.equal(h.session().page, expected.page);
});

test('CATALOG_PAGE payload clamps out-of-range and invalid page numbers', async () => {
  const h = setup();
  assert.equal((await h.tap(catalogPagePayload(99999)))[0].page, TOTAL_PAGES);
  assert.equal((await h.tap(catalogPagePayload(0)))[0].page, 1);
  assert.equal((await h.tap('CATALOG_PAGE:-3'))[0].page, 1);
  assert.equal((await h.tap('CATALOG_PAGE:abc'))[0].page, 1);
  assert.equal((await h.tap('CATALOG_PAGE:2.5'))[0].page, 1);
  assert.equal((await h.tap('CATALOG_PAGE'))[0].page, 1);
});

test('next and previous move between catalog pages', async () => {
  const h = setup();
  await h.say('1');

  const next = (await h.say('next'))[0];
  assert.equal(next.kind, 'catalog');
  assert.equal(next.rule, 'catalog_page');
  assert.equal(next.page, Math.min(2, TOTAL_PAGES));

  await h.tap(catalogPagePayload(2));
  assert.equal((await h.say('Previous'))[0].page, 1);
  await h.tap(catalogPagePayload(2));
  assert.equal((await h.say('prev'))[0].page, 1);
  await h.tap(catalogPagePayload(2));
  assert.equal((await h.say('back'))[0].page, 1);
});

test('previous on the first page and next on the last page explain the edge', async () => {
  const h = setup();
  await h.say('1');
  assertSingleText(await h.say('previous'), 'catalog_edge', texts.CATALOG_EDGE_FIRST);
  assert.equal(h.session().page, 1);

  await h.tap(catalogPagePayload(TOTAL_PAGES));
  assertSingleText(await h.say('next'), 'catalog_edge', texts.CATALOG_EDGE_LAST);
  assert.equal(h.session().page, TOTAL_PAGES);
  assert.equal(h.session().step, STEPS.BROWSING_PRODUCTS);
});

test('an empty catalog gets a text reply instead of an empty card list', async () => {
  const h = setup({ catalog: createFakeCatalog([fakeProduct({ available: false })]) });
  assertSingleText(await h.say('1'), 'catalog', texts.CATALOG_EMPTY);
  assert.equal(h.session().step, STEPS.IDLE);
});

// --- starting an order -----------------------------------------------------------------------

test('ORDER_PRODUCT payload asks for the quantity and creates no order', async () => {
  const h = setup();
  assertSingleText(await h.tap(orderProductPayload(FIRST.id)), 'order_start', texts.orderStart(FIRST));

  const session = h.session();
  assert.equal(session.step, STEPS.WAITING_FOR_QUANTITY);
  assert.equal(session.productId, FIRST.id);
  assert.equal(h.orders.size(), 0);
});

test('a product link asks for the quantity together with the product photo', async () => {
  const h = setup();
  const input = { type: 'payload', payload: orderProductPayload(FIRST.id), fromLink: true };
  const replies = await h.service.handle({ ...ALICE, input });

  assert.deepEqual(replies, [
    {
      kind: 'text_with_photo',
      rule: 'order_start',
      imageUrl: FIRST.imageUrl,
      text: texts.orderStart(FIRST),
      quickReplies: quick.QUANTITY,
    },
  ]);
  assert.equal(h.session().step, STEPS.WAITING_FOR_QUANTITY);
  assert.equal(h.session().productId, FIRST.id);
});

test('a link to an unknown product, or any other payload from a link, gets no photo', async () => {
  const h = setup();
  const fromLink = (payload) => h.service.handle({ ...ALICE, input: { type: 'payload', payload, fromLink: true } });

  assertSingleText(await fromLink('ORDER_PRODUCT:P999'), 'product_not_found', texts.PRODUCT_NOT_FOUND);
  assertSingleText(await fromLink(MENU_PAYLOAD), 'welcome', texts.WELCOME);
});

test('typing a product code starts an order from the menu and from the catalog', async () => {
  const h = setup();
  assertSingleText(await h.say(FIRST.id.toLowerCase()), 'order_start', texts.orderStart(FIRST));
  assert.equal(h.session().productId, FIRST.id);

  await h.say('cancel');
  await h.say('1');
  assertSingleText(await h.say(`order ${SECOND.id}`), 'order_start', texts.orderStart(SECOND));
  assert.equal(h.session().productId, SECOND.id);

  await h.say('বাতিল');
  assertSingleText(await h.say(`Order ${FIRST.id.toLowerCase()}!`), 'order_start', texts.orderStart(FIRST));
  assert.equal(h.orders.size(), 0);
});

test('unknown or unavailable products reply product_not_found and keep the session', async () => {
  const unavailable = fakeProduct({ id: 'P901', available: false });
  const h = setup({ catalog: createFakeCatalog([fakeProduct(), unavailable]) });

  assertSingleText(await h.say('p404'), 'product_not_found', texts.PRODUCT_NOT_FOUND);
  assertSingleText(await h.tap('ORDER_PRODUCT:NOPE'), 'product_not_found', texts.PRODUCT_NOT_FOUND);
  assertSingleText(await h.tap('ORDER_PRODUCT'), 'product_not_found', texts.PRODUCT_NOT_FOUND);
  assertSingleText(await h.tap(orderProductPayload(unavailable.id)), 'product_not_found');
  assertSingleText(await h.say('p901'), 'product_not_found');
  assert.equal(h.session().step, STEPS.IDLE);

  // An in-progress draft survives a tap on a card that no longer exists.
  await h.tap(orderProductPayload('P900'));
  await h.say('3');
  assertSingleText(await h.tap('ORDER_PRODUCT:P404'), 'product_not_found');
  assert.equal(h.session().step, STEPS.WAITING_FOR_PHONE);
  assert.equal(h.session().quantity, 3);
});

test('a product code is only a command in the menu, not while an answer is expected', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  assertSingleText(await h.say(SECOND.id), 'quantity_invalid', texts.QUANTITY_INVALID);
  assert.equal(h.session().productId, FIRST.id);
});

// --- quantity, phone and address ---------------------------------------------------------------

test('invalid quantities are rejected and the state does not change', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  for (const text of ['0', '101', '2.5', '-1', 'abc', '', 'two', '5 pcs', '1000', '😀']) {
    assertSingleText(await h.say(text), 'quantity_invalid', texts.QUANTITY_INVALID);
    assert.equal(h.session().step, STEPS.WAITING_FOR_QUANTITY, text);
    assert.equal(h.session().quantity, null, text);
  }
  assert.equal(h.orders.size(), 0);
});

test('1 is a quantity while the quantity is expected; the Bangla digit works too', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  assertSingleText(await h.say('1'), 'quantity_ok', texts.askPhone(null));
  assert.equal(h.session().quantity, 1);
  assert.equal(h.session().step, STEPS.WAITING_FOR_PHONE);

  await h.say('cancel');
  await h.tap(orderProductPayload(FIRST.id));
  assertSingleText(await h.say('১০০'), 'quantity_ok', texts.askPhone(null));
  assert.equal(h.session().quantity, 100);
});

test('invalid phone numbers are rejected politely and the state does not change', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  for (const text of ['abc', '01212345678', '0171234567', '12345', '', '1']) {
    assertSingleText(await h.say(text), 'phone_invalid', texts.PHONE_INVALID);
    assert.equal(h.session().step, STEPS.WAITING_FOR_PHONE, text);
    assert.equal(h.session().phone, null);
  }
});

test('phone numbers are stored in the local 01XXXXXXXXX form', async () => {
  const inputs = ['+8801712345678', '8801712345678', '017 1234 5678', '017-1234-5678', '০১৭১২৩৪৫৬৭৮'];
  for (const input of inputs) {
    const h = setup();
    await h.tap(orderProductPayload(FIRST.id));
    await h.say('2');
    assertSingleText(await h.say(input), 'phone_ok', texts.askAddress(null));
    assert.equal(h.session().phone, PHONE, input);
    assert.equal(h.session().step, STEPS.WAITING_FOR_ADDRESS);
  }
});

test('addresses that are too short or too long are rejected', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  await h.say(PHONE);
  for (const text of ['Tangail', 'a'.repeat(9), 'a'.repeat(201), '   ', '']) {
    assertSingleText(await h.say(text), 'address_invalid', texts.ADDRESS_INVALID);
    assert.equal(h.session().step, STEPS.WAITING_FOR_ADDRESS);
    assert.equal(h.session().address, null);
  }
  assert.equal(h.orders.size(), 0);
});

// --- the summary and the confirmation ------------------------------------------------------------

test('a valid address produces the order summary with the normalized phone, and no order yet', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  await h.say('+8801712345678');
  const replies = await h.say('  House 12,   Road 3, Tangail Sadar ');

  assert.equal(replies.length, 1);
  const [summary] = replies;
  assert.equal(summary.kind, 'order_confirmation');
  assert.equal(summary.rule, 'order_summary');
  assert.match(summary.draftId, /^[0-9a-f]{16}$/);
  assert.equal(summary.text, summaryText(FIRST, 2, PHONE, ADDRESS));

  assert.equal(h.session().step, STEPS.WAITING_FOR_CONFIRMATION);
  assert.equal(h.session().draftId, summary.draftId);
  assert.equal(h.orders.size(), 0, 'nothing is saved before the customer confirms');
});

test('each draft gets its own draft id', async () => {
  const h = setup();
  const first = await reachSummary(h);
  await h.say('cancel');
  const second = await reachSummary(h);
  assert.notEqual(first.draftId, second.draftId);
});

test('anything but a confirm or cancel answer re-asks and keeps the draft', async () => {
  const h = setup();
  const summary = await reachSummary(h);
  // Sent like the summary, so the Confirm / Cancel quick replies come back with the reminder.
  for (const text of ['maybe', '3', 'ok', '১২', '']) {
    assert.deepEqual(await h.say(text), [
      {
        kind: 'order_confirmation',
        rule: 'confirm_invalid',
        text: texts.CONFIRM_INVALID,
        draftId: summary.draftId,
        language: 'bn',
      },
    ]);
  }
  assert.equal(h.session().step, STEPS.WAITING_FOR_CONFIRMATION);
  assert.equal(h.session().draftId, summary.draftId);
  assert.equal(h.orders.size(), 0);
});

test('text 1 confirms: one order with a snapshot, then the session is clean', async () => {
  const h = setup();
  await reachSummary(h, ALICE, { product: FIRST, quantity: '3' });

  const replies = await h.say('1');
  assert.equal(h.orders.size(), 1);
  const [order] = h.orders.list();
  assert.equal(replies.length, 1);
  assertSingleText(replies, 'order_confirmed', texts.orderConfirmed(order));
  assert.equal(replies[0].orderId, order.id);

  assert.equal(order.productId, FIRST.id);
  assert.equal(order.productName, FIRST.name);
  assert.equal(order.quantity, 3);
  assert.equal(order.unitPrice, FIRST.price);
  assert.equal(order.subtotal, FIRST.price * 3);
  assert.equal(order.customerPsid, ALICE.psid);
  assert.equal(order.phone, PHONE);
  assert.equal(order.address, ADDRESS);
  assert.equal(order.status, 'pending');

  assert.deepEqual(h.session(), h.sessions.get('nobody:nobody'));
  assert.ok(replies[0].text.includes(`অর্ডার আইডি: ${order.id}`));
  assert.ok(replies[0].text.includes(`মোট: ৳${FIRST.price * 3}`));
  assert.ok(!replies[0].text.includes(PHONE));
  assert.ok(!replies[0].text.includes(ADDRESS));
});

test('confirm words in the confirmation step: confirm, yes, y, হ্যাঁ, হ্যা, and the Bangla 1', async () => {
  for (const word of ['confirm', 'Yes', 'y', 'হ্যাঁ', 'হ্যা', '১']) {
    const h = setup();
    await reachSummary(h);
    assert.equal((await h.say(word))[0].rule, 'order_confirmed', word);
    assert.equal(h.orders.size(), 1);
  }
});

test('the Confirm button payload confirms the current draft', async () => {
  const h = setup();
  const summary = await reachSummary(h);
  const replies = await h.tap(confirmOrderPayload(summary.draftId));
  assert.equal(replies[0].rule, 'order_confirmed');
  assert.equal(replies[0].orderId, h.orders.list()[0].id);
  assert.equal(h.orders.size(), 1);
  assert.equal(h.session().step, STEPS.IDLE);
});

test('double confirm creates exactly one order: text twice, payload twice, text then payload', async () => {
  const textTwice = setup();
  await reachSummary(textTwice);
  await textTwice.say('1');
  await textTwice.say('1'); // now in the menu, where 1 simply shows the catalog
  assert.equal(textTwice.orders.size(), 1);

  const payloadTwice = setup();
  const second = await reachSummary(payloadTwice);
  const payload = confirmOrderPayload(second.draftId);
  await payloadTwice.tap(payload);
  const duplicate = await payloadTwice.tap(payload);
  assert.equal(payloadTwice.orders.size(), 1);
  assertSingleText(duplicate, 'order_duplicate', texts.orderDuplicate(payloadTwice.orders.list()[0]));

  const mixed = setup();
  const third = await reachSummary(mixed);
  assert.equal((await mixed.say('1'))[0].rule, 'order_confirmed');
  const late = await mixed.tap(confirmOrderPayload(third.draftId));
  assert.equal(mixed.orders.size(), 1);
  assert.equal(late[0].rule, 'order_duplicate');
  assert.ok(late[0].text.includes(mixed.orders.list()[0].id));
});

test('confirm_stale for unknown, malformed, cancelled and other customers\' drafts', async () => {
  const h = setup();
  assertSingleText(await h.tap(confirmOrderPayload('0123456789abcdef')), 'confirm_stale', texts.CONFIRM_STALE);
  assertSingleText(await h.tap('CONFIRM_ORDER'), 'confirm_stale', texts.CONFIRM_STALE);
  assertSingleText(await h.tap('CONFIRM_ORDER:'), 'confirm_stale', texts.CONFIRM_STALE);

  const cancelled = await reachSummary(h);
  await h.say('2');
  assertSingleText(await h.tap(confirmOrderPayload(cancelled.draftId)), 'confirm_stale');

  const bobsDraft = await reachSummary(h, BOB);
  await h.tap(confirmOrderPayload(bobsDraft.draftId), BOB);
  assertSingleText(await h.tap(confirmOrderPayload(bobsDraft.draftId)), 'confirm_stale'); // Alice taps Bob's old button
  assert.equal(h.orders.size(), 1);
});

test('an old confirm button does not confirm a newer draft', async () => {
  const h = setup();
  const oldDraft = await reachSummary(h, ALICE, { product: FIRST });
  const newDraft = await reachSummary(h, ALICE, { product: SECOND });
  assert.notEqual(oldDraft.draftId, newDraft.draftId);

  // The order in progress is shown again with its own, current Confirm button.
  const [resumed] = await h.tap(confirmOrderPayload(oldDraft.draftId));
  assert.equal(resumed.rule, 'order_resumed');
  assert.equal(resumed.draftId, newDraft.draftId);
  assert.equal(h.orders.size(), 0);
  assert.equal(h.session().draftId, newDraft.draftId);

  await h.tap(confirmOrderPayload(newDraft.draftId));
  assert.equal(h.orders.size(), 1);
  assert.equal(h.orders.list()[0].productId, SECOND.id);
});

test('the price and name come from the product at confirmation time', async () => {
  const product = fakeProduct({ price: 500 });
  const h = setup({ catalog: createFakeCatalog([product]) });
  await reachSummary(h, ALICE, { product, quantity: '2' });

  product.price = 600;
  product.name = 'Renamed Saree';
  await h.say('1');
  const [order] = h.orders.list();
  assert.equal(order.unitPrice, 600);
  assert.equal(order.subtotal, 1200);
  assert.equal(order.productName, 'Renamed Saree');
});

test('a product that disappears before confirmation cancels the order politely', async () => {
  const product = fakeProduct();
  const h = setup({ catalog: createFakeCatalog([product]) });
  await reachSummary(h, ALICE, { product });

  product.available = false;
  assertSingleText(await h.say('1'), 'order_cancelled', texts.ORDER_PRODUCT_UNAVAILABLE);
  assert.equal(h.orders.size(), 0);
  assert.equal(h.session().step, STEPS.IDLE);
});

// --- cancelling and resetting ------------------------------------------------------------------

test('2, no, না, cancel, বাতিল and CANCEL_ORDER cancel the draft and reset the session', async () => {
  const cancellers = [
    (h) => h.say('2'),
    (h) => h.say('no'),
    (h) => h.say('না'),
    (h) => h.say('cancel'),
    (h) => h.say('বাতিল'),
    (h) => h.say('Cancel!'),
    (h) => h.tap(CANCEL_ORDER_PAYLOAD),
  ];
  for (const cancelWith of cancellers) {
    const h = setup();
    await reachSummary(h);
    assertSingleText(await cancelWith(h), 'order_cancelled', texts.ORDER_CANCELLED);
    assert.equal(h.orders.size(), 0);
    assert.deepEqual(h.session(), h.sessions.get('nobody:nobody'));
  }
});

test('cancel works in every step', async () => {
  const steps = [
    (h) => h.tap(orderProductPayload(FIRST.id)),
    async (h) => {
      await h.tap(orderProductPayload(FIRST.id));
      await h.say('2');
    },
    async (h) => {
      await h.tap(orderProductPayload(FIRST.id));
      await h.say('2');
      await h.say(PHONE);
    },
    (h) => h.say('1'),
    () => {},
  ];
  for (const reachStep of steps) {
    const h = setup();
    await reachStep(h);
    assertSingleText(await h.say('cancel'), 'order_cancelled', texts.ORDER_CANCELLED);
    assert.equal(h.session().step, STEPS.IDLE);
    assert.equal(h.session().productId, null);
  }
});

test('menu and hi in the middle of an order keep the draft and ask the current question again', async () => {
  for (const word of ['menu', 'hi', 'Hello', 'start', 'মেনু']) {
    const h = setup();
    const summary = await reachSummary(h);
    const before = h.session();
    const [reply] = await h.say(word);
    assert.deepEqual(reply, {
      kind: 'order_confirmation',
      rule: 'order_resumed',
      text: texts.resumed(texts.ORDER_IN_PROGRESS, summary.text),
      draftId: summary.draftId,
      language: 'bn',
    });
    assert.deepEqual(h.session(), before);
    assert.equal(h.orders.size(), 0);

    await h.say('1'); // the same draft can still be confirmed
    assert.equal(h.orders.size(), 1);
  }
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  assertSingleText(
    await h.tap(MENU_PAYLOAD),
    'order_resumed',
    texts.resumed(texts.ORDER_IN_PROGRESS, texts.askPhone(null)),
  );
  assert.equal(h.session().step, STEPS.WAITING_FOR_PHONE);
  assert.equal(h.session().quantity, 2);
});

test('every step of an order is asked again after a word that is not an answer', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  let [reply] = await h.say('hi');
  assert.equal(reply.text, texts.resumed(texts.ORDER_IN_PROGRESS, texts.orderStart(FIRST)));
  assert.deepEqual(reply.quickReplies, quick.QUANTITY);

  await h.say('2');
  await h.say(PHONE);
  [reply] = await h.say('hello');
  assert.equal(reply.text, texts.resumed(texts.ORDER_IN_PROGRESS, texts.askAddress(null)));
  assert.deepEqual(reply.quickReplies, quick.address(null));
  assert.equal(h.session().step, STEPS.WAITING_FOR_ADDRESS);
});

test('only cancel starts over in the middle of an order', async () => {
  for (const word of ['cancel', 'বাতিল', 'বাতিল করুন', 'delete']) {
    const h = setup();
    await h.tap(orderProductPayload(FIRST.id));
    await h.say('2');
    assertSingleText(await h.say(word), 'order_cancelled', texts.ORDER_CANCELLED);
    assert.equal(h.session().step, STEPS.IDLE);
  }
});

test('My orders and Support in the middle of an order answer, then ask the current question again', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  for (const [payload, rule] of [[MY_ORDERS_PAYLOAD, 'order_info'], [SUPPORT_PAYLOAD, 'support']]) {
    const [info, question] = await h.tap(payload);
    assert.equal(info.rule, rule);
    assert.equal(info.quickReplies, undefined);
    assert.equal(question.rule, 'order_resumed');
    assert.deepEqual(question.quickReplies, quick.QUANTITY);
  }
  assert.equal(h.session().step, STEPS.WAITING_FOR_QUANTITY);
});

test('an attachment repeats the current question in an order and explains itself outside one', async () => {
  const h = setup();
  assertSingleText(await h.service.handle({ ...ALICE, input: { type: 'attachment' } }), 'attachment', texts.ATTACHMENT);
  await h.tap(orderProductPayload(FIRST.id));
  const [reply] = await h.service.handle({ ...ALICE, input: { type: 'attachment' } });
  assert.equal(reply.text, texts.resumed(texts.ATTACHMENT_IN_ORDER, texts.orderStart(FIRST)));
  assert.equal(h.session().step, STEPS.WAITING_FOR_QUANTITY);
});

test('after a reset the next order starts from a clean slate', async () => {
  const h = setup();
  await reachSummary(h);
  await h.say('cancel');
  await h.say('1'); // the menu choice, not a confirmation
  assert.equal(h.orders.size(), 0);
  const summary = await reachSummary(h, ALICE, { product: SECOND, quantity: '4', phone: '01812345678' });
  assert.equal(summary.text, summaryText(SECOND, 4, '01812345678', ADDRESS));
});

test('choosing another product mid-order restarts the draft cleanly', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  await h.say(PHONE);
  assertSingleText(await h.tap(orderProductPayload(SECOND.id)), 'order_start', texts.orderStart(SECOND));

  const session = h.session();
  assert.equal(session.step, STEPS.WAITING_FOR_QUANTITY);
  assert.equal(session.productId, SECOND.id);
  assert.equal(session.quantity, null);
  assert.equal(session.phone, null);
  assert.equal(session.address, null);
  assert.equal(session.draftId, null);

  await h.say('5');
  await h.say('01912345678');
  const summary = (await h.say('Road 7, Tangail Town'))[0];
  assert.equal(summary.text, summaryText(SECOND, 5, '01912345678', 'Road 7, Tangail Town'));
});

test('an old catalog button in the middle of an order keeps the draft', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  assert.equal((await h.tap(catalogPagePayload(1)))[0].rule, 'order_resumed');
  const session = h.session();
  assert.equal(session.step, STEPS.WAITING_FOR_PHONE);
  assert.equal(session.productId, FIRST.id);
  assert.equal(session.quantity, 2);
});

// --- isolation and expiry --------------------------------------------------------------------------

test('two customers on the same page have fully separate conversations', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id), ALICE);
  await h.tap(orderProductPayload(SECOND.id), BOB);
  await h.say('2', ALICE);
  await h.say('7', BOB);
  await h.say(PHONE, ALICE);
  await h.say('01812345678', BOB);
  const aliceSummary = (await h.say(ADDRESS, ALICE))[0];
  const bobSummary = (await h.say('Bob\'s home, Mirzapur, Tangail', BOB))[0];

  assert.equal(aliceSummary.text, summaryText(FIRST, 2, PHONE, ADDRESS));
  assert.equal(bobSummary.text, summaryText(SECOND, 7, '01812345678', 'Bob\'s home, Mirzapur, Tangail'));
  assert.notEqual(aliceSummary.draftId, bobSummary.draftId);

  await h.say('1', ALICE);
  assert.equal(h.orders.size(), 1);
  assert.equal(h.session(BOB).step, STEPS.WAITING_FOR_CONFIRMATION);

  await h.say('1', BOB);
  assert.equal(h.orders.size(), 2);
  assert.deepEqual(
    h.orders.list().map((order) => [order.customerPsid, order.productId]),
    [
      [BOB.psid, SECOND.id],
      [ALICE.psid, FIRST.id],
    ],
  );
});

test('the same customer id on two pages is two different conversations', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id), ALICE);
  assert.equal(h.session(ALICE).step, STEPS.WAITING_FOR_QUANTITY);
  assert.equal(h.session(ALICE_ON_OTHER_PAGE).step, STEPS.IDLE);

  assertSingleText(await h.say('2', ALICE_ON_OTHER_PAGE), 'order_info');
  assert.equal((await h.say('1', ALICE_ON_OTHER_PAGE))[0].kind, 'catalog');
  assert.equal(h.session(ALICE).step, STEPS.WAITING_FOR_QUANTITY);
});

test('a session idle for 30 minutes expires: one notice, then normal replies', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');

  h.clock.advance(SESSION_TTL_MS);
  assertSingleText(await h.say(PHONE), 'session_expired', texts.SESSION_EXPIRED);
  assert.equal(h.session().step, STEPS.IDLE);
  assert.equal(h.session().phone, null);

  assert.equal((await h.say('1'))[0].kind, 'catalog');
});

test('a session is still alive one millisecond before the timeout', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  h.clock.advance(SESSION_TTL_MS - 1);
  assertSingleText(await h.say('2'), 'quantity_ok');
});

test('activity keeps the session alive', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  h.clock.advance(SESSION_TTL_MS - 1000);
  await h.say('2');
  h.clock.advance(SESSION_TTL_MS - 1000);
  assertSingleText(await h.say(PHONE), 'phone_ok');
});

test('after expiry, global commands and buttons still work without an expiry notice', async () => {
  const asMenu = setup();
  await asMenu.tap(orderProductPayload(FIRST.id));
  asMenu.clock.advance(SESSION_TTL_MS);
  assertSingleText(await asMenu.say('menu'), 'welcome', texts.WELCOME);
  assert.equal((await asMenu.say('1'))[0].kind, 'catalog');

  const asButton = setup();
  await asButton.tap(orderProductPayload(FIRST.id));
  asButton.clock.advance(SESSION_TTL_MS);
  assertSingleText(await asButton.tap(orderProductPayload(SECOND.id)), 'order_start', texts.orderStart(SECOND));
});

test('an expired draft cannot be confirmed any more', async () => {
  const h = setup();
  const summary = await reachSummary(h);
  h.clock.advance(SESSION_TTL_MS);
  assertSingleText(await h.tap(confirmOrderPayload(summary.draftId)), 'confirm_stale', texts.CONFIRM_STALE);
  assert.equal(h.orders.size(), 0);
});

test('text 1 after the draft expired only shows the expiry notice and orders nothing', async () => {
  const h = setup();
  await reachSummary(h);
  h.clock.advance(SESSION_TTL_MS);
  assertSingleText(await h.say('1'), 'session_expired', texts.SESSION_EXPIRED);
  assert.equal(h.orders.size(), 0);
});

// --- robustness and privacy ----------------------------------------------------------------------------

test('garbage input never throws and always returns a reply list', async () => {
  const h = setup();
  const inputs = [
    undefined,
    null,
    {},
    [],
    42,
    'text',
    { type: 'text' },
    { type: 'text', text: null },
    { type: 'text', text: 12345 },
    { type: 'text', text: { toString: () => 'x' } },
    { type: 'text', text: ['1'] },
    { type: 'text', text: 'x'.repeat(1_000_000) },
    { type: 'text', text: '1'.repeat(100_000) },
    { type: 'text', text: '\u0000\uD800' },
    { type: 'payload' },
    { type: 'payload', payload: null },
    { type: 'payload', payload: 12345 },
    { type: 'payload', payload: {} },
    { type: 'payload', payload: 'ORDER_PRODUCT:' + 'P'.repeat(100_000) },
    { type: 'payload', payload: 'CONFIRM_ORDER:' + 'a'.repeat(5000) },
    { type: 'attachment' },
    { type: 'weird', text: 'hi' },
  ];
  for (const input of inputs) {
    const replies = await h.service.handle({ ...ALICE, input });
    assert.ok(Array.isArray(replies) && replies.length >= 1, JSON.stringify(input)?.slice(0, 40));
    for (const reply of replies) {
      assert.ok(['text', 'catalog', 'order_confirmation'].includes(reply.kind));
      assert.equal(typeof reply.rule, 'string');
    }
  }
  assert.equal(h.orders.size(), 0);

  for (const args of [undefined, null, {}, { input: { type: 'text', text: 'hi' } }, { pageId: 'p', input: { type: 'text', text: 'hi' } }]) {
    assertSingleText(await h.service.handle(args), 'fallback', texts.FALLBACK);
  }
});

test('an unexpected failure inside a store becomes the fallback reply', async () => {
  const brokenSessions = {
    get() {
      throw new Error('boom');
    },
  };
  const service = createConversationService({
    sessions: brokenSessions,
    orders: createOrderStore(),
    preferences: createPreferenceStore(),
  });
  assertSingleText(await service.handle({ ...ALICE, input: { type: 'text', text: 'hi' } }), 'fallback', texts.FALLBACK);

  // A Redis store fails by rejecting rather than throwing.
  const unreachableSessions = {
    get: async () => {
      throw new Error('ECONNRESET');
    },
  };
  const offline = createConversationService({
    sessions: unreachableSessions,
    orders: createOrderStore(),
    preferences: createPreferenceStore(),
  });
  assertSingleText(await offline.handle({ ...ALICE, input: { type: 'text', text: '1' } }), 'fallback', texts.FALLBACK);

  const h = setup();
  const summary = await reachSummary(h);
  const failingOrders = {
    create() {
      throw new TypeError('invalid order');
    },
    findByIdempotencyKey: () => null,
    listByCustomer: () => [],
  };
  const failing = createConversationService({
    sessions: h.sessions,
    orders: failingOrders,
    preferences: h.preferences,
    catalog: h.catalog,
  });
  assertSingleText(await failing.handle({ ...ALICE, input: { type: 'text', text: '1' } }), 'fallback', texts.FALLBACK);
  // The draft is kept, so the customer can simply try again.
  assert.equal(h.session().step, STEPS.WAITING_FOR_CONFIRMATION);
  assert.equal(h.session().draftId, summary.draftId);
});

test('handle resolves to the replies and does not log anything', async () => {
  const spies = ['log', 'error', 'warn', 'info', 'debug'].map((method) => mock.method(console, method, () => {}));
  try {
    const h = setup();
    const result = await h.say('hi');
    assert.ok(Array.isArray(result), 'handle resolves to a list of replies');
    const summary = await reachSummary(h);
    await h.tap(confirmOrderPayload(summary.draftId));
    await h.say('2');
    await h.say('garbage');
    await h.service.handle(null);
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  } finally {
    mock.restoreAll();
  }
});

test('phone and address appear only in the order summary, never in other replies', async () => {
  const h = setup();
  const seen = [];
  const record = (replies) => seen.push(...replies);
  record(await h.tap(orderProductPayload(FIRST.id)));
  record(await h.say('2'));
  record(await h.say(PHONE));
  const summary = await h.say(ADDRESS);
  record(await h.say('maybe'));
  record(await h.say('1'));
  record(await h.say('2'));
  record(await h.say('my orders'));
  record(await h.tap(confirmOrderPayload(summary[0].draftId)));

  for (const reply of seen) {
    assert.ok(!JSON.stringify(reply).includes(PHONE), reply.rule);
    assert.ok(!JSON.stringify(reply).includes('Tangail Sadar'), reply.rule);
  }
  assert.ok(summary[0].text.includes(PHONE));
  assert.ok(summary[0].text.includes(ADDRESS));
});

// --- quick replies -------------------------------------------------------------------------

test('every step offers its quick replies', async () => {
  const h = setup();
  assert.deepEqual((await h.say('hi'))[0].quickReplies, quick.MENU);
  assert.deepEqual((await h.tap(orderProductPayload(FIRST.id)))[0].quickReplies, quick.QUANTITY);
  assert.deepEqual((await h.say('many'))[0].quickReplies, quick.QUANTITY);
  assert.deepEqual((await h.say('2'))[0].quickReplies, quick.phone(null));
  assert.deepEqual((await h.say('12345'))[0].quickReplies, quick.phone(null));
  assert.deepEqual((await h.say(PHONE))[0].quickReplies, quick.address(null));
  assert.deepEqual((await h.say('short'))[0].quickReplies, quick.address(null));
  await h.say(ADDRESS);
  const [confirmed] = await h.say('1');
  assert.equal(confirmed.rule, 'order_confirmed');
  assert.deepEqual(confirmed.quickReplies, quick.AFTER_ORDER);
  assert.deepEqual((await h.say('gibberish'))[0].quickReplies, quick.MENU);
  assert.deepEqual((await h.say('cancel'))[0].quickReplies, quick.MENU);
});

test('the quantity quick reply answers the quantity question', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  assertSingleText(await h.tap(quantityPayload(3)), 'quantity_ok', texts.askPhone(null));
  assert.equal(h.session().quantity, 3);
  assert.equal(h.session().step, STEPS.WAITING_FOR_PHONE);
});

test('a quick reply from an earlier step changes nothing', async () => {
  const h = setup();
  for (const payload of [quantityPayload(2), USE_SAVED_DETAILS_PAYLOAD, NEW_DETAILS_PAYLOAD]) {
    const [reply] = await h.tap(payload);
    assert.equal(reply.rule, 'button_stale');
    assert.deepEqual(reply.quickReplies, quick.MENU);
    assert.equal(h.session().step, STEPS.IDLE);
  }
  await h.tap(orderProductPayload(FIRST.id));
  await h.tap(quantityPayload(2));
  // In the middle of an order an old button asks the current question again.
  assert.equal((await h.tap(quantityPayload(4)))[0].rule, 'order_resumed');
  assert.equal(h.session().quantity, 2);
  assert.equal(h.session().step, STEPS.WAITING_FOR_PHONE);
});

test('the My Orders and Support quick replies work like 2 and 3', async () => {
  const h = setup();
  assertSingleText(await h.tap(MY_ORDERS_PAYLOAD), 'order_info', texts.orderInfo([]));
  assertSingleText(await h.tap(SUPPORT_PAYLOAD), 'support', texts.SUPPORT);
});

// --- returning customers -------------------------------------------------------------------

// Places one confirmed order, so the customer has saved details.
async function orderOnce(h, who = ALICE, details = {}) {
  await reachSummary(h, who, details);
  await h.say('1', who);
}

test('a returning customer is offered the phone and address of their last order', async () => {
  const h = setup();
  await orderOnce(h);
  await h.tap(orderProductPayload(SECOND.id));
  const [offer] = await h.say('1');
  assert.equal(offer.rule, 'saved_details');
  assert.equal(offer.text, texts.savedDetails({ phone: PHONE, address: ADDRESS }));
  assert.deepEqual(offer.quickReplies, quick.SAVED_DETAILS);
  assert.equal(h.session().step, STEPS.WAITING_FOR_SAVED_DETAILS);

  const [summary] = await h.tap(USE_SAVED_DETAILS_PAYLOAD);
  assert.equal(summary.kind, 'order_confirmation');
  assert.equal(summary.text, summaryText(SECOND, 1, PHONE, ADDRESS));
  await h.say('1');
  const [latest] = h.orders.listByCustomer(ALICE.psid, { limit: 1 });
  assert.equal(latest.productId, SECOND.id);
  assert.equal(latest.phone, PHONE);
  assert.equal(latest.address, ADDRESS);
});

test('typing 1, yes or হ্যাঁ uses the saved details; 2, no or না asks for new ones', async () => {
  for (const word of ['1', 'yes', 'হ্যাঁ']) {
    const h = setup();
    await orderOnce(h);
    await h.tap(orderProductPayload(FIRST.id));
    await h.say('2');
    assert.equal((await h.say(word))[0].rule, 'order_summary');
  }
  for (const word of ['2', 'no', 'না']) {
    const h = setup();
    await orderOnce(h);
    await h.tap(orderProductPayload(FIRST.id));
    await h.say('2');
    const [reply] = await h.say(word);
    assert.equal(reply.rule, 'new_details');
    assert.equal(reply.text, texts.askPhone(PHONE)); // the last number is still offered on its own
    assert.equal(h.session().step, STEPS.WAITING_FOR_PHONE);
    assert.equal(h.session().phone, null);
    assert.equal(h.session().address, null);
  }
});

test('the New details quick reply asks for a new phone and address, which are then used', async () => {
  const h = setup();
  await orderOnce(h);
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  assertSingleText(await h.tap(NEW_DETAILS_PAYLOAD), 'new_details', texts.askPhone(PHONE));
  assertSingleText(await h.say('01898765432'), 'phone_ok', texts.askAddress(ADDRESS));
  const [summary] = await h.say('Flat 4B, Lake Road, Dhaka 1212');
  assert.equal(summary.text, summaryText(FIRST, 2, '01898765432', 'Flat 4B, Lake Road, Dhaka 1212'));
});

test('after New details, the 📱 and 🏠 buttons keep the last phone or address on its own', async () => {
  // Keep the number, change the address.
  let h = setup();
  await orderOnce(h);
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  const [phoneQuestion] = await h.tap(NEW_DETAILS_PAYLOAD);
  assert.deepEqual(phoneQuestion.quickReplies, [
    { type: 'user_phone_number' },
    { title: `📱 ${PHONE}`, payload: USE_SAVED_PHONE_PAYLOAD },
    { title: texts.BUTTONS.cancel, payload: CANCEL_ORDER_PAYLOAD },
  ]);
  assertSingleText(await h.tap(USE_SAVED_PHONE_PAYLOAD), 'phone_ok', texts.askAddress(ADDRESS));
  let [summary] = await h.say('Flat 4B, Lake Road, Dhaka 1212');
  assert.equal(summary.text, summaryText(FIRST, 2, PHONE, 'Flat 4B, Lake Road, Dhaka 1212'));

  // Change the number, keep the address.
  h = setup();
  await orderOnce(h);
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  await h.tap(NEW_DETAILS_PAYLOAD);
  const [addressQuestion] = await h.say('01898765432');
  assert.deepEqual(addressQuestion.quickReplies, [
    { title: texts.BUTTONS.savedAddress, payload: USE_SAVED_ADDRESS_PAYLOAD },
    { title: texts.BUTTONS.cancel, payload: CANCEL_ORDER_PAYLOAD },
  ]);
  [summary] = await h.tap(USE_SAVED_ADDRESS_PAYLOAD);
  assert.equal(summary.rule, 'order_summary');
  assert.equal(summary.text, summaryText(FIRST, 2, '01898765432', ADDRESS));
});

test('a first-time customer gets no 📱 or 🏠 button, and those payloads change nothing', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  assert.deepEqual((await h.say('2'))[0].quickReplies, quick.phone(null));
  assert.equal((await h.tap(USE_SAVED_PHONE_PAYLOAD))[0].rule, 'order_resumed');
  assert.deepEqual((await h.say(PHONE))[0].quickReplies, quick.address(null));
  assert.equal((await h.tap(USE_SAVED_ADDRESS_PAYLOAD))[0].rule, 'order_resumed');
  assert.equal(h.session().step, STEPS.WAITING_FOR_ADDRESS);
});

test('typing a new phone number at the saved-details question goes on to the address', async () => {
  const h = setup();
  await orderOnce(h);
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  assertSingleText(await h.say('+8801898765432'), 'phone_ok', texts.askAddress(ADDRESS));
  assert.equal(h.session().phone, '01898765432');
  assert.equal(h.session().step, STEPS.WAITING_FOR_ADDRESS);
});

test('anything else at the saved-details question re-asks with the same buttons', async () => {
  const h = setup();
  await orderOnce(h);
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');
  const [reply] = await h.say('maybe');
  assert.equal(reply.rule, 'saved_details_invalid');
  assert.equal(reply.text, texts.SAVED_DETAILS_INVALID);
  assert.deepEqual(reply.quickReplies, quick.SAVED_DETAILS);
  assert.equal(h.session().step, STEPS.WAITING_FOR_SAVED_DETAILS);
});

test('saved details belong to one customer: another customer is asked for their own', async () => {
  const h = setup();
  await orderOnce(h, ALICE);
  await h.tap(orderProductPayload(FIRST.id), BOB);
  const replies = await h.say('2', BOB);
  assertSingleText(replies, 'quantity_ok', texts.askPhone(null));
  assert.ok(!JSON.stringify(replies).includes(PHONE));
});

test('without a catalog there is nothing to sell', async () => {
  const sessions = createSessionStore();
  const service = createConversationService({ sessions, orders: createOrderStore(), preferences: createPreferenceStore() });
  const ask = (text) => service.handle({ ...ALICE, input: { type: 'text', text } });

  assertSingleText(await ask('hi'), 'welcome', texts.WELCOME);
  assertSingleText(await ask('1'), 'catalog', texts.CATALOG_EMPTY);
  assertSingleText(await ask('p001'), 'product_not_found', texts.PRODUCT_NOT_FOUND);
});

test('the shop name goes into the welcome, read on every message', async () => {
  let name = 'Tangail Botiques';
  const service = createConversationService({
    sessions: createSessionStore(),
    orders: createOrderStore(),
    preferences: createPreferenceStore(),
    shopName: () => name,
  });
  const ask = (text) => service.handle({ ...ALICE, input: { type: 'text', text } });

  assertSingleText(await ask('hi'), 'welcome', texts.textsFor('bn', 'Tangail Botiques').WELCOME);
  name = 'Dhaka Fashion';
  assertSingleText(await ask('hi'), 'welcome', texts.textsFor('bn', 'Dhaka Fashion').WELCOME);
  const fixed = createConversationService({
    sessions: createSessionStore(),
    orders: createOrderStore(),
    preferences: createPreferenceStore(),
    shopName: 'My Shop',
  });
  const [welcome] = await fixed.handle({ ...ALICE, input: { type: 'text', text: 'hi' } });
  assert.equal(welcome.text, texts.textsFor('bn', 'My Shop').WELCOME);
});

test('a catalog function (a database query) is read on every lookup, and products default sensibly', async () => {
  let rows = [{ id: 'X1', name: 'Plain Kurti', price: 900, imageUrl: 'https://images.example.com/x1.jpg' }];
  const h = setup({ catalog: createCatalog(async () => rows) });

  const [catalogReply] = await h.say('1');
  assert.equal(catalogReply.kind, 'catalog');
  assert.deepEqual(
    catalogReply.products.map((product) => [product.id, product.currency]),
    [['X1', 'BDT']],
    'available and currency default to true and BDT',
  );

  rows = [...rows, { id: 'X2', name: 'Hidden', price: 500, available: false }, { id: 'X3', name: 'No price' }];
  assert.deepEqual((await h.say('1'))[0].products.map((product) => product.id), ['X1']);
  // The shop's own ids can be typed like P001 codes; one that is not in the catalog is not an id.
  assertSingleText(await h.say('x2'), 'product_not_found', texts.PRODUCT_NOT_FOUND);
  assertSingleText(await h.say('x3'), 'fallback', texts.FALLBACK);
  assertSingleText(await h.say('hello there'), 'fallback', texts.FALLBACK);
  const [start] = await h.say('order X1');
  assert.equal(start.rule, 'order_start');
  assert.equal(h.session().productId, 'X1');
});

// --- language ----------------------------------------------------------------------------------

const EN = texts.textsFor('en');
const EN_QUICK = quick.quickRepliesFor('en');
const ALICE_KEY = conversationKey(ALICE.pageId, ALICE.psid);

test('a customer with English stored gets English texts and buttons all the way', async () => {
  const h = setup();
  h.preferences.setLanguage(ALICE_KEY, 'en');

  const [welcome] = await h.say('hi');
  assert.equal(welcome.text, EN.WELCOME);
  assert.deepEqual(welcome.quickReplies, EN_QUICK.MENU);

  const [start] = await h.tap(orderProductPayload(FIRST.id));
  assert.equal(start.text, EN.orderStart(FIRST));
  assert.deepEqual(start.quickReplies, EN_QUICK.QUANTITY);
  assert.equal((await h.say('2'))[0].text, EN.askPhone(null));
  assert.equal((await h.say(PHONE))[0].text, EN.askAddress(null));
  const [summary] = await h.say(ADDRESS);
  assert.equal(summary.language, 'en');
  assert.ok(summary.text.startsWith('🛍️ Your order:'));
  assert.equal((await h.say('1'))[0].text, EN.orderConfirmed(h.orders.list()[0]));

  const [catalogReply] = await h.say('1');
  assert.equal(catalogReply.language, 'en');
  assert.equal(catalogReply.navText, EN.catalogNav(await getCatalogPage(1)));

  // Somebody else is untouched and still gets Bangla.
  assertSingleText(await h.say('hi', BOB), 'welcome', texts.WELCOME);
});

test('the 🌐 button switches the language, which outlives the session', async () => {
  const h = setup();
  const [welcome] = await h.say('hi');
  const languageButton = welcome.quickReplies.at(-1);
  assert.deepEqual(languageButton, { title: '🌐 English', payload: 'LANGUAGE:en' });

  const [changed] = await h.tap(languageButton.payload);
  assert.equal(changed.rule, 'language_changed');
  assert.equal(changed.text, texts.resumed(EN.LANGUAGE_CHANGED, EN.WELCOME));
  assert.deepEqual(changed.quickReplies.at(-1), { title: '🌐 বাংলা', payload: 'LANGUAGE:bn' });
  assert.equal(h.preferences.getLanguage(ALICE_KEY), 'en');

  h.clock.advance(SESSION_TTL_MS);
  assertSingleText(await h.say('hi'), 'welcome', EN.WELCOME);

  const [back] = await h.tap('LANGUAGE:bn');
  assert.equal(back.text, texts.resumed(texts.LANGUAGE_CHANGED, texts.WELCOME));
  assert.equal(h.preferences.getLanguage(ALICE_KEY), 'bn');
});

test('typing a language name switches too', async () => {
  for (const [word, language] of [
    ['english', 'en'],
    ['English!', 'en'],
    ['ইংরেজি', 'en'],
    ['bangla', 'bn'],
    ['বাংলা', 'bn'],
  ]) {
    const h = setup();
    assert.equal((await h.say(word))[0].rule, 'language_changed', word);
    assert.equal(h.preferences.getLanguage(ALICE_KEY), language, word);
  }
});

test('switching language in the middle of an order keeps it and asks the question in the new language', async () => {
  const h = setup();
  await h.tap(orderProductPayload(FIRST.id));
  await h.say('2');

  const [question] = await h.say('english');
  assert.equal(question.rule, 'order_resumed');
  assert.equal(question.text, texts.resumed(EN.LANGUAGE_CHANGED_IN_ORDER, EN.askPhone(null)));
  assert.deepEqual(question.quickReplies, EN_QUICK.phone(null));
  assert.equal(h.session().step, STEPS.WAITING_FOR_PHONE);
  assert.equal(h.session().quantity, 2);

  await h.say(PHONE);
  const [summary] = await h.say(ADDRESS);
  assert.equal(summary.language, 'en');
});

test('an unknown language payload changes nothing', async () => {
  const h = setup();
  assertSingleText(await h.tap('LANGUAGE:fr'), 'welcome', texts.WELCOME);
  assertSingleText(await h.tap('LANGUAGE'), 'welcome', texts.WELCOME);
  assert.equal(h.preferences.getLanguage(ALICE_KEY), null);
});
