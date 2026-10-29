import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { createOrderPilot, productLink, textsFor } from '../src/index.js';
import { createFakeRedis } from './fixtures/fakeRedis.js';
import { products } from './fixtures/products.js';

// The public API end to end: createOrderPilot() with options only (no environment), its webhook
// on a real node:http server and as a fetch handler, a whole order with the onOrder hook,
// connect() and the Redis option. Only graph.facebook.com is mocked.

const APP_SECRET = 'PKG_APP_SECRET_DO_NOT_LEAK';
const VERIFY_TOKEN = 'PKG_VERIFY_TOKEN';
const TOKEN = 'PKG_PAGE_TOKEN_DO_NOT_LEAK';
const PAGE_ID = '1234567890';
const APP_ID = '5550001112';
const PSID = '2222222222';
const PHONE = '01712345678';
const ADDRESS = 'House 12, Road 3, Tangail Sadar';
const SHOP = 'Test Shop';
const ENV_KEYS = [
  'PAGE_ACCESS_TOKEN',
  'FACEBOOK_PAGE_ID',
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'META_GRAPH_API_VERSION',
  'FACEBOOK_APP_ID',
  'WEBHOOK_URL',
  'SHOP_NAME',
  'DETECT_LANGUAGE',
];

const OPTIONS = {
  pageAccessToken: TOKEN,
  pageId: PAGE_ID,
  appSecret: APP_SECRET,
  verifyToken: VERIFY_TOKEN,
  detectLanguage: false,
  shopName: SHOP,
  products,
};

const realFetch = globalThis.fetch;
let graphCalls;
let graphReply;
let logs;
let savedEnv;
let bots;
let counter = 0;

