import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { inspect } from 'node:util';
import express from 'express';
import webhookRouter from '../src/routes/facebookWebhook.js';
import ordersRouter from '../src/routes/orders.js';
import { MENU_PAYLOAD, catalogPagePayload, confirmOrderPayload, orderProductPayload } from '../src/services/payloads.js';
import { getCatalogPage } from '../src/services/productService.js';
import * as texts from '../src/services/replyTexts.js';
import { orderStore } from '../src/store/orderStore.js';
import { sessionStore } from '../src/store/sessionStore.js';

// End-to-end test of the whole Messenger order conversation: the REAL webhook router (with
// its signature check), the REAL auto-reply pipeline, conversation engine, stores, Send API
// client and the REAL admin orders router on a tiny Express app. Only graph.facebook.com is
// mocked; every Graph request body is recorded. The test's own requests go to 127.0.0.1
// through the real fetch.

const VERIFY_TOKEN = 'FLOW_VERIFY_TOKEN';
const APP_SECRET = 'FLOW_APP_SECRET';
const ACCESS_TOKEN = 'FLOW_PAGE_TOKEN_DO_NOT_LEAK';
const ADMIN_KEY = 'FLOW_ADMIN_KEY_DO_NOT_LEAK_0123456789';
const PAGE_ID = '1234567890';
const GRAPH_URL = `https://graph.facebook.com/v26.0/${PAGE_ID}/messages`;

const ENV_DEFAULTS = {
  META_VERIFY_TOKEN: VERIFY_TOKEN,
  META_APP_SECRET: APP_SECRET,
  PAGE_ACCESS_TOKEN: ACCESS_TOKEN,
  FACEBOOK_PAGE_ID: PAGE_ID,
  META_GRAPH_API_VERSION: 'v26.0',
  ENABLE_AUTO_REPLY: 'true',
  ADMIN_API_KEY: ADMIN_KEY,
};

// The welcome menu written out independently of replyTexts.js, so a typo there is caught.
const WELCOME_TEXT = `স্বাগতম! 🛍️

Tangail Botiques-এ আপনাকে স্বাগতম।

আমাদের পণ্য দেখতে অথবা অর্ডার করতে নিচের অপশন নির্বাচন করুন।

1. 🛍️ View Products
2. 📦 My Order Information
3. 👨‍💼 Contact Support`;

const PHONE_INPUT = '+88 017-1234-5678';
const PHONE = '01712345678'; // what the store must keep
const ADDRESS = 'House 12, Road 3, Hidden Lane, Tangail Sadar';

const realFetch = globalThis.fetch;
const events = new EventEmitter();

const PAGE_1 = getCatalogPage(1);
const [FIRST, SECOND] = PAGE_1.items;

let baseUrl;
let server;
let savedEnv;
let graphCalls;
let graphHandler;
let consoleEntries;
let unhandledRejections;
let customers;
let counter = 0;

const onUnhandledRejection = (reason) => unhandledRejections.push(reason);

// ---------- test plumbing ----------

// Resolves as soon as predicate() is true; re-checked whenever a Graph call or a log line arrives.
function waitFor(predicate, description, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (predicate()) return resolve();
    const check = () => {
      if (!predicate()) return;
      clearTimeout(timer);
      events.off('tick', check);
      resolve();
    };
    const timer = setTimeout(() => {
      events.off('tick', check);
      reject(new Error(`Timed out waiting for ${description}`));
    }, timeoutMs);
    events.on('tick', check);
  });
}

const okResponse = (call) =>
  new Response(JSON.stringify({ recipient_id: call.body.recipient.id, message_id: `m_graph_${(counter += 1)}` }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const graphErrorResponse = (error, status = 400) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

function installFetchMock() {
  mock.method(globalThis, 'fetch', (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
    if (!url.startsWith('https://graph.facebook.com/')) {
      throw new Error('Unexpected network call to a host other than graph.facebook.com');
    }
    const call = {
      url,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: JSON.parse(init?.body ?? 'null'),
    };
    graphCalls.push(call);
    events.emit('tick');
    return graphHandler(call);
  });
}

function installConsoleCapture() {
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    mock.method(console, level, (...args) => {
      consoleEntries.push({
        level,
        tag: String(args[0]),
        data: args[1],
        text: args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg))).join(' '),
      });
      events.emit('tick');
    });
  }
}

