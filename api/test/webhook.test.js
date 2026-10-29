import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { inspect } from 'node:util';
import express from 'express';
import { orderProductPayload, quickRepliesFor, textsFor } from 'orderpilot-messenger-bot';
import { SHOP_NAME, bot } from '../src/bot.js';
import { errorHandler } from '../src/middleware/errors.js';

// The bot's own stores and texts (Bangla, with this shop's name).
const { orders: orderStore, preferences: preferenceStore, sessions: sessionStore } = bot;
const texts = textsFor('bn', SHOP_NAME);
const quick = quickRepliesFor('bn');
const PAGE_1 = await bot.catalog.getCatalogPage(1);

// Integration test: the REAL webhook (the orderpilot package's signature check, parsing,
// auto-reply service and Send API client, as src/bot.js sets it up) on a tiny Express app. Only calls to graph.facebook.com
// are mocked; the test's own requests to 127.0.0.1 go through the real fetch.

const VERIFY_TOKEN = 'TEST_VERIFY_TOKEN';
const APP_SECRET = 'TEST_APP_SECRET';
const ACCESS_TOKEN = 'TEST_TOKEN_DO_NOT_LEAK';
const PAGE_ID = '1234567890';
const PSID = '1111111111';
const CANARY_PSID = '9999999999';
const GRAPH_URL = `https://graph.facebook.com/v26.0/${PAGE_ID}/messages`;

const ENV_DEFAULTS = {
  META_VERIFY_TOKEN: VERIFY_TOKEN,
  META_APP_SECRET: APP_SECRET,
  PAGE_ACCESS_TOKEN: ACCESS_TOKEN,
  FACEBOOK_PAGE_ID: PAGE_ID,
  META_GRAPH_API_VERSION: 'v26.0',
  ENABLE_AUTO_REPLY: 'true',
  DETECT_LANGUAGE: 'false', // language detection has its own tests
};

// The welcome menu written out independently of replyTexts.js, so a typo there is caught.
const WELCOME_TEXT = `স্বাগতম! 🛍️

Tangail Botiques-এ আপনাকে স্বাগতম।

আমাদের পণ্য দেখতে অথবা অর্ডার করতে নিচের অপশন নির্বাচন করুন।

1. 🛍️ পণ্য দেখুন
2. 📦 আমার অর্ডারের তথ্য
3. 👨‍💼 সহায়তা`;

const realFetch = globalThis.fetch;
const events = new EventEmitter();

let baseUrl;
let server;
let savedEnv;
let graphCalls;
let graphHandler;
let consoleLines;
let unhandledRejections;
let midCounter = 0;

const onUnhandledRejection = (reason) => unhandledRejections.push(reason);

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