const sign = (body) => `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
const nextMid = () => `m_pkg_${(counter += 1)}`;

function makeBot(extra = {}) {
  const bot = createOrderPilot({ ...OPTIONS, ...extra });
  bots.push(bot);
  return bot;
}

const event = (body) => ({ sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 1700000000000 + counter, ...body });
const textEvent = (text) => event({ message: { mid: nextMid(), text } });
const quickReplyEvent = (payload) => event({ message: { mid: nextMid(), text: 'button', quick_reply: { payload } } });
const payloadOf = (...events) => ({ object: 'page', entry: [{ id: PAGE_ID, time: 1700000000000, messaging: events }] });

const sentMessages = () => graphCalls.filter((call) => call.url.endsWith('/messages')).map((call) => call.body.message);
const lastQuickReplies = () => sentMessages().at(-1).quick_replies.map((item) => item.payload);

// Takes the customer from choosing P001 to the confirmed order through processEntries.
async function orderP001(bot) {
  await bot.processEntries(payloadOf(event({ postback: { mid: nextMid(), payload: 'ORDER_PRODUCT:P001' } })).entry);
  await bot.processEntries(payloadOf(textEvent('2')).entry);
  await bot.processEntries(payloadOf(textEvent(PHONE)).entry);
  await bot.processEntries(payloadOf(textEvent(ADDRESS)).entry);
  const confirm = lastQuickReplies().find((payload) => payload.startsWith('CONFIRM_ORDER:'));
  await bot.processEntries(payloadOf(quickReplyEvent(confirm)).entry);
}

function assertNoSecretsLogged() {
  const output = logs.join('\n');
  for (const secret of [TOKEN, APP_SECRET, VERIFY_TOKEN, PHONE, ADDRESS]) {
    assert.ok(!output.includes(secret), 'a secret or customer detail reached the logs');
  }
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  graphCalls = [];
  logs = [];
  bots = [];
  graphReply = (call) => (call.url.endsWith('/messages') ? { recipient_id: PSID, message_id: 'm_ok' } : { success: true });
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
    const call = { url, init, body: init.body ? JSON.parse(init.body) : null };
    graphCalls.push(call);
    const reply = graphReply(call);
    return new Response(JSON.stringify(reply.body ?? reply), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  for (const level of ['log', 'warn', 'error']) {
    mock.method(console, level, (...args) => logs.push(args.map(String).join(' ')));
  }
});

afterEach(() => {
  try {
    assertNoSecretsLogged();
  } finally {
    mock.restoreAll();
    for (const bot of bots) bot.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

describe('createOrderPilot', () => {
  it('checks the stores and hooks it is given', () => {
    assert.throws(() => createOrderPilot(null), TypeError);
    assert.throws(() => createOrderPilot({ orders: {} }), /orders is missing: create, get, listByCustomer, findByIdempotencyKey/);
    assert.throws(() => createOrderPilot({ sessions: { get() {} } }), /sessions is missing: update, reset/);
    assert.throws(() => createOrderPilot({ redis: { get() {} } }), /redis is missing: set/);
    assert.throws(() => createOrderPilot({ onOrder: 'save' }), /onOrder must be a function/);
    assert.throws(() => createOrderPilot({ products: 'P001' }), /products must be an array/);
  });

  it('names missing settings; an option wins over the environment, which is read at call time', () => {
    const bot = makeBot({ pageAccessToken: undefined, appSecret: undefined, verifyToken: undefined });
    assert.deepEqual(bot.checkConfig(), [
      'appSecret (META_APP_SECRET)',
      'verifyToken (META_VERIFY_TOKEN)',
      'pageAccessToken (PAGE_ACCESS_TOKEN)',
    ]);
    process.env.META_APP_SECRET = 'from-env';
    process.env.META_VERIFY_TOKEN = 'from-env';
    process.env.PAGE_ACCESS_TOKEN = 'from-env';
    process.env.FACEBOOK_PAGE_ID = 'not-a-number'; // the pageId option wins
    assert.deepEqual(bot.checkConfig(), []);
    process.env.PAGE_ACCESS_TOKEN = 'replace_with_page_access_token';
    assert.deepEqual(bot.checkConfig(), ['pageAccessToken (PAGE_ACCESS_TOKEN)']);
  });

  it('keeps everything in memory without a store, and says so', () => {
    const bot = makeBot();
    assert.equal(bot.storage, 'memory');
    assert.equal(makeBot({ redis: createFakeRedis() }).storage, 'redis');
  });

  it('autoReply: false receives events but sends nothing', async () => {
    const bot = makeBot({ autoReply: false });
    await bot.processEntries(payloadOf(textEvent('hi')).entry);
    assert.equal(graphCalls.length, 0);
  });

  it('takes the shop name from SHOP_NAME when the option is left out', async () => {
    const bot = makeBot({ shopName: undefined });
    process.env.SHOP_NAME = 'Env Shop';
    await bot.processEntries(payloadOf(textEvent('hi')).entry);
    assert.equal(sentMessages()[0].text, textsFor('bn', 'Env Shop').WELCOME);
  });
});

describe('a whole order', () => {
  it('creates the order, runs onOrder once with it, and confirms', async () => {
    const received = [];
    const bot = makeBot({ onOrder: async (order) => received.push(order) });
    await orderP001(bot);

    assert.equal(received.length, 1);
    const [order] = received;
    assert.equal(order.productId, 'P001');
    assert.equal(order.quantity, 2);
    assert.equal(order.phone, PHONE);
    assert.equal(order.address, ADDRESS);
    assert.equal(order.status, 'pending');
    assert.deepEqual(await bot.orders.get(order.id), order);
    assert.match(sentMessages().at(-1).text, new RegExp(order.id));

    // Changing the hook's copy changes nothing stored.
    order.status = 'cancelled';
    assert.equal((await bot.orders.get(order.id)).status, 'pending');
  });

  it('a failing onOrder is logged without details and the customer is still confirmed', async () => {
    const bot = makeBot({
      onOrder: () => {
        throw new RangeError(`database down for ${PHONE}`);
      },
    });
    await orderP001(bot);

    const [order] = await bot.orders.listByCustomer(PSID);
    assert.ok(order, 'the order is stored anyway');
    assert.ok(logs.some((line) => line.includes('[Order] onOrder failed') && line.includes(order.id) && line.includes('RangeError')));
    assert.match(sentMessages().at(-1).text, new RegExp(order.id));
  });

  it('keeps orders in Redis under the given prefix', async () => {
    const redis = createFakeRedis();
    const bot = makeBot({ redis, redisPrefix: 'shop1:' });
    await orderP001(bot);

    assert.ok(redis.strings.has('shop1:order:ORD-1001'));
    assert.equal(JSON.parse(redis.strings.get('shop1:order:ORD-1001').value).phone, PHONE);
    assert.equal((await bot.orders.list()).length, 1);
  });

  it('works with a Redis client that parses JSON itself (automatic deserialization)', async () => {
    const raw = createFakeRedis();
    const parse = (value) => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    const redis = {
      ...raw,
      get: async (key) => parse(await raw.get(key)),
      mget: async (...keys) => (await raw.mget(...keys)).map(parse),
    };
    const bot = makeBot({ redis });
    await orderP001(bot);

    const [order] = await bot.orders.list();
    assert.equal(order.phone, PHONE);
    assert.equal((await bot.orders.get(order.id)).id, order.id);
  });
});

describe('webhook on node:http', () => {
  let server;
  let baseUrl;
  let bot;

  beforeEach(async () => {
    bot = makeBot();
    server = http.createServer(bot.webhook);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const verify = (query) => realFetch(`${baseUrl}/?${query}`);
  const post = (body, signature = sign(body), contentType = 'application/json') =>
    realFetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': contentType, ...(signature && { 'x-hub-signature-256': signature }) },
      body,
    });

  it('answers the verification request', async () => {
    const ok = await verify(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CH_1`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'CH_1');
    assert.match(ok.headers.get('content-type'), /^text\/plain/);

    assert.equal((await verify('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CH_1')).status, 403);
    assert.equal((await verify(`hub.mode=subscribe&hub.mode=x&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CH`)).status, 403);
    assert.equal((await verify(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}`)).status, 403);
  });

  it('acknowledges a signed delivery, then replies', async () => {
    const res = await post(JSON.stringify(payloadOf(textEvent('hi'))));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'EVENT_RECEIVED');

    for (let tries = 0; graphCalls.length === 0 && tries < 100; tries += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(sentMessages()[0].text, textsFor('bn', SHOP).WELCOME);
    const [call] = graphCalls;
    assert.equal(call.url, `https://graph.facebook.com/v26.0/${PAGE_ID}/messages`);
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
  });

  it('rejects unsigned, tampered, non-JSON and non-page deliveries', async () => {
    const body = JSON.stringify(payloadOf(textEvent('hi')));
    assert.equal((await post(body, null)).status, 403);
    assert.equal((await post(body, sign('{"other":1}'))).status, 403);
    assert.equal((await post(body, sign(body), 'text/plain')).status, 403, 'only application/json bodies are read');
    assert.equal((await post('{nope', sign('{nope'))).status, 400);
    assert.equal((await post('[]', sign('[]'))).status, 400);
    const user = JSON.stringify({ object: 'user', entry: [] });
    assert.equal((await post(user, sign(user))).status, 404);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(graphCalls.length, 0);
  });

  it('allows only GET and POST', async () => {
    const res = await realFetch(baseUrl, { method: 'PUT' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, POST');
  });
});