const sign = (body) => `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

async function postRaw(body, signature) {
  const headers = { 'content-type': 'application/json' };
  if (signature !== undefined) headers['x-hub-signature-256'] = signature;
  const res = await fetch(`${baseUrl}/api/webhooks/facebook`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, text: await res.text() };
}

const payloadFor = (messaging) => ({
  object: 'page',
  entry: [{ id: PAGE_ID, time: Date.now(), messaging }],
});

const postSigned = (payload) => {
  const body = JSON.stringify(payload);
  return postRaw(body, sign(body));
};

// The orders API, with the admin key unless `key` says otherwise.
async function adminApi(path = '', { key = ADMIN_KEY, method = 'GET', body } = {}) {
  const headers = {};
  if (key !== null) headers['x-admin-key'] = key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}/api/orders${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, json: await res.json() };
}

const ordersOf = async (psid) =>
  (await adminApi()).json.data.filter((order) => order.customerPsid === psid);

// ---------- reading what was sent ----------

const logged = (tag) => consoleEntries.filter((entry) => entry.tag === tag).map((entry) => JSON.parse(entry.data));
const maskedPsid = (psid) => `…${psid.slice(-4)}`;
const SEND_RESULT_TAGS = ['[SendAPI] Reply sent successfully', '[SendAPI] Reply failed'];

// How many replies of this customer have been answered (sent or failed) so far.
const settledReplies = (psid) =>
  consoleEntries.filter(
    (entry) => SEND_RESULT_TAGS.includes(entry.tag) && JSON.parse(entry.data).senderId === maskedPsid(psid),
  ).length;

const bodiesTo = (psid) => graphCalls.filter((call) => call.body.recipient.id === psid).map((call) => call.body);
const templateOf = (body) => body.message.attachment?.payload;
const textsOf = (bodies) => bodies.map((body) => body.message.text);
const quickReplyPayloads = (body) => body.message.quick_replies.map((item) => item.payload);
const buttonPayloads = (element) => element.buttons.map((button) => button.payload);

// ---------- customers ----------

// A customer with a unique PSID (unique last four digits, which is all the logs may show).
function newCustomer() {
  counter += 1;
  const psid = `77000000${String(counter).padStart(8, '0')}`;
  customers.push(psid);

  const base = () => ({ sender: { id: psid }, recipient: { id: PAGE_ID }, timestamp: Date.now() });
  const mid = () => `m_flow_${process.pid}_${(counter += 1)}`;
  const textEvent = (text) => ({ ...base(), message: { mid: mid(), text } });
  const quickReplyEvent = (payload, title = 'a quick reply') => ({
    ...base(),
    message: { mid: mid(), text: title, quick_reply: { payload } },
  });
  const postbackEvent = (payload, postbackMid = mid()) => ({
    ...base(),
    postback: { mid: postbackMid, title: 'a button', payload },
  });

  // Posts the events as one signed webhook delivery and waits until `replies` answers were
  // sent (or failed). Resolves with the Graph request bodies this customer received meanwhile.
  async function deliver(list, replies = 1) {
    const callsBefore = graphCalls.length;
    const answeredBefore = settledReplies(psid);
    const res = await postSigned(payloadFor(list));
    assert.equal(res.status, 200);
    assert.equal(res.text, 'EVENT_RECEIVED');
    await waitFor(() => settledReplies(psid) >= answeredBefore + replies, `${replies} answer(s) for ${psid}`);
    return graphCalls
      .slice(callsBefore)
      .filter((call) => call.body.recipient.id === psid)
      .map((call) => call.body);
  }

  return {
    psid,
    textEvent,
    quickReplyEvent,
    postbackEvent,
    deliver,
    say: (text) => deliver([textEvent(text)]),
    tap: (payload) => deliver([postbackEvent(payload)]),
    quickReply: (payload, title) => deliver([quickReplyEvent(payload, title)]),
  };
}

// Takes a customer through the questions; resolves with { draftId, summary } (the summary body).
async function reachSummary(
  customer,
  { product = FIRST, quantity = '2', phone = PHONE_INPUT, address = ADDRESS } = {},
) {
  await customer.tap(orderProductPayload(product.id));
  await customer.say(quantity);
  await customer.say(phone);
  const [summary] = await customer.say(address);
  const [confirm] = templateOf(summary).buttons;
  return { summary, draftId: confirm.payload.slice('CONFIRM_ORDER:'.length) };
}

// Proves that nothing was sent for events that must be ignored: a different customer is
// answered afterwards, and only that customer's answer may exist beyond `expectedCalls`.
async function assertNothingSentSince(expectedCalls) {
  const canary = newCustomer();
  await canary.say('hi');
  const others = graphCalls.filter((call) => call.body.recipient.id !== canary.psid);
  assert.equal(others.length, expectedCalls);
}

// ---------- the test app ----------

describe('Messenger order conversation (webhook + orders API)', () => {
  before(async () => {
    const app = express();
    app.get('/health', (req, res) => {
      res.json({ success: true, message: 'OrderPilot backend is running' });
    });
    app.use('/api/webhooks/facebook', webhookRouter);
    app.use('/api/orders', ordersRouter);
    app.use((req, res) => {
      res.status(404).json({ success: false, message: 'Not found' });
    });
    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      const status = err.status ?? err.statusCode;
      res.status(Number.isInteger(status) && status >= 400 && status < 500 ? status : 500).json({ success: false });
    });
    await new Promise((resolve, reject) => {
      server = app.listen(0, '127.0.0.1');
      server.once('listening', resolve);
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    savedEnv = Object.fromEntries(Object.keys(ENV_DEFAULTS).map((key) => [key, process.env[key]]));
    Object.assign(process.env, ENV_DEFAULTS);
    graphCalls = [];
    consoleEntries = [];
    unhandledRejections = [];
    customers = [];
    graphHandler = okResponse;
    sessionStore.clear();
    orderStore.clear();
    process.on('unhandledRejection', onUnhandledRejection);
    installFetchMock();
    installConsoleCapture();
  });

  afterEach(() => {
    const output = consoleEntries.map((entry) => entry.text).join('\n');
    mock.restoreAll();
    process.off('unhandledRejection', onUnhandledRejection);
    sessionStore.clear();
    orderStore.clear();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    // Whatever a test did: no secret and no full PSID in the console, nothing unhandled.
    assert.deepEqual(unhandledRejections, []);
    for (const secret of [ACCESS_TOKEN, ADMIN_KEY, APP_SECRET, ...customers]) {
      assert.ok(!output.includes(secret), 'a secret or a full PSID appeared in the console output');
    }
  });

  // ---------- 1-2: the existing endpoints still work ----------

  describe('existing endpoints', () => {
    it('GET /health answers', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { success: true, message: 'OrderPilot backend is running' });
    });

    it('GET webhook verification echoes the challenge for the right token only', async () => {
      const verify = (token) =>
        fetch(
          `${baseUrl}/api/webhooks/facebook?${new URLSearchParams({
            'hub.mode': 'subscribe',
            'hub.verify_token': token,
            'hub.challenge': 'CHALLENGE_42',
          })}`,
        );

      const ok = await verify(VERIFY_TOKEN);
      assert.equal(ok.status, 200);
      assert.equal(await ok.text(), 'CHALLENGE_42');
      assert.equal((await verify('wrong-token')).status, 403);
      assert.equal(graphCalls.length, 0);
    });
  });

  // ---------- 3-6: welcome menu and catalog ----------

  describe('welcome menu and product catalog', () => {
    it('answers "Hi" with exactly one Graph request carrying the welcome menu', async () => {
      const customer = newCustomer();
      const bodies = await customer.say('Hi');

      assert.equal(graphCalls.length, 1);
      const [call] = graphCalls;
      assert.equal(call.url, GRAPH_URL);
      assert.equal(call.method, 'POST');
      assert.equal(call.headers.get('authorization'), `Bearer ${ACCESS_TOKEN}`);
      assert.ok(!call.url.includes(ACCESS_TOKEN));
      assert.deepEqual(bodies, [
        { recipient: { id: customer.psid }, messaging_type: 'RESPONSE', message: { text: WELCOME_TEXT } },
      ]);
      assert.equal(texts.WELCOME, WELCOME_TEXT);
    });

    it('"1" sends one carousel of 5 product cards, then the navigation quick replies', async () => {
      const customer = newCustomer();
      const bodies = await customer.say('1');

      assert.equal(bodies.length, 2);
      const [carousel, nav] = bodies;
      const template = templateOf(carousel);
      assert.equal(template.template_type, 'generic');
      assert.equal(template.elements.length, 5);
      assert.equal(PAGE_1.items.length, 5);

      template.elements.forEach((element, index) => {
        const product = PAGE_1.items[index];
        assert.ok(element.title.includes(`৳${product.price}`), 'the title shows the price');
        assert.ok(Array.from(element.title).length <= 80);
        assert.match(element.image_url, /^https:\/\//);
        assert.equal(element.image_url, product.imageUrl);
        assert.equal(element.buttons.length, 1);
        assert.deepEqual(element.buttons[0], {
          type: 'postback',
          title: 'Order Now',
          payload: `ORDER_PRODUCT:${product.id}`,
        });
      });

      assert.equal(nav.message.text, texts.catalogNav(PAGE_1));
      assert.ok(PAGE_1.totalPages >= 2);
      assert.deepEqual(quickReplyPayloads(nav), [catalogPagePayload(2), MENU_PAYLOAD]);
      assert.deepEqual(logged('[SendAPI] Reply sent successfully').map((data) => data.mode), ['template']);
    });

    it('page 2 opens through the Next quick reply, with Previous offered there', async () => {
      const customer = newCustomer();
      await customer.say('1');
      const bodies = await customer.quickReply(catalogPagePayload(2), 'Next ▶');

      const page2 = getCatalogPage(2);
      assert.equal(bodies.length, 2);
      assert.deepEqual(
        templateOf(bodies[0]).elements.map((element) => buttonPayloads(element)[0]),
        page2.items.map((product) => orderProductPayload(product.id)),
      );
      assert.equal(bodies[1].message.text, texts.catalogNav(page2));
      const payloads = quickReplyPayloads(bodies[1]);
      assert.equal(payloads[0], catalogPagePayload(1));
      assert.equal(payloads.at(-1), MENU_PAYLOAD);
    });

    it('page 2 opens by typing "next", and "previous" goes back to page 1', async () => {
      const customer = newCustomer();
      await customer.say('1');

      const forward = await customer.say('next');
      assert.deepEqual(
        templateOf(forward[0]).elements.map((element) => buttonPayloads(element)[0]),
        getCatalogPage(2).items.map((product) => orderProductPayload(product.id)),
      );

      const back = await customer.say('Previous');
      assert.deepEqual(
        templateOf(back[0]).elements.map((element) => buttonPayloads(element)[0]),
        PAGE_1.items.map((product) => orderProductPayload(product.id)),
      );
    });

    it('typing "next" on the last page and "previous" on the first only sends a short text', async () => {
      const customer = newCustomer();
      assert.deepEqual(textsOf(await customer.say('1').then(() => customer.say('previous'))), [
        texts.CATALOG_EDGE_FIRST,
      ]);

      await customer.quickReply(catalogPagePayload(PAGE_1.totalPages));
      assert.deepEqual(textsOf(await customer.say('next')), [texts.CATALOG_EDGE_LAST]);
    });

    it('the Menu quick reply returns to the welcome menu', async () => {
      const customer = newCustomer();
      await customer.say('1');
      assert.deepEqual(textsOf(await customer.quickReply(MENU_PAYLOAD, 'Menu')), [WELCOME_TEXT]);
    });
  });

  // ---------- 7-11: collecting the order ----------

  describe('collecting the order', () => {
    it('an Order Now postback asks for the quantity and orders nothing', async () => {
      const customer = newCustomer();
      const bodies = await customer.tap(orderProductPayload(FIRST.id));

      assert.deepEqual(textsOf(bodies), [texts.orderStart(FIRST)]);
      assert.ok(bodies[0].message.text.includes(FIRST.name));
      assert.ok(bodies[0].message.text.includes(`৳${FIRST.price}`));
      assert.ok(bodies[0].message.text.includes('কয়টি পিস অর্ডার করবেন?'));
      assert.deepEqual(await ordersOf(customer.psid), []);
    });

    it('quantity, phone and address are asked in turn and end in a Confirm / Cancel summary', async () => {
      const customer = newCustomer();
      await customer.tap(orderProductPayload(FIRST.id));

      assert.deepEqual(textsOf(await customer.say('2')), [texts.ASK_PHONE]);
      assert.deepEqual(textsOf(await customer.say(PHONE_INPUT)), [texts.ASK_ADDRESS]);

      const [summary] = await customer.say(ADDRESS);
      const template = templateOf(summary);
      assert.equal(template.template_type, 'button');
      assert.equal(
        template.text,
        texts.orderSummary({
          name: FIRST.name,
          quantity: 2,
          unitPrice: FIRST.price,
          subtotal: FIRST.price * 2,
          phone: PHONE,
          address: ADDRESS,
        }),
      );
      for (const part of [FIRST.name, 'Quantity: 2', `৳${FIRST.price * 2}`, PHONE, ADDRESS, 'Delivery charge: Not calculated']) {
        assert.ok(template.text.includes(part), `the summary shows ${part}`);
      }

      assert.equal(template.buttons.length, 2);
      const [confirm, cancel] = template.buttons;
      assert.equal(confirm.type, 'postback');
      assert.match(confirm.title, /Confirm/);
      assert.match(confirm.payload, /^CONFIRM_ORDER:[0-9a-f]{16}$/);
      assert.equal(cancel.type, 'postback');
      assert.match(cancel.title, /Cancel/);
      assert.equal(cancel.payload, 'CANCEL_ORDER');
    });

    it('no order exists in any step before the customer confirms', async () => {
      const customer = newCustomer();
      const noOrders = async () => assert.deepEqual(await ordersOf(customer.psid), []);

      await customer.say('1');
      await noOrders();
      await customer.tap(orderProductPayload(FIRST.id));
      await noOrders();
      await customer.say('2');
      await noOrders();
      await customer.say(PHONE_INPUT);
      await noOrders();
      await customer.say(ADDRESS);
      await noOrders();
      assert.equal(orderStore.size(), 0);
      assert.equal((await adminApi()).json.count, 0);
    });

    it('the quantity and phone steps reject bad input politely and do not advance', async () => {
      const customer = newCustomer();
      await customer.tap(orderProductPayload(FIRST.id));

      for (const quantity of ['0', '101', 'abc', '1.5', '-3', PHONE, 'two']) {
        assert.deepEqual(textsOf(await customer.say(quantity)), [texts.QUANTITY_INVALID], `quantity ${quantity}`);
      }
      assert.deepEqual(textsOf(await customer.say('100')), [texts.ASK_PHONE]);

      for (const phone of ['12345', '01212345678', '0171234567', '017123456789', '+8801712', 'call me later']) {
        assert.deepEqual(textsOf(await customer.say(phone)), [texts.PHONE_INVALID], `phone ${phone}`);
      }
      assert.deepEqual(textsOf(await customer.say('88017-1234-5678')), [texts.ASK_ADDRESS]);

      for (const address of ['Dhaka', 'x'.repeat(201)]) {
        assert.deepEqual(textsOf(await customer.say(address)), [texts.ADDRESS_INVALID]);
      }
      const [summary] = await customer.say(ADDRESS);
      assert.equal(templateOf(summary).template_type, 'button');
      assert.ok(templateOf(summary).text.includes('Quantity: 100'));
      assert.deepEqual(await ordersOf(customer.psid), []);
    });

    it('the summary asks to use the buttons or 1 / 2 when something else is typed', async () => {
      const customer = newCustomer();
      await reachSummary(customer);

      assert.deepEqual(textsOf(await customer.say('maybe later')), [texts.CONFIRM_INVALID]);
      assert.deepEqual(await ordersOf(customer.psid), []);
    });
  });

  // ---------- 12-14: confirming and the admin API ----------

  describe('confirming', () => {
    it('the Confirm button stores the order and sends the confirmation', async () => {
      const customer = newCustomer();
      const { draftId } = await reachSummary(customer, { product: SECOND, quantity: '3' });
      const bodies = await customer.tap(confirmOrderPayload(draftId));

      const [order, ...rest] = await ordersOf(customer.psid);
      assert.equal(rest.length, 0);
      assert.match(order.id, /^ORD-\d{4,}$/);
      assert.equal(order.productId, SECOND.id);
      assert.equal(order.productName, SECOND.name);
      assert.equal(order.quantity, 3);
      assert.equal(order.unitPrice, SECOND.price);
      assert.equal(order.subtotal, SECOND.price * 3);
      assert.equal(order.currency, SECOND.currency);
      assert.equal(order.customerPsid, customer.psid);
      assert.equal(order.phone, PHONE);
      assert.equal(order.address, ADDRESS);
      assert.equal(order.status, 'pending');
      assert.equal(new Date(order.createdAt).toISOString(), order.createdAt);

      assert.deepEqual(textsOf(bodies), [texts.orderConfirmed(order)]);
      assert.ok(bodies[0].message.text.includes(order.id));
      assert.ok(bodies[0].message.text.includes(`৳${order.subtotal}`));
      assert.equal(logged('[Order] Order created').length, 1);
    });

    it('typing 1 at the summary confirms too', async () => {
      const customer = newCustomer();
      await reachSummary(customer);
      const bodies = await customer.say('1');

      const [order] = await ordersOf(customer.psid);
      assert.deepEqual(textsOf(bodies), [texts.orderConfirmed(order)]);
    });

    it('stores a price snapshot: later catalog changes cannot alter the order', async () => {
      const customer = newCustomer();
      const { draftId } = await reachSummary(customer);
      await customer.tap(confirmOrderPayload(draftId));

      const [order] = await ordersOf(customer.psid);
      assert.equal(order.unitPrice, FIRST.price);
      assert.equal(order.subtotal, FIRST.price * 2);
      assert.equal(order.productName, FIRST.name);
    });

    it('the admin API lists, reads and updates the order and protects it with the key', async () => {
      const customer = newCustomer();
      const { draftId } = await reachSummary(customer);
      await customer.tap(confirmOrderPayload(draftId));
      const [order] = await ordersOf(customer.psid);

      // without or with a wrong key: 401, no data
      for (const key of [null, '', 'wrong-key']) {
        const res = await adminApi('', { key });
        assert.equal(res.status, 401);
        assert.deepEqual(res.json, { success: false, message: 'Unauthorized' });
      }
      assert.equal((await adminApi(`/${order.id}`, { key: null })).status, 401);
      assert.equal((await adminApi(`/${order.id}/status`, { key: null, method: 'PATCH', body: { status: 'confirmed' } })).status, 401);

      const list = await adminApi();
      assert.equal(list.status, 200);
      assert.equal(list.json.success, true);
      assert.equal(list.json.count, 1);
      assert.deepEqual(list.json.data, [order]);
      assert.equal((await adminApi('?status=pending')).json.count, 1);
      assert.equal((await adminApi('?status=confirmed')).json.count, 0);
      assert.equal((await adminApi('?status=bogus')).status, 400);

      const one = await adminApi(`/${order.id}`);
      assert.equal(one.status, 200);
      assert.deepEqual(one.json, { success: true, data: order });
      assert.equal((await adminApi('/ORD-0')).status, 404);

      const patched = await adminApi(`/${order.id}/status`, { method: 'PATCH', body: { status: 'confirmed' } });
      assert.equal(patched.status, 200);
      assert.equal(patched.json.data.status, 'confirmed');
      assert.equal((await adminApi(`/${order.id}`)).json.data.status, 'confirmed');
      assert.equal((await adminApi('?status=pending')).json.count, 0);
      assert.equal((await adminApi(`/${order.id}/status`, { method: 'PATCH', body: { status: 'shipped' } })).status, 400);
      assert.equal((await adminApi('/ORD-0/status', { method: 'PATCH', body: { status: 'confirmed' } })).status, 404);

      // the customer sees the new status, but never the phone number or address
      const [info] = await customer.say('2');
      assert.equal(
        info.message.text,
        texts.orderInfo([{ ...order, status: 'confirmed' }]),
      );
      assert.ok(info.message.text.includes('confirmed'));
      assert.ok(!info.message.text.includes(PHONE));
      assert.ok(!info.message.text.includes('Hidden Lane'));
    });

    it('a Confirm postback delivered twice with the same mid creates one order', async () => {
      const customer = newCustomer();
      const { draftId } = await reachSummary(customer);
      const confirm = customer.postbackEvent(confirmOrderPayload(draftId), `m_confirm_same_${(counter += 1)}`);

      const first = await customer.deliver([confirm]);
      assert.equal(first.length, 1);
      const callsBefore = graphCalls.length;
      const again = await postSigned(payloadFor([confirm]));
      assert.equal(again.status, 200);
      await assertNothingSentSince(callsBefore);

      assert.equal((await ordersOf(customer.psid)).length, 1);
      assert.equal(logged('[Messenger] Ignored event').filter((data) => data.reason === 'duplicate').length, 1);
    });

    it('a second Confirm tap with a new mid, and typing 1 afterwards, create no second order', async () => {
      const customer = newCustomer();
      const { draftId } = await reachSummary(customer);
      await customer.tap(confirmOrderPayload(draftId));
      const [order] = await ordersOf(customer.psid);

      const second = await customer.tap(confirmOrderPayload(draftId));
      assert.deepEqual(textsOf(second), [texts.orderDuplicate(order)]);
      assert.ok(second[0].message.text.includes(order.id));

      const typed = await customer.say('1');
      assert.equal(templateOf(typed[0]).template_type, 'generic', 'a plain 1 now means "View Products"');

      assert.equal((await ordersOf(customer.psid)).length, 1);
      assert.equal(orderStore.size(), 1);
      assert.equal(logged('[Order] Order created').length, 1);
    });

    it('two Confirm taps that arrive at the same time create one order', async () => {
      const customer = newCustomer();
      const { draftId } = await reachSummary(customer);

      const taps = [customer.postbackEvent(confirmOrderPayload(draftId)), customer.postbackEvent(confirmOrderPayload(draftId))];
      const answered = settledReplies(customer.psid);
      const [one, two] = await Promise.all(taps.map((tap) => postSigned(payloadFor([tap]))));
      assert.equal(one.status, 200);
      assert.equal(two.status, 200);
      await waitFor(() => settledReplies(customer.psid) >= answered + 2, 'both answers');

      const [order, ...rest] = await ordersOf(customer.psid);
      assert.equal(rest.length, 0);
      const answers = textsOf(bodiesTo(customer.psid).slice(-2)).sort();
      assert.deepEqual(answers, [texts.orderConfirmed(order), texts.orderDuplicate(order)].sort());
    });

    it('a stale Confirm button is refused politely', async () => {
      const customer = newCustomer();
      const bodies = await customer.tap(confirmOrderPayload('0123456789abcdef'));
      assert.deepEqual(textsOf(bodies), [texts.CONFIRM_STALE]);
      assert.equal(orderStore.size(), 0);
    });
  });

  // ---------- 16: leaving the summary ----------

  describe('leaving the confirmation step', () => {
    const exits = [
      ['typing cancel', (customer) => customer.say('cancel'), texts.ORDER_CANCELLED],
      ['typing 2', (customer) => customer.say('2'), texts.ORDER_CANCELLED],
      ['the Cancel button', (customer) => customer.tap('CANCEL_ORDER'), texts.ORDER_CANCELLED],
      ['typing menu', (customer) => customer.say('menu'), WELCOME_TEXT],
      ['the Menu quick reply', (customer) => customer.quickReply(MENU_PAYLOAD, 'Menu'), WELCOME_TEXT],
    ];

    for (const [name, exit, expectedText] of exits) {
      it(`${name} resets the conversation and creates no order`, async () => {
        const customer = newCustomer();
        const { draftId } = await reachSummary(customer);

        assert.deepEqual(textsOf(await exit(customer)), [expectedText]);
        assert.deepEqual(await ordersOf(customer.psid), []);
        assert.equal(orderStore.size(), 0);

        // The conversation is back at the start: a plain 1 shows the products...
        const [carousel] = await customer.say('1');
        assert.equal(templateOf(carousel).template_type, 'generic');
        // ...and the old Confirm button no longer does anything.
        assert.deepEqual(textsOf(await customer.tap(confirmOrderPayload(draftId))), [texts.CONFIRM_STALE]);
        assert.equal(orderStore.size(), 0);
      });
    }

    it('the cancelled order text contains the welcome menu', async () => {
      assert.ok(texts.ORDER_CANCELLED.includes(WELCOME_TEXT));
    });
  });

  // ---------- 17-19: several customers, loops, ordering ----------

  describe('several customers and ordering', () => {
    it('two interleaved customers never mix drafts or orders', async () => {
      const alice = newCustomer();
      const bob = newCustomer();
      const bobPhone = '01987654321';
      const bobAddress = 'Flat 4C, Market Road, Mirzapur, Tangail';

      await Promise.all([alice.tap(orderProductPayload(FIRST.id)), bob.tap(orderProductPayload(SECOND.id))]);
      await Promise.all([alice.say('2'), bob.say('5')]);
      await Promise.all([alice.say(PHONE_INPUT), bob.say(bobPhone)]);
      const [[aliceSummary], [bobSummary]] = await Promise.all([alice.say(ADDRESS), bob.say(bobAddress)]);

      const aliceText = templateOf(aliceSummary).text;
      const bobText = templateOf(bobSummary).text;
      assert.ok(aliceText.includes(FIRST.name) && aliceText.includes('Quantity: 2') && aliceText.includes(PHONE));
      assert.ok(bobText.includes(SECOND.name) && bobText.includes('Quantity: 5') && bobText.includes(bobPhone));
      assert.ok(!aliceText.includes(bobPhone) && !aliceText.includes('Mirzapur'));
      assert.ok(!bobText.includes(PHONE) && !bobText.includes('Hidden Lane'));

      const draft = (summary) => templateOf(summary).buttons[0].payload;
      assert.notEqual(draft(aliceSummary), draft(bobSummary));
      await Promise.all([alice.tap(draft(aliceSummary)), bob.tap(draft(bobSummary))]);

      const [aliceOrder, ...aliceRest] = await ordersOf(alice.psid);
      const [bobOrder, ...bobRest] = await ordersOf(bob.psid);
      assert.equal(aliceRest.length + bobRest.length, 0);
      assert.notEqual(aliceOrder.id, bobOrder.id);
      assert.deepEqual(
        [aliceOrder.productId, aliceOrder.quantity, aliceOrder.phone, aliceOrder.address],
        [FIRST.id, 2, PHONE, ADDRESS],
      );
      assert.deepEqual(
        [bobOrder.productId, bobOrder.quantity, bobOrder.phone, bobOrder.address],
        [SECOND.id, 5, bobPhone, bobAddress],
      );
      assert.equal((await adminApi()).json.count, 2);

      // "My Order Information" lists only the customer's own orders
      const [aliceInfo] = await alice.say('2');
      assert.ok(aliceInfo.message.text.includes(aliceOrder.id));
      assert.ok(!aliceInfo.message.text.includes(bobOrder.id));
      const [bobInfo] = await bob.say('2');
      assert.ok(bobInfo.message.text.includes(bobOrder.id));
      assert.ok(!bobInfo.message.text.includes(aliceOrder.id));
    });

    it('one customer cancelling does not disturb another customer\'s draft', async () => {
      const alice = newCustomer();
      const bob = newCustomer();
      const { draftId } = await reachSummary(bob);
      await alice.say('cancel');

      await bob.tap(confirmOrderPayload(draftId));
      assert.equal((await ordersOf(bob.psid)).length, 1);
      assert.equal((await ordersOf(alice.psid)).length, 0);
    });

    it('a Confirm button of one customer does nothing for another customer', async () => {
      const alice = newCustomer();
      const mallory = newCustomer();
      const { draftId } = await reachSummary(alice);
      await alice.tap(confirmOrderPayload(draftId));

      assert.deepEqual(textsOf(await mallory.tap(confirmOrderPayload(draftId))), [texts.CONFIRM_STALE]);
      assert.equal((await ordersOf(mallory.psid)).length, 0);
    });

    it('echoes and the Page\'s own messages never produce a reply', async () => {
      const customer = newCustomer();
      const echoOf = (text, sender, recipient) => ({
        sender: { id: sender },
        recipient: { id: recipient },
        timestamp: Date.now(),
        message: { mid: `m_echo_${(counter += 1)}`, is_echo: true, app_id: 123456, text },
      });

      // what Meta really sends: the Page is the sender of its own message
      const fromPage = await postSigned(payloadFor([echoOf('Hello from the Page', PAGE_ID, customer.psid)]));
      // the unusual variants: an echo flag with the customer as sender, a message from the Page without the flag
      const flagged = await postSigned(payloadFor([echoOf('Hello', customer.psid, PAGE_ID)]));
      const pageSender = await postSigned(
        payloadFor([{ ...customer.textEvent('hi'), sender: { id: PAGE_ID }, recipient: { id: customer.psid } }]),
      );
      for (const res of [fromPage, flagged, pageSender]) assert.equal(res.status, 200);

      await assertNothingSentSince(0);
      assert.deepEqual(
        logged('[Messenger] Ignored event').map((data) => data.reason),
        ['self_sender', 'echo', 'self_sender'],
      );
    });

    it('the echo of every reply the bot sent is ignored, so there is no reply loop', async () => {
      const customer = newCustomer();
      await customer.say('1'); // two messages: carousel and navigation
      await customer.say('hi');
      const sent = bodiesTo(customer.psid);
      assert.equal(sent.length, 3);

      const echoes = sent.map((body, index) => ({
        sender: { id: PAGE_ID },
        recipient: { id: customer.psid },
        timestamp: Date.now(),
        message: { mid: `m_loop_${index}_${counter}`, is_echo: true, app_id: 1, text: body.message.text },
      }));
      const callsBefore = graphCalls.length;
      assert.equal((await postSigned(payloadFor(echoes))).status, 200);

      await assertNothingSentSince(callsBefore);
    });

    it('several events of one customer in one delivery are processed in order, even when the first Graph call is slow', async () => {
      const slow = newCustomer();
      const fast = newCustomer();
      const held = [];
      graphHandler = (call) =>
        call.body.recipient.id === slow.psid && held.length === 0
          ? new Promise((resolve) => held.push(() => resolve(okResponse(call))))
          : okResponse(call);

      try {
        const batch = [
          slow.postbackEvent(orderProductPayload(FIRST.id)),
          slow.textEvent('3'),
          slow.textEvent(PHONE_INPUT),
        ];
        const res = await postSigned(payloadFor(batch));
        assert.equal(res.status, 200);
        await waitFor(() => held.length === 1, 'the slow Graph call');

        // Another customer is served completely while the first customer's first reply is stuck...
        assert.deepEqual(textsOf(await fast.say('hi')), [WELCOME_TEXT]);
        // ...and the stuck customer's later events have not even started.
        assert.equal(bodiesTo(slow.psid).length, 1);

        held[0]();
        await waitFor(() => settledReplies(slow.psid) === 3, 'the three answers');
        assert.deepEqual(textsOf(bodiesTo(slow.psid)), [texts.orderStart(FIRST), texts.ASK_PHONE, texts.ASK_ADDRESS]);
      } finally {
        held.forEach((release) => release());
      }
    });

    it('a failed first reply of a customer does not block the next event of that customer', async () => {
      const customer = newCustomer();
      let failed = false;
      graphHandler = (call) => {
        if (!failed) {
          failed = true;
          return graphErrorResponse({ message: 'temporary', type: 'OAuthException', code: 2, fbtrace_id: 'T1' }, 500);
        }
        return okResponse(call);
      };

      const bodies = await customer.deliver([customer.textEvent('hi'), customer.textEvent('3')], 2);

      assert.deepEqual(textsOf(bodies), [WELCOME_TEXT, texts.SUPPORT]);
      assert.equal(logged('[SendAPI] Reply failed').length, 1);
      assert.equal(logged('[SendAPI] Reply sent successfully').length, 1);
    });
  });

  // ---------- 20: failures ----------

  describe('failures', () => {
    it('a bad signature gets 403 and no Graph call, a missing one too', async () => {
      const customer = newCustomer();
      const body = JSON.stringify(payloadFor([customer.textEvent('1')]));
      const wrong = `sha256=${crypto.createHmac('sha256', 'another-secret').update(body).digest('hex')}`;

      assert.equal((await postRaw(body, wrong)).status, 403);
      assert.equal((await postRaw(body, 'sha256=not-hex')).status, 403);
      assert.equal((await postRaw(body)).status, 403);
      assert.equal(graphCalls.length, 0);
      await assertNothingSentSince(0);
      assert.equal(sessionStore.size(), 0, 'the unsigned "1" would have opened the catalog');
    });

    it('an unsigned order postback cannot create or confirm anything', async () => {
      const customer = newCustomer();
      const { draftId } = await reachSummary(customer);
      const callsBefore = graphCalls.length;
      const body = JSON.stringify(payloadFor([customer.postbackEvent(confirmOrderPayload(draftId))]));

      assert.equal((await postRaw(body, `sha256=${'0'.repeat(64)}`)).status, 403);
      await assertNothingSentSince(callsBefore);
      assert.equal(orderStore.size(), 0);
    });

    it('a rejected carousel template (code 100) falls back to a text list and the flow continues', async () => {
      const customer = newCustomer();
      graphHandler = (call) =>
        call.body.message.attachment
          ? graphErrorResponse({ message: 'Invalid image url', type: 'OAuthException', code: 100, fbtrace_id: 'T100' })
          : okResponse(call);

      const bodies = await customer.say('1');

      assert.equal(bodies.length, 2);
      assert.equal(templateOf(bodies[0]).template_type, 'generic');
      assert.equal(bodies[1].message.text, texts.catalogFallback(PAGE_1.items, 1, PAGE_1.totalPages));
      assert.ok(bodies[1].message.text.includes(FIRST.id));
      assert.ok(bodies[1].message.text.includes(`৳${FIRST.price}`));
      assert.deepEqual(quickReplyPayloads(bodies[1]), [catalogPagePayload(2), MENU_PAYLOAD]);
      assert.deepEqual(logged('[SendAPI] Catalog template failed, text fallback used'), [
        { reason: 'graph_error', hint: 'invalid_parameter', code: 100 },
      ]);
      assert.deepEqual(logged('[SendAPI] Reply sent successfully').map((data) => data.mode), ['text_fallback']);

      // The customer picks a product by its code from the text list and finishes an order.
      assert.deepEqual(textsOf(await customer.say(FIRST.id.toLowerCase())), [texts.orderStart(FIRST)]);
      assert.deepEqual(textsOf(await customer.say('1')), [texts.ASK_PHONE]);
      assert.deepEqual(textsOf(await customer.say(PHONE_INPUT)), [texts.ASK_ADDRESS]);
    });

    it('a rejected order summary template (code 100) falls back to plain text and the order can still be confirmed', async () => {
      const customer = newCustomer();
      await customer.tap(orderProductPayload(FIRST.id));
      await customer.say('1');
      await customer.say(PHONE_INPUT);
      graphHandler = (call) =>
        call.body.message.attachment
          ? graphErrorResponse({ message: 'bad template', type: 'OAuthException', code: 100, fbtrace_id: 'T101' })
          : okResponse(call);

      const bodies = await customer.say(ADDRESS);

      assert.equal(bodies.length, 2);
      assert.equal(
        bodies[1].message.text,
        texts.orderSummary({
          name: FIRST.name,
          quantity: 1,
          unitPrice: FIRST.price,
          subtotal: FIRST.price,
          phone: PHONE,
          address: ADDRESS,
        }),
      );
      assert.ok(bodies[1].message.text.includes('2. Cancel'));
      assert.deepEqual(logged('[SendAPI] Order summary template failed, text fallback used'), [
        { reason: 'graph_error', hint: 'invalid_parameter', code: 100 },
      ]);

      // The text version asks for 1 or 2, which the conversation understands.
      graphHandler = okResponse;
      const [confirmed] = await customer.say('1');
      assert.ok(confirmed.message.text.includes('Order ID: ORD-'));
      assert.equal((await ordersOf(customer.psid)).length, 1);
    });

    it('Graph error 190 is logged as a failure, nothing else is sent, the webhook stays 200 and the server keeps working', async () => {
      const customer = newCustomer();
      graphHandler = () =>
        graphErrorResponse({
          message: `Invalid OAuth access token ${ACCESS_TOKEN}`,
          type: 'OAuthException',
          code: 190,
          fbtrace_id: 'T190',
        });

      const failed = await customer.say('1'); // deliver() asserts the 200 EVENT_RECEIVED acknowledgement
      assert.equal(failed.length, 1, 'no text fallback and no navigation message after a 190');
      const [failure] = logged('[SendAPI] Reply failed');
      assert.equal(failure.senderId, maskedPsid(customer.psid));
      assert.equal(failure.rule, 'catalog');
      assert.equal(failure.reason, 'graph_error');
      assert.equal(failure.code, 190);
      assert.equal(failure.hint, 'invalid_access_token');
      assert.equal(consoleEntries.find((entry) => entry.tag === '[SendAPI] Reply failed').level, 'error');
      assert.equal(logged('[SendAPI] Reply sent successfully').length, 0);

      graphHandler = okResponse;
      assert.deepEqual(textsOf(await customer.say('hi')), [WELCOME_TEXT]);
      assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    });

    it('a network error while sending is logged and the next message is still answered', async () => {
      const customer = newCustomer();
      graphHandler = () => Promise.reject(new TypeError(`fetch failed (${ACCESS_TOKEN})`));

      await customer.say('hi');
      assert.equal(logged('[SendAPI] Reply failed')[0].reason, 'network');

      graphHandler = okResponse;
      assert.deepEqual(textsOf(await customer.say('hi')), [WELCOME_TEXT]);
    });

    it('with ENABLE_AUTO_REPLY off the webhook answers 200 and nothing is sent or stored', async () => {
      process.env.ENABLE_AUTO_REPLY = 'false';
      const customer = newCustomer();
      const res = await postSigned(payloadFor([customer.textEvent('1')]));
      assert.equal(res.status, 200);

      process.env.ENABLE_AUTO_REPLY = 'true';
      await assertNothingSentSince(0);
      assert.equal(sessionStore.size(), 0, 'the ignored "1" would have opened the catalog');
    });

    it('an attachment gets the attachment text and leaves the order draft alone', async () => {
      const customer = newCustomer();
      await customer.tap(orderProductPayload(FIRST.id));
      await customer.say('2');

      const photo = {
        ...customer.textEvent('ignored'),
        message: { mid: `m_photo_${(counter += 1)}`, attachments: [{ type: 'image', payload: { url: 'https://cdn.example.test/p.jpg' } }] },
      };
      const [reply] = await customer.deliver([photo]);
      assert.equal(reply.message.text, texts.ATTACHMENT);
      assert.ok(graphCalls.every((call) => !call.url.includes('cdn.example.test')));

      // still waiting for the phone number
      assert.deepEqual(textsOf(await customer.say(PHONE_INPUT)), [texts.ASK_ADDRESS]);
    });
  });

  // ---------- log hygiene over a whole conversation ----------

  describe('log hygiene', () => {
    it('a whole conversation logs no phone number, address, message text, token, admin key or full PSID', async () => {
      const customer = newCustomer();
      const freeText = 'do you deliver to Kolkata by Friday?';

      await customer.say('Hi');
      await customer.say(freeText);
      await customer.say('1');
      await customer.quickReply(catalogPagePayload(2), 'Next ▶');
      const { draftId } = await reachSummary(customer);
      await customer.say('not sure');
      await customer.tap(confirmOrderPayload(draftId));
      await customer.tap(confirmOrderPayload(draftId));
      await customer.say('2');

      // admin API traffic with the key, and a failing send whose Graph error quotes the token
      const [order] = await ordersOf(customer.psid);
      await adminApi(`/${order.id}/status`, { method: 'PATCH', body: { status: 'confirmed' } });
      await adminApi('', { key: 'wrong-key' });
      graphHandler = () =>
        graphErrorResponse({
          message: `Invalid OAuth access token ${ACCESS_TOKEN}; user ${customer.psid}`,
          type: 'OAuthException',
          code: 190,
          fbtrace_id: 'T190',
        });
      await customer.say('hello');

      assert.ok(consoleEntries.length > 0);
      const output = consoleEntries.map((entry) => entry.text).join('\n');
      const forbidden = {
        'phone number (typed)': PHONE_INPUT,
        'phone number (normalized)': PHONE,
        'phone number (digits only)': '1712345678',
        address: ADDRESS,
        'address part': 'Hidden Lane',
        'free customer text': freeText,
        'customer text': 'not sure',
        'access token': ACCESS_TOKEN,
        'admin key': ADMIN_KEY,
        'app secret': APP_SECRET,
        'full PSID': customer.psid,
        'draft id': draftId,
        'product payload': orderProductPayload(FIRST.id),
        'confirm payload': confirmOrderPayload(draftId),
        'page payload': catalogPagePayload(2),
        'a reply text': 'স্বাগতম',
        'the order summary': 'Delivery charge',
      };
      for (const [what, value] of Object.entries(forbidden)) {
        assert.ok(!output.includes(value), `the console output contains the ${what}`);
      }

      // what IS logged: ids, counts and rule names
      assert.deepEqual(logged('[Order] Order created'), [
        { orderId: order.id, productId: FIRST.id, quantity: 2, subtotal: FIRST.price * 2 },
      ]);
      const incoming = logged('[Messenger] Incoming customer message');
      assert.ok(incoming.every((data) => data.senderId === maskedPsid(customer.psid)));
      assert.ok(incoming.some((data) => data.kind === 'postback' && data.payloadType === 'CONFIRM_ORDER'));
      assert.ok(incoming.some((data) => data.kind === 'quick_reply' && data.payloadType === 'CATALOG_PAGE'));
    });
  });
});