const okResponse = (recipientId = PSID) =>
  new Response(JSON.stringify({ recipient_id: recipientId, message_id: 'm_graph_ok' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

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
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    mock.method(console, method, (...args) => {
      consoleLines.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg))).join(' '));
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

const postSigned = (payload) => {
  const body = JSON.stringify(payload);
  return postRaw(body, sign(body));
};

const nextMid = () => `m_test_${process.pid}_${(midCounter += 1)}`;

function messageEvent({ senderId = PSID, recipientId = PAGE_ID, mid = nextMid(), text = 'hello', message = {} } = {}) {
  return {
    sender: { id: senderId },
    recipient: { id: recipientId },
    timestamp: 1700000000000,
    message: { mid, text, ...message },
  };
}

function postbackEvent({ senderId = PSID, payload = 'GET_STARTED', postback = {} } = {}) {
  return {
    sender: { id: senderId },
    recipient: { id: PAGE_ID },
    timestamp: 1700000000000,
    postback: { mid: nextMid(), title: 'Get Started', payload, ...postback },
  };
}

// Referrals carry no mid, so every one gets its own timestamp to stay clear of the dedupe cache.
function referralEvent({ ref, timestamp = 1700000000000 + (midCounter += 1) } = {}) {
  return {
    sender: { id: PSID },
    recipient: { id: PAGE_ID },
    timestamp,
    referral: { ref, source: 'SHORTLINK', type: 'OPEN_THREAD' },
  };
}

function withoutMessageField(event, field) {
  delete event.message[field];
  return event;
}

const payloadFor = (event, entryId = PAGE_ID) => ({
  object: 'page',
  entry: [{ id: entryId, time: 1700000000000, messaging: [event] }],
});

const isCanary = (call) => call.body?.recipient?.id === CANARY_PSID;

// Proves earlier events were fully handled without sleeping: a follow-up message
// from a different customer must be answered, and then nothing else may have been sent.
async function flush() {
  const previous = process.env.ENABLE_AUTO_REPLY;
  process.env.ENABLE_AUTO_REPLY = 'true';
  try {
    const res = await postSigned(payloadFor(messageEvent({ senderId: CANARY_PSID, text: 'hi' })));
    assert.equal(res.status, 200);
    await waitFor(() => graphCalls.some(isCanary), 'the canary reply');
  } finally {
    if (previous === undefined) delete process.env.ENABLE_AUTO_REPLY;
    else process.env.ENABLE_AUTO_REPLY = previous;
  }
  return graphCalls.filter((call) => !isCanary(call));
}

const loggedText = () => consoleLines.join('\n');

function assertNothingLeaked(...secrets) {
  const output = loggedText();
  for (const secret of secrets) {
    assert.ok(!output.includes(secret), 'a secret or message text appeared in the console output');
  }
}

describe('Facebook webhook with automatic replies', () => {
  before(async () => {
    const app = express();
    app.use('/api/webhooks/facebook', bot.webhook);
    app.use(errorHandler);
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
    consoleLines = [];
    unhandledRejections = [];
    graphHandler = (call) => okResponse(call.body.recipient.id);
    sessionStore.clear();
    preferenceStore.clear();
    orderStore.clear();
    process.on('unhandledRejection', onUnhandledRejection);
    installFetchMock();
    installConsoleCapture();
  });

  afterEach(() => {
    mock.restoreAll();
    process.off('unhandledRejection', onUnhandledRejection);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('verification (GET)', () => {
    const verify = (query) => fetch(`${baseUrl}/api/webhooks/facebook?${new URLSearchParams(query)}`);

    it('echoes the challenge when the verify token matches', async () => {
      const res = await verify({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'CHALLENGE_123',
      });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'CHALLENGE_123');
    });

    it('rejects a wrong token and a wrong mode with 403', async () => {
      const wrongToken = await verify({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'nope',
        'hub.challenge': 'CHALLENGE_123',
      });
      assert.equal(wrongToken.status, 403);
      const wrongMode = await verify({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'CHALLENGE_123',
      });
      assert.equal(wrongMode.status, 403);
      assert.equal(graphCalls.length, 0);
    });
  });

  describe('signature check (POST)', () => {
    const body = () => JSON.stringify(payloadFor(messageEvent()));

    it('rejects a missing signature with 403 and sends nothing', async () => {
      const res = await postRaw(body());
      assert.equal(res.status, 403);
      assert.equal(graphCalls.length, 0);
    });

    it('rejects a bad or malformed signature with 403 and sends nothing', async () => {
      const wrongSecret = `sha256=${crypto.createHmac('sha256', 'other-secret').update(body()).digest('hex')}`;
      assert.equal((await postRaw(body(), wrongSecret)).status, 403);
      assert.equal((await postRaw(body(), 'sha256=not-hex')).status, 403);
      assert.equal((await postRaw(body(), sign('{"some":"other body"}'))).status, 403);
      assert.equal(graphCalls.length, 0);
    });
  });

  describe('automatic reply', () => {
    it('acknowledges with 200 and sends exactly one Send API request', async () => {
      const res = await postSigned(payloadFor(messageEvent({ text: 'hello' })));
      assert.equal(res.status, 200);
      assert.equal(res.text, 'EVENT_RECEIVED');

      await waitFor(() => graphCalls.length >= 1, 'the Graph call');
      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
      assert.equal(graphCalls.length, 1);

      const [call] = graphCalls;
      assert.equal(call.url, GRAPH_URL);
      assert.equal(call.method, 'POST');
      assert.equal(call.headers.get('authorization'), `Bearer ${ACCESS_TOKEN}`);
      assert.match(call.headers.get('content-type'), /^application\/json/);
      assert.ok(!call.url.includes(ACCESS_TOKEN), 'token must not be part of the URL');
      assert.deepEqual(call.body, {
        recipient: { id: PSID },
        messaging_type: 'RESPONSE',
        message: {
          text: WELCOME_TEXT,
          quick_replies: quick.MENU.map(({ title, payload }) => ({ content_type: 'text', title, payload })),
        },
      });
      assert.equal(texts.WELCOME, WELCOME_TEXT);
      assertNothingLeaked(ACCESS_TOKEN);
    });

    it('does not delay the 200 when the Graph API never answers', async () => {
      let release;
      graphHandler = () => new Promise((resolve) => (release = () => resolve(okResponse())));

      // postSigned only resolves if the route acknowledged without waiting for the Graph call.
      const res = await postSigned(payloadFor(messageEvent()));
      assert.equal(res.status, 200);
      assert.equal(res.text, 'EVENT_RECEIVED');

      await waitFor(() => graphCalls.length === 1, 'the pending Graph call');
      assert.equal(typeof release, 'function');
      release();
      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
    });

    it('answers a signed body that is delivered twice only once', async () => {
      const body = JSON.stringify(payloadFor(messageEvent()));
      const signature = sign(body);

      assert.equal((await postRaw(body, signature)).status, 200);
      await waitFor(() => graphCalls.length === 1, 'the first Graph call');
      assert.equal((await postRaw(body, signature)).status, 200);

      assert.equal((await flush()).length, 1);
    });

    it('never logs the access token or the customer message text', async () => {
      const text = 'private-customer-note-4711';
      const res = await postSigned(payloadFor(messageEvent({ text })));
      assert.equal(res.status, 200);
      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
      assertNothingLeaked(ACCESS_TOKEN, text);
    });
  });

  describe('events that must not be answered', () => {
    const cases = {
      'echo of the Page’s own message': () => payloadFor(messageEvent({ message: { is_echo: true } })),
      'message whose sender is the Page itself': () => payloadFor(messageEvent({ senderId: PAGE_ID })),
      'entry for a different Page': () => payloadFor(messageEvent(), '9876543210'),
      'event addressed to a different recipient': () => payloadFor(messageEvent({ recipientId: '9876543210' })),
      'message without a mid': () => payloadFor(withoutMessageField(messageEvent(), 'mid')),
      'message without text or attachments': () => payloadFor(withoutMessageField(messageEvent(), 'text')),
      'delivery receipt': () =>
        payloadFor({
          sender: { id: PSID },
          recipient: { id: PAGE_ID },
          timestamp: 1700000000000,
          delivery: { mids: [nextMid()], watermark: 1700000000000 },
        }),
      'read receipt': () =>
        payloadFor({
          sender: { id: PSID },
          recipient: { id: PAGE_ID },
          timestamp: 1700000000000,
          read: { watermark: 1700000000000 },
        }),
      'postback without a payload': () =>
        payloadFor(postbackEvent({ postback: { payload: undefined } })),
      'm.me link whose ref is not a product': () => payloadFor(referralEvent({ ref: 'summer_sale' })),
      'm.me link without a ref': () => payloadFor(referralEvent()),
    };

    for (const [name, build] of Object.entries(cases)) {
      it(`returns 200 and sends nothing for: ${name}`, async () => {
        const res = await postSigned(build());
        assert.equal(res.status, 200);
        assert.equal(res.text, 'EVENT_RECEIVED');
        assert.deepEqual(await flush(), []);
      });
    }

    for (const [label, setup] of [
      ['false', () => (process.env.ENABLE_AUTO_REPLY = 'false')],
      ['unset', () => delete process.env.ENABLE_AUTO_REPLY],
    ]) {
      it(`returns 200 and sends nothing when ENABLE_AUTO_REPLY is ${label}`, async () => {
        setup();
        const res = await postSigned(payloadFor(messageEvent()));
        assert.equal(res.status, 200);
        assert.equal(res.text, 'EVENT_RECEIVED');
        assert.deepEqual(await flush(), []);
      });
    }
  });

  describe('postbacks and quick replies', () => {
    const lastText = () => graphCalls.at(-1).body.message.text;

    it('answers the Get Started postback with the welcome menu', async () => {
      const res = await postSigned(payloadFor(postbackEvent({ payload: 'GET_STARTED' })));
      assert.equal(res.status, 200);
      assert.equal(res.text, 'EVENT_RECEIVED');

      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
      assert.equal(graphCalls.length, 1);
      assert.equal(lastText(), WELCOME_TEXT);
      assert.equal(graphCalls[0].body.recipient.id, PSID);
    });

    it('answers an "Order Now" postback with the quantity question', async () => {
      const product = PAGE_1.items[0];
      const res = await postSigned(payloadFor(postbackEvent({ payload: orderProductPayload(product.id) })));
      assert.equal(res.status, 200);

      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
      assert.equal(lastText(), texts.orderStart(product));
      assertNothingLeaked(ACCESS_TOKEN, orderProductPayload(product.id));
    });

    it('answers a product link (m.me ref) with the quantity question of that product', async () => {
      const product = PAGE_1.items[0];
      const ref = orderProductPayload(product.id);
      const res = await postSigned(payloadFor(referralEvent({ ref })));
      assert.equal(res.status, 200);
      assert.equal(res.text, 'EVENT_RECEIVED');

      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
      assert.equal(graphCalls.length, 2);
      assert.deepEqual(graphCalls[0].body.message, { attachment: { type: 'image', payload: { url: product.imageUrl } } });
      assert.equal(lastText(), texts.orderStart(product));
      assert.ok(loggedText().includes('"type":"referral"'));
      assert.ok(loggedText().includes('"hasRef":true'));
      assertNothingLeaked(ACCESS_TOKEN, ref);
    });

    it('starts the linked order when a new customer taps Get Started', async () => {
      const product = PAGE_1.items[1];
      const ref = orderProductPayload(product.id);
      const event = postbackEvent({ postback: { referral: { ref, source: 'SHORTLINK', type: 'OPEN_THREAD' } } });
      const res = await postSigned(payloadFor(event));
      assert.equal(res.status, 200);

      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
      assert.equal(lastText(), texts.orderStart(product));
      assertNothingLeaked(ACCESS_TOKEN, ref);
    });

    it('treats a quick-reply payload as the customer\'s choice, not as its text', async () => {
      const event = messageEvent({ text: 'Menu', message: { quick_reply: { payload: 'MENU' } } });
      const res = await postSigned(payloadFor(event));
      assert.equal(res.status, 200);

      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
      assert.equal(lastText(), WELCOME_TEXT);
    });

    it('answers a signed postback that is delivered twice only once', async () => {
      const body = JSON.stringify(payloadFor(postbackEvent({ payload: 'MENU' })));
      const signature = sign(body);

      assert.equal((await postRaw(body, signature)).status, 200);
      await waitFor(() => graphCalls.length === 1, 'the first Graph call');
      assert.equal((await postRaw(body, signature)).status, 200);

      assert.equal((await flush()).length, 1);
    });

    it('never logs the payload value of a postback', async () => {
      const payload = 'ORDER_PRODUCT:NO_SUCH_PRODUCT_777';
      const res = await postSigned(payloadFor(postbackEvent({ payload })));
      assert.equal(res.status, 200);

      await waitFor(() => loggedText().includes('[SendAPI] Reply sent successfully'), 'the success log');
      assertNothingLeaked(ACCESS_TOKEN, 'NO_SUCH_PRODUCT_777');
    });
  });

  describe('Send API failures', () => {
    it('still answers 200, rejects nothing and leaks nothing when Graph returns an error', async () => {
      const text = 'secret-customer-text-123';
      graphHandler = (call) =>
        isCanary(call)
          ? okResponse(CANARY_PSID)
          : new Response(
              JSON.stringify({
                error: {
                  message: `Invalid OAuth access token ${ACCESS_TOKEN}.`,
                  type: 'OAuthException',
                  code: 190,
                  fbtrace_id: 'TRACE123',
                },
              }),
              { status: 400, headers: { 'content-type': 'application/json' } },
            );

      const res = await postSigned(payloadFor(messageEvent({ text })));
      assert.equal(res.status, 200);
      assert.equal(res.text, 'EVENT_RECEIVED');

      await waitFor(() => graphCalls.length === 1, 'the Graph call');
      await waitFor(() => loggedText().includes('[SendAPI] Reply failed'), 'the failure log');
      await flush();

      assert.deepEqual(unhandledRejections, []);
      assertNothingLeaked(ACCESS_TOKEN, text);
    });

    it('still answers 200 and leaks nothing when the network call fails', async () => {
      const text = 'secret-customer-text-456';
      graphHandler = (call) =>
        isCanary(call)
          ? okResponse(CANARY_PSID)
          : Promise.reject(new TypeError(`fetch failed (${ACCESS_TOKEN})`));

      const res = await postSigned(payloadFor(messageEvent({ text })));
      assert.equal(res.status, 200);
      assert.equal(res.text, 'EVENT_RECEIVED');

      await waitFor(() => graphCalls.length === 1, 'the Graph call');
      await waitFor(() => loggedText().includes('[SendAPI] Reply failed'), 'the failure log');
      await flush();

      assert.deepEqual(unhandledRejections, []);
      assertNothingLeaked(ACCESS_TOKEN, text);
    });
  });
});