describe('webhook node adapter details', () => {
  // A request stream and a response that records what was sent.
  function fakeRequest({ body = '', headers = {}, method = 'POST', url = '/' } = {}) {
    const req = Readable.from(body === '' ? [] : [Buffer.from(body)]);
    Object.assign(req, { method, url, headers: { 'content-type': 'application/json', ...headers } });
    return req;
  }
  function fakeResponse() {
    const res = { statusCode: 0, headers: {}, body: null };
    res.setHeader = (name, value) => (res.headers[name.toLowerCase()] = value);
    res.end = (body) => (res.body = body);
    return res;
  }

  it('refuses a body over 1 MB, by its Content-Length or while reading', async () => {
    const bot = makeBot();
    const declared = fakeResponse();
    await bot.webhook(fakeRequest({ headers: { 'content-length': String(2 * 1024 * 1024) } }), declared);
    assert.equal(declared.statusCode, 413);

    const streamed = fakeResponse();
    await bot.webhook(fakeRequest({ body: 'x'.repeat(1024 * 1024 + 1) }), streamed);
    assert.equal(streamed.statusCode, 413);
  });

  it('hands body errors to next() under Express, so its error handler answers', async () => {
    const bot = makeBot();
    let error;
    const req = fakeRequest({ headers: { 'content-length': String(2 * 1024 * 1024) } });
    req.baseUrl = '/webhook';
    await bot.webhook(req, fakeResponse(), (err) => (error = err));
    assert.equal(error.status, 413);
  });

  it('mounted with app.use(), a deeper path or another method goes on to next()', async () => {
    const bot = makeBot();
    let nexts = 0;
    const next = () => (nexts += 1);
    await bot.webhook(Object.assign(fakeRequest({ url: '/other' }), { baseUrl: '/webhook' }), fakeResponse(), next);
    await bot.webhook(Object.assign(fakeRequest({ method: 'DELETE' }), { baseUrl: '/webhook' }), fakeResponse(), next);
    assert.equal(nexts, 2);
  });

  it('a body a parser already read cannot be verified: 403 and a hint in the log', async () => {
    const bot = makeBot();
    const req = fakeRequest();
    req.resume();
    await new Promise((resolve) => req.on('end', resolve));
    req.body = { object: 'page' };
    const res = fakeResponse();
    await bot.webhook(req, res);
    assert.equal(res.statusCode, 403);
    assert.ok(logs.some((line) => line.includes('mount the webhook before any body parser')));
  });

  it('uses a raw Buffer that express.raw() left in req.body', async () => {
    const bot = makeBot();
    const body = JSON.stringify(payloadOf(textEvent('hi')));
    const req = fakeRequest();
    req.body = Buffer.from(body);
    req.headers['x-hub-signature-256'] = sign(body);
    const res = fakeResponse();
    await bot.webhook(req, res);
    assert.equal(res.statusCode, 200);
  });

  it('answers 503 and names the setting when the secrets are missing', async () => {
    const bot = makeBot({ appSecret: undefined, verifyToken: undefined });
    const res = fakeResponse();
    await bot.webhook(fakeRequest({ method: 'GET', url: '/?hub.mode=subscribe' }), res);
    assert.equal(res.statusCode, 503);
    assert.ok(logs.some((line) => line.includes('verifyToken (META_VERIFY_TOKEN) is missing')));
  });
});

describe('fetchHandler', () => {
  const request = (body, { signature = sign(body), contentType = 'application/json', headers = {} } = {}) =>
    new Request('https://shop.example.com/api/webhook', {
      method: 'POST',
      headers: { 'content-type': contentType, ...(signature && { 'x-hub-signature-256': signature }), ...headers },
      body,
    });

  it('verifies like the node adapter', async () => {
    const bot = makeBot();
    const res = await bot.fetchHandler(
      new Request(`https://shop.example.com/api/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=XY`),
    );
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'XY');
  });

  it('without waitUntil, sends the replies before it responds (serverless cannot cut them off)', async () => {
    const bot = makeBot();
    const res = await bot.fetchHandler(request(JSON.stringify(payloadOf(textEvent('hi')))));
    assert.equal(res.status, 200);
    assert.equal(sentMessages().length, 1);
  });

  it('with waitUntil (option or context), responds first and hands it the replies', async () => {
    const kept = [];
    const bot = makeBot({ waitUntil: (promise) => kept.push(promise) });
    const res = await bot.fetchHandler(request(JSON.stringify(payloadOf(textEvent('hi')))));
    assert.equal(res.status, 200);
    assert.equal(kept.length, 1);
    await kept[0];
    assert.equal(sentMessages().length, 1);

    const fromContext = [];
    await bot.fetchHandler(request(JSON.stringify(payloadOf(textEvent('menu')))), { waitUntil: (p) => fromContext.push(p) });
    assert.equal(fromContext.length, 1);
    await fromContext[0];
  });

  it('rejects bad deliveries', async () => {
    const bot = makeBot();
    const body = JSON.stringify(payloadOf(textEvent('hi')));
    assert.equal((await bot.fetchHandler(request(body, { signature: null }))).status, 403);
    assert.equal((await bot.fetchHandler(request(body, { contentType: 'text/plain' }))).status, 403);
    assert.equal((await bot.fetchHandler(request('x'.repeat(1024 * 1024 + 1)))).status, 413);
    const put = await bot.fetchHandler(new Request('https://shop.example.com/api/webhook', { method: 'PUT' }));
    assert.equal(put.status, 405);
    assert.equal(graphCalls.length, 0);
  });
});

describe('connect()', () => {
  const FULL = { appId: APP_ID, webhookUrl: 'https://shop.example.com/webhook/facebook' };

  it('sets the app webhook, subscribes the Page and adds Get Started', async () => {
    const bot = makeBot(FULL);
    const result = await bot.connect();

    assert.deepEqual(result, {
      ok: true,
      steps: [
        { step: 'app_webhook', ok: true },
        { step: 'page_subscription', ok: true },
        { step: 'get_started', ok: true },
      ],
    });
    const [app, page, button] = graphCalls;
    assert.equal(app.url, `https://graph.facebook.com/v26.0/${APP_ID}/subscriptions`);
    assert.equal(app.init.headers.Authorization, `Bearer ${APP_ID}|${APP_SECRET}`);
    assert.deepEqual(app.body, {
      object: 'page',
      callback_url: FULL.webhookUrl,
      verify_token: VERIFY_TOKEN,
      fields: 'messages,messaging_postbacks,messaging_referrals',
      include_values: true,
    });
    assert.equal(page.url, `https://graph.facebook.com/v26.0/${PAGE_ID}/subscribed_apps`);
    assert.equal(page.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(page.body, { subscribed_fields: 'messages,messaging_postbacks,messaging_referrals' });
    assert.equal(button.url, 'https://graph.facebook.com/v26.0/me/messenger_profile');
    assert.deepEqual(button.body, { get_started: { payload: 'GET_STARTED' } });
    for (const call of graphCalls) {
      assert.ok(!call.url.includes(TOKEN) && !call.url.includes(APP_SECRET), 'no secret in a URL');
    }
  });

  it('skips the app webhook when it lacks the app id or URL, and says which', async () => {
    const bot = makeBot();
    const result = await bot.connect({ getStarted: false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps, [
      { step: 'app_webhook', ok: true, skipped: true, missing: ['appId (FACEBOOK_APP_ID)', 'webhookUrl (WEBHOOK_URL)'] },
      { step: 'page_subscription', ok: true },
    ]);
    assert.equal(graphCalls.length, 1);
  });

  it('reads FACEBOOK_APP_ID and WEBHOOK_URL from the environment', async () => {
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.WEBHOOK_URL = FULL.webhookUrl;
    const result = await makeBot().connect();
    assert.equal(result.steps[0].skipped, undefined);
    assert.equal(graphCalls[0].body.callback_url, FULL.webhookUrl);
  });

  it('reports Graph errors per step without secrets, and never throws', async () => {
    graphReply = (call) =>
      call.url.endsWith('/subscribed_apps')
        ? { status: 403, body: { error: { code: 200, message: `token ${TOKEN} lacks pages_manage_metadata`, fbtrace_id: 'T1' } } }
        : { success: true };
    const result = await makeBot(FULL).connect();

    assert.equal(result.ok, false);
    assert.deepEqual(result.steps[1], { step: 'page_subscription', ok: false, reason: 'graph_error', hint: 'permission_denied', code: 200 });
    assert.equal(result.steps[2].ok, true);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });

  it('refuses a webhook URL that is not https, and a Page that is not configured', async () => {
    const result = await makeBot({ ...FULL, webhookUrl: 'http://shop.example.com/hook', pageAccessToken: undefined }).connect();
    assert.equal(result.ok, false);
    assert.equal(result.steps[0].reason, 'invalid_webhook_url');
    assert.deepEqual(result.steps[1], {
      step: 'page_subscription',
      ok: false,
      reason: 'config',
      missing: ['pageAccessToken (PAGE_ACCESS_TOKEN)'],
    });
    assert.equal(graphCalls.length, 0);
  });

  it('accepts the Messenger Profile API answer { result: "success" }', async () => {
    graphReply = (call) => (call.url.endsWith('/messenger_profile') ? { result: 'success' } : { success: true });
    const result = await makeBot().connect();
    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.at(-1), { step: 'get_started', ok: true });
  });

  it('treats an answer without success: true as a failure', async () => {
    graphReply = () => ({ success: false });
    const result = await makeBot().connect({ getStarted: false });
    assert.equal(result.steps[1].reason, 'invalid_response');
    assert.equal(result.ok, false);
  });
});

describe('productLink', () => {
  it('builds the m.me link that starts an order for a product', () => {
    assert.equal(productLink('tangail.botiques', 'P001'), 'https://m.me/tangail.botiques?ref=ORDER_PRODUCT:P001');
    assert.equal(productLink('@myshop', 'SKU 9'), 'https://m.me/myshop?ref=ORDER_PRODUCT:SKU%209');
  });
});
