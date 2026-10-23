import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEND_TIMEOUT_MS,
  sendButtonTemplate,
  sendGenericTemplate,
  sendOrderConfirmation,
  sendPhotoAndText,
  sendProductCatalog,
  sendTextMessage,
} from '../src/services/messengerService.js';

const TOKEN = 'TEST_TOKEN_DO_NOT_LEAK';
const PAGE_ID = '1234567890';
const PSID = '9876543210123';
const ENV_KEYS = ['PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID', 'META_GRAPH_API_VERSION'];

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.PAGE_ACCESS_TOKEN = TOKEN;
  process.env.FACEBOOK_PAGE_ID = PAGE_ID;
  delete process.env.META_GRAPH_API_VERSION;
});

afterEach(() => {
  mock.restoreAll();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const mockFetch = (impl) => mock.method(globalThis, 'fetch', impl);
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const graphError = (code, subcode, message = 'Graph said no') => ({
  error: { message, type: 'OAuthException', code, error_subcode: subcode, fbtrace_id: 'AbCdEf123' },
});
const successBody = { recipient_id: PSID, message_id: 'm_abc123' };

describe('sendTextMessage: request', () => {
  it('posts the official Send API request and returns the message id', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    const result = await sendTextMessage(PSID, 'Hello 🛍️ স্বাগতম');

    assert.deepEqual(result, { ok: true, messageId: 'm_abc123', recipientId: PSID });
    assert.equal(fetchMock.mock.callCount(), 1);
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, 'https://graph.facebook.com/v26.0/1234567890/messages');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    assert.deepEqual(JSON.parse(init.body), {
      recipient: { id: PSID },
      messaging_type: 'RESPONSE',
      message: { text: 'Hello 🛍️ স্বাগতম' },
    });
    assert.ok(init.signal instanceof AbortSignal);
  });

  it('never puts the token in the URL or the body', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendTextMessage(PSID, 'hi');

    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.ok(!url.includes(TOKEN));
    assert.ok(!init.body.includes(TOKEN));
  });

  it('uses the configured timeout', async () => {
    mockFetch(async () => jsonResponse(successBody));
    const timeoutMock = mock.method(AbortSignal, 'timeout', () => new AbortController().signal);

    await sendTextMessage(PSID, 'hi');

    assert.equal(SEND_TIMEOUT_MS, 10_000);
    assert.deepEqual(timeoutMock.mock.calls[0].arguments, [SEND_TIMEOUT_MS]);
  });

  it('defaults to Graph API v26.0 and honours META_GRAPH_API_VERSION', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendTextMessage(PSID, 'hi');
    process.env.META_GRAPH_API_VERSION = 'v25.0';
    await sendTextMessage(PSID, 'hi');

    assert.equal(fetchMock.mock.calls[0].arguments[0], 'https://graph.facebook.com/v26.0/1234567890/messages');
    assert.equal(fetchMock.mock.calls[1].arguments[0], 'https://graph.facebook.com/v25.0/1234567890/messages');
  });

  it('accepts text of exactly 2000 characters', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    const result = await sendTextMessage(PSID, 'a'.repeat(2000));

    assert.equal(result.ok, true);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});

describe('sendTextMessage: Graph errors and hints', () => {
  const cases = [
    ['invalid_access_token', 190, 460],
    ['outside_messaging_window', 10, 2018278],
    ['permission_denied', 10, 2018065],
    ['permission_denied', 10, undefined],
    ['permission_denied', 200, undefined],
    ['invalid_parameter', 100, undefined],
    ['recipient_unavailable', 551, 1545041],
    ['rate_limited', 4, undefined],
    ['rate_limited', 17, undefined],
    ['rate_limited', 32, undefined],
    ['rate_limited', 613, undefined],
    [null, 1, undefined],
    [null, 2, 2018001],
  ];

  for (const [hint, code, subcode] of cases) {
    it(`maps code ${code} / subcode ${subcode ?? 'none'} to ${hint}`, async () => {
      mockFetch(async () => jsonResponse(graphError(code, subcode, 'Something failed'), 400));

      const result = await sendTextMessage(PSID, 'hi');

      assert.deepEqual(result, {
        ok: false,
        reason: 'graph_error',
        status: 400,
        error: {
          code,
          subcode: subcode ?? null,
          type: 'OAuthException',
          fbtraceId: 'AbCdEf123',
          message: 'Something failed',
        },
        hint,
      });
    });
  }

  it('handles an error object with missing fields', async () => {
    mockFetch(async () => jsonResponse({ error: {} }, 400));

    const result = await sendTextMessage(PSID, 'hi');

    assert.deepEqual(result.error, { code: null, subcode: null, type: null, fbtraceId: null, message: null });
    assert.equal(result.reason, 'graph_error');
    assert.equal(result.hint, null);
  });

  it('treats an error object inside a 2xx response as a graph_error', async () => {
    mockFetch(async () => jsonResponse(graphError(190, undefined), 200));

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'graph_error');
    assert.equal(result.status, 200);
    assert.equal(result.hint, 'invalid_access_token');
  });

  it('truncates the error message to 200 characters', async () => {
    mockFetch(async () => jsonResponse(graphError(100, undefined, 'x'.repeat(500)), 400));

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.error.message, 'x'.repeat(200));
  });
});

describe('sendTextMessage: token redaction', () => {
  it('redacts every occurrence of the token echoed by Graph', async () => {
    const message = `Invalid token ${TOKEN} and again ${TOKEN}!`;
    mockFetch(async () => jsonResponse(graphError(190, undefined, message), 400));

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.error.message, 'Invalid token [redacted] and again [redacted]!');
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });

  it('redacts the token before truncating, so no prefix of it survives', async () => {
    const message = `${'x'.repeat(190)}${TOKEN}`;
    mockFetch(async () => jsonResponse(graphError(190, undefined, message), 400));

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.error.message, `${'x'.repeat(190)}[redacted]`);
    assert.equal(result.error.message.length, 200);
    assert.ok(!JSON.stringify(result).includes('TEST_TOKEN'));
  });

  it('redacts the token in the other error fields too', async () => {
    const body = graphError(190, undefined);
    body.error.type = TOKEN;
    body.error.fbtrace_id = `trace-${TOKEN}`;
    mockFetch(async () => jsonResponse(body, 400));

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.error.type, '[redacted]');
    assert.equal(result.error.fbtraceId, 'trace-[redacted]');
  });

  it('does not leak the token from a failing fetch', async () => {
    mockFetch(async () => {
      throw new TypeError(`fetch failed for ${TOKEN}`);
    });

    const result = await sendTextMessage(PSID, 'hi');

    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });

  it('does not leak the token in the success result', async () => {
    mockFetch(async () => jsonResponse(successBody));

    const result = await sendTextMessage(PSID, 'hi');

    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });
});

describe('sendTextMessage: other failures', () => {
  it('returns http_error for a non-2xx response with an HTML body', async () => {
    mockFetch(async () => new Response('<html><body>Bad gateway</body></html>', { status: 500 }));

    const result = await sendTextMessage(PSID, 'hi');

    assert.deepEqual(result, { ok: false, reason: 'http_error', status: 500, error: null, hint: null });
  });

  it('returns http_error for a non-2xx response with an empty body', async () => {
    mockFetch(async () => new Response('', { status: 503 }));

    const result = await sendTextMessage(PSID, 'hi');

    assert.deepEqual(result, { ok: false, reason: 'http_error', status: 503, error: null, hint: null });
  });

  it('returns http_error for a non-2xx response with JSON but no error object', async () => {
    mockFetch(async () => jsonResponse({ message: 'nope' }, 502));

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.reason, 'http_error');
    assert.equal(result.status, 502);
  });

  it('returns invalid_response for a 200 with a non-JSON body', async () => {
    mockFetch(async () => new Response('<html>OK</html>', { status: 200 }));

    const result = await sendTextMessage(PSID, 'hi');

    assert.deepEqual(result, { ok: false, reason: 'invalid_response', status: 200, error: null, hint: null });
  });

  it('returns invalid_response for a 200 with an empty body', async () => {
    mockFetch(async () => new Response('', { status: 200 }));

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.reason, 'invalid_response');
  });

  for (const body of ['null', '[]', '"ok"', '42']) {
    it(`returns invalid_response for a 200 with the JSON body ${body}`, async () => {
      mockFetch(async () => new Response(body, { status: 200 }));

      const result = await sendTextMessage(PSID, 'hi');

      assert.equal(result.reason, 'invalid_response');
    });
  }

  it('reports a 2xx JSON object without message_id as success with messageId null', async () => {
    mockFetch(async () => jsonResponse({ recipient_id: PSID }));

    const result = await sendTextMessage(PSID, 'hi');

    assert.deepEqual(result, { ok: true, messageId: null, recipientId: PSID });
  });

  it('returns timeout when the request times out', async () => {
    mockFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });

    const result = await sendTextMessage(PSID, 'hi');

    assert.deepEqual(result, { ok: false, reason: 'timeout', status: null, error: null, hint: null });
  });

  it('returns timeout for an AbortError', async () => {
    mockFetch(async () => {
      throw new DOMException('This operation was aborted', 'AbortError');
    });

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.reason, 'timeout');
  });

  it('returns timeout when reading the body times out', async () => {
    mockFetch(async () => ({
      status: 200,
      text: async () => {
        throw new DOMException('timed out', 'TimeoutError');
      },
    }));

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.reason, 'timeout');
  });

  it('returns network for other fetch failures', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await sendTextMessage(PSID, 'hi');

    assert.deepEqual(result, { ok: false, reason: 'network', status: null, error: null, hint: null });
  });
});

describe('sendTextMessage: validation before any I/O', () => {
  const invalidInputs = [
    ['empty recipient', '', 'hi'],
    ['non-digit recipient', 'abc123', 'hi'],
    ['recipient with spaces', '123 456', 'hi'],
    ['numeric recipient', 123456, 'hi'],
    ['missing recipient', undefined, 'hi'],
    ['empty text', PSID, ''],
    ['whitespace-only text', PSID, '   \n'],
    ['non-string text', PSID, 42],
    ['missing text', PSID, undefined],
    ['text over 2000 characters', PSID, 'a'.repeat(2001)],
  ];

  for (const [name, recipientId, text] of invalidInputs) {
    it(`rejects ${name} without calling fetch`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      const result = await sendTextMessage(recipientId, text);

      assert.deepEqual(result, { ok: false, reason: 'invalid_input', status: null, error: null, hint: null });
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }

  const badConfigs = [
    ['missing token', { PAGE_ACCESS_TOKEN: undefined }],
    ['placeholder token', { PAGE_ACCESS_TOKEN: 'replace_with_page_access_token' }],
    ['missing page id', { FACEBOOK_PAGE_ID: undefined }],
    ['non-digit page id', { FACEBOOK_PAGE_ID: 'my-page' }],
    ['version without minor part', { META_GRAPH_API_VERSION: 'v26' }],
    ['version without v prefix', { META_GRAPH_API_VERSION: '26.0' }],
    ['version with a path in it', { META_GRAPH_API_VERSION: 'v26.0/../me' }],
  ];

  for (const [name, overrides] of badConfigs) {
    it(`returns config for a ${name} without calling fetch`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }

      const result = await sendTextMessage(PSID, 'hi');

      assert.deepEqual(result, { ok: false, reason: 'config', status: null, error: null, hint: null });
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }
});

describe('sendTextMessage: never rejects', () => {
  it('survives a fetch that throws synchronously', async () => {
    mockFetch(() => {
      throw new Error('boom');
    });

    const result = await sendTextMessage(PSID, 'hi');

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'network');
  });

  const garbage = [
    ['undefined', () => undefined],
    ['null', () => null],
    ['an empty object', () => ({})],
    ['a response whose text() throws', () => ({ status: 200, text: async () => { throw new Error('bad body'); } })],
    ['a response with a non-numeric status', () => ({ status: 'ok', text: async () => '{}' })],
  ];

  for (const [name, makeResponse] of garbage) {
    it(`survives fetch resolving to ${name}`, async () => {
      mockFetch(async () => makeResponse());

      let outcome;
      await assert.doesNotReject(async () => {
        outcome = await sendTextMessage(PSID, 'hi');
      });

      assert.equal(outcome.ok, false);
      assert.equal(typeof outcome.reason, 'string');
      assert.ok(!JSON.stringify(outcome).includes(TOKEN));
    });
  }
});

// ---------- Quick replies, templates and the product catalog ----------

const INVALID_INPUT = { ok: false, reason: 'invalid_input', status: null, error: null, hint: null };
const NAV_TEXT = 'Page nav text';
const FALLBACK_TEXT = 'P001 – Product 1 – ৳1250\nP002 – Product 2 – ৳1500';

// Answers the n-th fetch call with the n-th step; a call beyond the steps rejects, and the
// tests also assert the call count.
const mockFetchSequence = (...steps) => {
  let next = 0;
  return mockFetch(async () => {
    const step = steps[next++];
    if (!step) throw new Error('unexpected extra fetch call');
    return step();
  });
};
const ok = (messageId) => () => jsonResponse({ recipient_id: PSID, message_id: messageId });
const graphFail = (code, status = 400, subcode) => () => jsonResponse(graphError(code, subcode), status);
const throwing = (error) => () => {
  throw error;
};
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
const sentBodies = (fetchMock) => fetchMock.mock.calls.map((call) => JSON.parse(call.arguments[1].body));

// Fixture products (not the real catalog): P001 costs ৳1250, P002 ৳1500, ...
const makeProduct = (n, overrides = {}) => ({
  id: `P00${n}`,
  name: `Product ${n}`,
  description: `Description ${n}`,
  category: 'Saree',
  price: 1000 + n * 250,
  currency: 'BDT',
  imageUrl: `https://cdn.example.com/p${n}.jpg`,
  available: true,
  ...overrides,
});
const makeProducts = (count) => Array.from({ length: count }, (_, i) => makeProduct(i + 1));
const catalogOptions = (overrides = {}) => ({
  products: makeProducts(5),
  page: 1,
  totalPages: 3,
  navText: NAV_TEXT,
  fallbackText: FALLBACK_TEXT,
  ...overrides,
});
const card = (n) => ({
  title: `P00${n} · Product ${n} – ৳${1000 + n * 250}`,
  subtitle: `Description ${n}`,
  image_url: `https://cdn.example.com/p${n}.jpg`,
  buttons: [{ type: 'postback', title: 'Order Now', payload: `ORDER_PRODUCT:P00${n}` }],
});
const carouselBody = (elements) => ({
  recipient: { id: PSID },
  messaging_type: 'RESPONSE',
  message: {
    attachment: {
      type: 'template',
      payload: { template_type: 'generic', image_aspect_ratio: 'square', elements },
    },
  },
});
const textBody = (text, quickReplies) => ({
  recipient: { id: PSID },
  messaging_type: 'RESPONSE',
  message: quickReplies ? { text, quick_replies: quickReplies } : { text },
});
const quickReplyOf = (title, payload) => ({ content_type: 'text', title, payload });
// The "🛒 P001" quick replies the catalog puts before Previous / Next / Menu.
const productQuickReplies = (count = 5) =>
  Array.from({ length: count }, (_, i) => quickReplyOf(`🛒 P00${i + 1}`, `ORDER_PRODUCT:P00${i + 1}`));

const cardInput = (overrides = {}) => ({
  title: 'Silk Saree – ৳1250',
  subtitle: 'Soft silk',
  imageUrl: 'https://cdn.example.com/saree.jpg',
  buttons: [{ title: 'Order Now', payload: 'ORDER_PRODUCT:P001' }],
  ...overrides,
});

// A failed first message after which the text fallback must NOT be tried.
const NO_FALLBACK_CASES = [
  ['a timeout', throwing(timeoutError()), 'timeout', null],
  ['a network error', throwing(new TypeError('fetch failed')), 'network', null],
  ['an invalid access token (190)', graphFail(190), 'graph_error', 'invalid_access_token'],
  ['HTTP 429 with code 613', graphFail(613, 429), 'graph_error', 'rate_limited'],
  ['rate limit code 4', graphFail(4), 'graph_error', 'rate_limited'],
  ['the messaging window (10 / 2018278)', graphFail(10, 400, 2018278), 'graph_error', 'outside_messaging_window'],
  ['an unavailable recipient (551)', graphFail(551), 'graph_error', 'recipient_unavailable'],
  ['a missing permission (200)', graphFail(200), 'graph_error', 'permission_denied'],
  ['a 500 without a Graph error', () => new Response('<html>Bad gateway</html>', { status: 500 }), 'http_error', null],
  ['a non-JSON 200', () => new Response('<html>OK</html>', { status: 200 }), 'invalid_response', null],
];

// A rejected template after which the text fallback IS tried.
const FALLBACK_CASES = [
  ['an invalid parameter (code 100)', graphFail(100), 100, 'invalid_parameter'],
  ['a Graph error without a hint (code 1)', graphFail(1), 1, null],
];

describe('sendTextMessage: quick replies', () => {
  it('sends quick_replies next to the text', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    const result = await sendTextMessage(PSID, 'Pick one', {
      quickReplies: [
        { title: 'Yes', payload: 'YES' },
        { title: 'Menu', payload: 'MENU' },
      ],
    });

    assert.deepEqual(result, { ok: true, messageId: 'm_abc123', recipientId: PSID });
    assert.deepEqual(sentBodies(fetchMock)[0], textBody('Pick one', [quickReplyOf('Yes', 'YES'), quickReplyOf('Menu', 'MENU')]));
  });

  it('sends a phone-number quick reply as Messenger expects it, next to text ones', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendTextMessage(PSID, 'Your phone?', {
      quickReplies: [{ type: 'user_phone_number' }, { title: 'Cancel', payload: 'CANCEL_ORDER' }],
    });

    assert.deepEqual(
      sentBodies(fetchMock)[0],
      textBody('Your phone?', [{ content_type: 'user_phone_number' }, quickReplyOf('Cancel', 'CANCEL_ORDER')]),
    );
  });

  it('rejects any other quick reply type without calling fetch', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    for (const item of [{ type: 'user_email' }, { type: 'location' }, { type: 'user_phone_number ' }]) {
      assert.deepEqual(await sendTextMessage(PSID, 'hi', { quickReplies: [item] }), INVALID_INPUT);
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('sends the plain text body when there are no quick replies', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendTextMessage(PSID, 'hi');
    await sendTextMessage(PSID, 'hi', {});
    await sendTextMessage(PSID, 'hi', null);
    await sendTextMessage(PSID, 'hi', { quickReplies: [] });
    await sendTextMessage(PSID, 'hi', { quickReplies: null });

    for (const body of sentBodies(fetchMock)) assert.deepEqual(body, textBody('hi'));
  });

  it('truncates quick reply titles to 20 characters with an ellipsis', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));
    const exactly20 = 'T'.repeat(20);

    await sendTextMessage(PSID, 'hi', {
      quickReplies: [
        { title: 'Q'.repeat(25), payload: 'A' },
        { title: exactly20, payload: 'B' },
      ],
    });

    const { quick_replies: quickReplies } = sentBodies(fetchMock)[0].message;
    assert.equal(quickReplies[0].title, `${'Q'.repeat(19)}…`);
    assert.equal(quickReplies[1].title, exactly20);
  });

  it('accepts 13 quick replies and rejects 14 before any I/O', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));
    const make = (count) => Array.from({ length: count }, (_, i) => ({ title: `T${i}`, payload: `P${i}` }));

    assert.equal((await sendTextMessage(PSID, 'hi', { quickReplies: make(13) })).ok, true);
    assert.equal(fetchMock.mock.callCount(), 1);

    assert.deepEqual(await sendTextMessage(PSID, 'hi', { quickReplies: make(14) }), INVALID_INPUT);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  const badQuickReplies = [
    ['a non-array', 'YES'],
    ['an item that is null', [null]],
    ['an item without a title', [{ payload: 'A' }]],
    ['an empty title', [{ title: '  ', payload: 'A' }]],
    ['an item without a payload', [{ title: 'A' }]],
    ['a non-string payload', [{ title: 'A', payload: 5 }]],
    ['a payload over 1000 characters', [{ title: 'A', payload: 'p'.repeat(1001) }]],
  ];

  for (const [name, quickReplies] of badQuickReplies) {
    it(`rejects ${name} without calling fetch`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      assert.deepEqual(await sendTextMessage(PSID, 'hi', { quickReplies }), INVALID_INPUT);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }

  it('accepts a payload of exactly 1000 characters', async () => {
    mockFetch(async () => jsonResponse(successBody));

    const result = await sendTextMessage(PSID, 'hi', { quickReplies: [{ title: 'A', payload: 'p'.repeat(1000) }] });

    assert.equal(result.ok, true);
  });
});

describe('sendGenericTemplate', () => {
  it('posts the official generic template payload for 5 product cards', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));
    const elements = makeProducts(5).map((product) => ({
      title: `${product.id} · ${product.name} – ৳${product.price}`,
      subtitle: product.description,
      imageUrl: product.imageUrl,
      buttons: [{ title: 'Order Now', payload: `ORDER_PRODUCT:${product.id}` }],
    }));

    const result = await sendGenericTemplate(PSID, elements);

    assert.deepEqual(result, { ok: true, messageId: 'm_abc123', recipientId: PSID });
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(sentBodies(fetchMock)[0], carouselBody([1, 2, 3, 4, 5].map(card)));
    assert.equal(sentBodies(fetchMock)[0].message.attachment.payload.elements[0].buttons[0].payload, 'ORDER_PRODUCT:P001');
  });

  it('uses the same endpoint and headers as text messages', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendGenericTemplate(PSID, [cardInput()]);

    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, 'https://graph.facebook.com/v26.0/1234567890/messages');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
    assert.ok(init.signal instanceof AbortSignal);
  });

  it('honours imageAspectRatio and rejects unknown ratios', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendGenericTemplate(PSID, [cardInput()], { imageAspectRatio: 'horizontal' });
    assert.equal(sentBodies(fetchMock)[0].message.attachment.payload.image_aspect_ratio, 'horizontal');

    assert.deepEqual(await sendGenericTemplate(PSID, [cardInput()], { imageAspectRatio: 'wide' }), INVALID_INPUT);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('omits subtitle and image_url when they are not given', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendGenericTemplate(PSID, [{ title: 'Only a title', buttons: [{ title: 'Go', payload: 'GO' }] }]);

    assert.deepEqual(sentBodies(fetchMock)[0].message.attachment.payload.elements, [
      { title: 'Only a title', buttons: [{ type: 'postback', title: 'Go', payload: 'GO' }] },
    ]);
  });

  describe('truncation by Unicode code points', () => {
    const sendOne = async (overrides) => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));
      const result = await sendGenericTemplate(PSID, [cardInput(overrides)]);
      assert.equal(result.ok, true);
      return sentBodies(fetchMock)[0].message.attachment.payload.elements[0];
    };

    it('keeps a title and subtitle of exactly 80 characters, cuts 81 to 80 with an ellipsis', async () => {
      const element = await sendOne({ title: 'T'.repeat(80), subtitle: 'S'.repeat(81) });

      assert.equal(element.title, 'T'.repeat(80));
      assert.equal(element.subtitle, `${'S'.repeat(79)}…`);
      assert.equal(Array.from(element.subtitle).length, 80);
    });

    it('never cuts an emoji in half', async () => {
      const element = await sendOne({ title: '😀'.repeat(100), subtitle: '🛍️'.repeat(100) });

      assert.equal(element.title, `${'😀'.repeat(79)}…`);
      assert.equal(Array.from(element.title).length, 80);
      assert.ok(element.title.isWellFormed());
      assert.ok(element.subtitle.isWellFormed());
      assert.equal(Array.from(element.subtitle).length, 80);
    });

    it('cuts a Bangla title on a code point boundary', async () => {
      const bangla = 'বাংলা'.repeat(30); // 150 code points
      const element = await sendOne({ title: bangla });

      assert.equal(element.title, `${Array.from(bangla).slice(0, 79).join('')}…`);
      assert.equal(Array.from(element.title).length, 80);
      assert.ok(element.title.isWellFormed());
    });

    it('truncates button titles to 20 characters', async () => {
      const element = await sendOne({ buttons: [{ title: 'B'.repeat(25), payload: 'GO' }, { title: '😀'.repeat(30), payload: 'GO2' }] });

      assert.equal(element.buttons[0].title, `${'B'.repeat(19)}…`);
      assert.equal(element.buttons[1].title, `${'😀'.repeat(19)}…`);
      assert.equal(element.buttons[1].payload, 'GO2');
    });
  });

  describe('limits and validation (no I/O)', () => {
    const makeCards = (count) => Array.from({ length: count }, () => cardInput());
    const invalid = [
      ['no elements', []],
      ['11 elements', makeCards(11)],
      ['elements that are not an array', cardInput()],
      ['a null element', [null]],
      ['an empty title', [cardInput({ title: '' })]],
      ['a whitespace title', [cardInput({ title: '   ' })]],
      ['a non-string title', [cardInput({ title: 42 })]],
      ['an empty subtitle', [cardInput({ subtitle: '' })]],
      ['an http image url', [cardInput({ imageUrl: 'http://cdn.example.com/a.jpg' })]],
      ['a javascript image url', [cardInput({ imageUrl: 'javascript:alert(1)' })]],
      ['an image url that is not a url', [cardInput({ imageUrl: 'not a url' })]],
      ['a non-string image url', [cardInput({ imageUrl: 5 })]],
      ['no buttons', [cardInput({ buttons: [] })]],
      ['buttons that are missing', [cardInput({ buttons: undefined })]],
      ['4 buttons', [cardInput({ buttons: Array.from({ length: 4 }, (_, i) => ({ title: `B${i}`, payload: `P${i}` })) })]],
      ['a button without a payload', [cardInput({ buttons: [{ title: 'Go' }] })]],
      ['a button with an empty title', [cardInput({ buttons: [{ title: '', payload: 'GO' }] })]],
      ['a button payload over 1000 characters', [cardInput({ buttons: [{ title: 'Go', payload: 'p'.repeat(1001) }] })]],
      ['one bad element among good ones', [cardInput(), cardInput({ title: '' })]],
    ];

    for (const [name, elements] of invalid) {
      it(`rejects ${name}`, async () => {
        const fetchMock = mockFetch(async () => jsonResponse(successBody));

        assert.deepEqual(await sendGenericTemplate(PSID, elements), INVALID_INPUT);
        assert.equal(fetchMock.mock.callCount(), 0);
      });
    }

    it('accepts 10 elements with 3 buttons each', async () => {
      const buttons = [1, 2, 3].map((i) => ({ title: `B${i}`, payload: `P${i}` }));
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      const result = await sendGenericTemplate(PSID, Array.from({ length: 10 }, () => cardInput({ buttons })));

      assert.equal(result.ok, true);
      assert.equal(sentBodies(fetchMock)[0].message.attachment.payload.elements.length, 10);
    });

    it('rejects a bad recipient and a missing config without calling fetch', async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      assert.deepEqual(await sendGenericTemplate('abc', [cardInput()]), INVALID_INPUT);
      delete process.env.PAGE_ACCESS_TOKEN;
      assert.equal((await sendGenericTemplate(PSID, [cardInput()])).reason, 'config');
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  });

  it('returns a Graph failure as is, with no text fallback of its own', async () => {
    const fetchMock = mockFetchSequence(graphFail(100), ok('m_text'));

    const result = await sendGenericTemplate(PSID, [cardInput()]);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'graph_error');
    assert.equal(result.hint, 'invalid_parameter');
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});

describe('sendButtonTemplate', () => {
  const buttons = [
    { title: '✅ Confirm', payload: 'CONFIRM_ORDER:abc123def4567890' },
    { title: '❌ Cancel', payload: 'CANCEL_ORDER' },
  ];

  it('posts the official button template payload', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    const result = await sendButtonTemplate(PSID, 'Confirm your order?', buttons);

    assert.deepEqual(result, { ok: true, messageId: 'm_abc123', recipientId: PSID });
    assert.deepEqual(sentBodies(fetchMock)[0], {
      recipient: { id: PSID },
      messaging_type: 'RESPONSE',
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: 'Confirm your order?',
            buttons: [
              { type: 'postback', title: '✅ Confirm', payload: 'CONFIRM_ORDER:abc123def4567890' },
              { type: 'postback', title: '❌ Cancel', payload: 'CANCEL_ORDER' },
            ],
          },
        },
      },
    });
  });

  it('keeps 640 characters and cuts 641 to 640 with an ellipsis', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendButtonTemplate(PSID, 'x'.repeat(640), buttons);
    await sendButtonTemplate(PSID, 'y'.repeat(641), buttons);
    await sendButtonTemplate(PSID, '😀'.repeat(700), buttons);

    const texts = sentBodies(fetchMock).map((body) => body.message.attachment.payload.text);
    assert.equal(texts[0], 'x'.repeat(640));
    assert.equal(texts[1], `${'y'.repeat(639)}…`);
    assert.equal(texts[2], `${'😀'.repeat(639)}…`);
  });

  it('truncates button titles to 20 characters', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    await sendButtonTemplate(PSID, 'Pick', [{ title: 'L'.repeat(30), payload: 'GO' }]);

    assert.equal(sentBodies(fetchMock)[0].message.attachment.payload.buttons[0].title, `${'L'.repeat(19)}…`);
  });

  const invalid = [
    ['an empty text', '', buttons],
    ['a whitespace text', '  ', buttons],
    ['a non-string text', 42, buttons],
    ['no buttons', 'Pick', []],
    ['buttons that are not an array', 'Pick', buttons[0]],
    ['4 buttons', 'Pick', Array.from({ length: 4 }, (_, i) => ({ title: `B${i}`, payload: `P${i}` }))],
    ['a button without a payload', 'Pick', [{ title: 'Go' }]],
  ];

  for (const [name, text, badButtons] of invalid) {
    it(`rejects ${name} without calling fetch`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      assert.deepEqual(await sendButtonTemplate(PSID, text, badButtons), INVALID_INPUT);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }

  it('accepts 3 buttons', async () => {
    mockFetch(async () => jsonResponse(successBody));

    const three = [1, 2, 3].map((i) => ({ title: `B${i}`, payload: `P${i}` }));

    assert.equal((await sendButtonTemplate(PSID, 'Pick', three)).ok, true);
  });
});

describe('sendProductCatalog: requests', () => {
  it('sends the carousel, then the navigation text with quick replies', async () => {
    const fetchMock = mockFetchSequence(ok('m_carousel'), ok('m_nav'));

    const result = await sendProductCatalog(PSID, catalogOptions({ page: 2 }));

    assert.deepEqual(result, { ok: true, mode: 'template', messageId: 'm_carousel', recipientId: PSID });
    assert.equal(fetchMock.mock.callCount(), 2);
    const [carousel, nav] = sentBodies(fetchMock);
    assert.deepEqual(carousel, carouselBody([1, 2, 3, 4, 5].map(card)));
    assert.deepEqual(
      nav,
      textBody(NAV_TEXT, [
        ...productQuickReplies(),
        quickReplyOf('◀ Previous', 'CATALOG_PAGE:1'),
        quickReplyOf('Next ▶', 'CATALOG_PAGE:3'),
        quickReplyOf('Menu', 'MENU'),
      ]),
    );
  });

  const pages = [
    ['the first page', 1, 3, [['Next ▶', 'CATALOG_PAGE:2'], ['Menu', 'MENU']]],
    ['a middle page', 2, 3, [['◀ Previous', 'CATALOG_PAGE:1'], ['Next ▶', 'CATALOG_PAGE:3'], ['Menu', 'MENU']]],
    ['the last page', 3, 3, [['◀ Previous', 'CATALOG_PAGE:2'], ['Menu', 'MENU']]],
    ['a single page', 1, 1, [['Menu', 'MENU']]],
  ];

  for (const [name, page, totalPages, expected] of pages) {
    it(`offers the right quick replies on ${name}`, async () => {
      const fetchMock = mockFetchSequence(ok('m_carousel'), ok('m_nav'));

      await sendProductCatalog(PSID, catalogOptions({ page, totalPages }));

      const nav = sentBodies(fetchMock)[1];
      assert.deepEqual(nav.message.quick_replies, [
        ...productQuickReplies(),
        ...expected.map(([title, payload]) => quickReplyOf(title, payload)),
      ]);
    });
  }

  it('puts the code first and the price last, and keeps both when the name is too long', async () => {
    const fetchMock = mockFetchSequence(ok('m_carousel'), ok('m_nav'));
    const products = [
      makeProduct(1, { name: 'Handloom Silk Saree', price: 12500 }),
      makeProduct(2, { name: 'বাংলা'.repeat(40), price: 1250 }),
      makeProduct(3, { name: '😀'.repeat(100), price: 999 }),
    ];

    await sendProductCatalog(PSID, catalogOptions({ products }));

    const titles = sentBodies(fetchMock)[0].message.attachment.payload.elements.map((element) => element.title);
    assert.equal(titles[0], 'P001 · Handloom Silk Saree – ৳12500');
    for (const [index, suffix] of [[1, ' – ৳1250'], [2, ' – ৳999']]) {
      assert.ok(titles[index].startsWith(`P00${index + 1} · `), titles[index]);
      assert.ok(titles[index].endsWith(`…${suffix}`), titles[index]);
      assert.equal(Array.from(titles[index]).length, 80);
      assert.ok(titles[index].isWellFormed());
    }
  });

  it('cuts a long description to an 80 character subtitle and omits a missing one', async () => {
    const fetchMock = mockFetchSequence(ok('m_carousel'), ok('m_nav'));
    const products = [makeProduct(1, { description: 'd'.repeat(120) }), makeProduct(2, { description: '' }), makeProduct(3, { description: undefined })];

    await sendProductCatalog(PSID, catalogOptions({ products }));

    const elements = sentBodies(fetchMock)[0].message.attachment.payload.elements;
    assert.equal(elements[0].subtitle, `${'d'.repeat(79)}…`);
    assert.ok(!('subtitle' in elements[1]));
    assert.ok(!('subtitle' in elements[2]));
  });

  it('sends up to 10 products and never more', async () => {
    const fetchMock = mockFetchSequence(ok('m_carousel'), ok('m_nav'));

    assert.equal((await sendProductCatalog(PSID, catalogOptions({ products: makeProducts(10) }))).ok, true);
    assert.equal(sentBodies(fetchMock)[0].message.attachment.payload.elements.length, 10);
  });
});

describe('sendProductCatalog: validation (no I/O)', () => {
  const invalid = [
    ['no options', undefined],
    ['null options', null],
    ['no products', catalogOptions({ products: [] })],
    ['products that are not an array', catalogOptions({ products: makeProduct(1) })],
    ['11 products', catalogOptions({ products: makeProducts(11) })],
    ['page 0', catalogOptions({ page: 0 })],
    ['a fractional page', catalogOptions({ page: 1.5 })],
    ['a string page', catalogOptions({ page: '1' })],
    ['a page beyond totalPages', catalogOptions({ page: 4, totalPages: 3 })],
    ['totalPages missing', catalogOptions({ totalPages: undefined })],
    ['an empty navText', catalogOptions({ navText: '' })],
    ['a missing navText', catalogOptions({ navText: undefined })],
    ['an empty fallbackText', catalogOptions({ fallbackText: '  ' })],
    ['a fallbackText over 2000 characters', catalogOptions({ fallbackText: 'f'.repeat(2001) })],
  ];

  for (const [name, options] of invalid) {
    it(`rejects ${name}`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      assert.deepEqual(await sendProductCatalog(PSID, options), INVALID_INPUT);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }

  it('rejects a bad recipient and a missing config without calling fetch', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(successBody));

    assert.deepEqual(await sendProductCatalog('not-a-psid', catalogOptions()), INVALID_INPUT);
    delete process.env.FACEBOOK_PAGE_ID;
    assert.equal((await sendProductCatalog(PSID, catalogOptions())).reason, 'config');
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});

describe('sendProductCatalog: products that cannot become cards', () => {
  const unusable = [
    ['a null product', [null]],
    ['a product without an id', [makeProduct(1, { id: '' })]],
    ['a product without a name', [makeProduct(1, { name: ' ' })]],
    ['a product with a price of 0', [makeProduct(1, { price: 0 })]],
    ['a product with a fractional price', [makeProduct(1, { price: 12.5 })]],
    ['a product with a string price', [makeProduct(1, { price: '1250' })]],
    ['a product without an image url', [makeProduct(1, { imageUrl: undefined })]],
    ['a product with an http image url', [makeProduct(1, { imageUrl: 'http://cdn.example.com/a.jpg' })]],
    ['one bad product among good ones', [...makeProducts(4), makeProduct(5, { imageUrl: 'not a url' })]],
  ];

  for (const [name, products] of unusable) {
    it(`sends the text list instead of failing for ${name}`, async () => {
      const fetchMock = mockFetchSequence(ok('m_text'));

      const result = await sendProductCatalog(PSID, catalogOptions({ products }));

      assert.equal(result.ok, true);
      assert.equal(result.mode, 'text_fallback');
      assert.deepEqual(result.templateFailure, { reason: 'invalid_input', hint: null, code: null });
      assert.equal(fetchMock.mock.callCount(), 1);
      const [body] = sentBodies(fetchMock);
      assert.equal(body.message.text, FALLBACK_TEXT);
      assert.ok(body.message.quick_replies.length >= 1);
      assert.equal(body.message.attachment, undefined);
    });
  }

  it('returns the failure when the text list cannot be sent either', async () => {
    mockFetchSequence(graphFail(190, 401));

    const result = await sendProductCatalog(PSID, catalogOptions({ products: [null] }));

    assert.equal(result.ok, false);
    assert.equal(result.hint, 'invalid_access_token');
  });
});

describe('sendProductCatalog: navigation message failure', () => {
  it('reports ok with navFailure when only the navigation text fails, and does not resend the carousel', async () => {
    const fetchMock = mockFetchSequence(ok('m_carousel'), graphFail(4, 400));

    const result = await sendProductCatalog(PSID, catalogOptions());

    assert.deepEqual(result, {
      ok: true,
      mode: 'template',
      messageId: 'm_carousel',
      recipientId: PSID,
      navFailure: { reason: 'graph_error', hint: 'rate_limited', code: 4 },
    });
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(sentBodies(fetchMock).filter((body) => body.message.attachment).length, 1);
  });

  it('reports a network failure of the navigation text with a null code', async () => {
    mockFetchSequence(ok('m_carousel'), throwing(new TypeError('fetch failed')));

    const result = await sendProductCatalog(PSID, catalogOptions());

    assert.equal(result.ok, true);
    assert.deepEqual(result.navFailure, { reason: 'network', hint: null, code: null });
  });

  it('reports only reason, hint and code, never the Graph message or the token', async () => {
    mockFetchSequence(ok('m_carousel'), () => jsonResponse(graphError(2, undefined, `secret ${TOKEN}`), 400));

    const result = await sendProductCatalog(PSID, catalogOptions());

    assert.deepEqual(result.navFailure, { reason: 'graph_error', hint: null, code: 2 });
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });
});

describe('sendProductCatalog: text fallback', () => {
  for (const [name, step, code, hint] of FALLBACK_CASES) {
    it(`falls back to text after ${name}, with the same quick replies`, async () => {
      const fetchMock = mockFetchSequence(step, ok('m_text'));

      const result = await sendProductCatalog(PSID, catalogOptions({ page: 2 }));

      assert.deepEqual(result, {
        ok: true,
        mode: 'text_fallback',
        messageId: 'm_text',
        recipientId: PSID,
        templateFailure: { reason: 'graph_error', hint, code },
      });
      assert.equal(fetchMock.mock.callCount(), 2);
      const [carousel, fallback] = sentBodies(fetchMock);
      assert.ok(carousel.message.attachment);
      assert.deepEqual(
        fallback,
        textBody(FALLBACK_TEXT, [
          ...productQuickReplies(),
          quickReplyOf('◀ Previous', 'CATALOG_PAGE:1'),
          quickReplyOf('Next ▶', 'CATALOG_PAGE:3'),
          quickReplyOf('Menu', 'MENU'),
        ]),
      );
    });
  }

  for (const [name, step, reason, hint] of NO_FALLBACK_CASES) {
    it(`does not call Graph again after ${name}`, async () => {
      const fetchMock = mockFetchSequence(step, ok('m_text'), ok('m_nav'));

      const result = await sendProductCatalog(PSID, catalogOptions());

      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.equal(result.hint, hint);
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }

  it('returns the failure of the fallback text when that fails too', async () => {
    const fetchMock = mockFetchSequence(graphFail(100), graphFail(190));

    const result = await sendProductCatalog(PSID, catalogOptions());

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'graph_error');
    assert.equal(result.hint, 'invalid_access_token');
    assert.equal(fetchMock.mock.callCount(), 2);
  });
});

describe('sendOrderConfirmation', () => {
  const DRAFT_ID = 'abc123def4567890';
  const SUMMARY = 'Your order:\nProduct: Silk Saree\nQuantity: 2\nConfirm?';
  const confirmationBody = (text) =>
    textBody(text, [quickReplyOf('✅ Confirm', `CONFIRM_ORDER:${DRAFT_ID}`), quickReplyOf('❌ Cancel', 'CANCEL_ORDER')]);

  it('sends the summary as text with Confirm and Cancel quick replies', async () => {
    const fetchMock = mockFetchSequence(ok('m_order'));

    const result = await sendOrderConfirmation(PSID, { text: SUMMARY, draftId: DRAFT_ID });

    assert.deepEqual(result, { ok: true, mode: 'quick_replies', messageId: 'm_order', recipientId: PSID });
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(sentBodies(fetchMock)[0], confirmationBody(SUMMARY));
  });

  it('sends a summary of up to 2000 characters in one message', async () => {
    const fetchMock = mockFetchSequence(ok('m_order'));
    const text = `${'a'.repeat(1990)}\nConfirm?`;

    assert.equal((await sendOrderConfirmation(PSID, { text, draftId: DRAFT_ID })).ok, true);
    assert.deepEqual(sentBodies(fetchMock)[0], confirmationBody(text));
  });

  const failures = [
    ...NO_FALLBACK_CASES,
    ...FALLBACK_CASES.map(([name, step, , hint]) => [name, step, 'graph_error', hint]),
  ];
  for (const [name, step, reason, hint] of failures) {
    it(`returns the failure after ${name} and does not call Graph again`, async () => {
      const fetchMock = mockFetchSequence(step, ok('m_text'));

      const result = await sendOrderConfirmation(PSID, { text: SUMMARY, draftId: DRAFT_ID });

      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.equal(result.hint, hint);
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }

  const invalid = [
    ['no options', undefined],
    ['a missing draftId', { text: SUMMARY }],
    ['an empty draftId', { text: SUMMARY, draftId: ' ' }],
    ['a non-string draftId', { text: SUMMARY, draftId: 12345 }],
    ['a draftId that makes the payload too long', { text: SUMMARY, draftId: 'd'.repeat(1000) }],
    ['a missing text', { draftId: DRAFT_ID }],
    ['an empty text', { text: '', draftId: DRAFT_ID }],
    ['a text over 2000 characters', { text: 'a'.repeat(2001), draftId: DRAFT_ID }],
  ];

  for (const [name, options] of invalid) {
    it(`rejects ${name} without calling fetch`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      assert.deepEqual(await sendOrderConfirmation(PSID, options), INVALID_INPUT);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }
});

describe('sendPhotoAndText', () => {
  const IMAGE_URL = 'https://images.example.com/saree.jpg?w=800&h=800';
  const QUESTION = 'How many pieces?';
  const QUANTITY = [{ title: '1', payload: 'QUANTITY:1' }, { title: '2', payload: 'QUANTITY:2' }];
  const options = (overrides = {}) => ({ imageUrl: IMAGE_URL, text: QUESTION, quickReplies: QUANTITY, ...overrides });
  const photoBody = (url) => ({
    recipient: { id: PSID },
    messaging_type: 'RESPONSE',
    message: { attachment: { type: 'image', payload: { url } } },
  });
  const questionBody = textBody(QUESTION, [quickReplyOf('1', 'QUANTITY:1'), quickReplyOf('2', 'QUANTITY:2')]);

  it('sends the photo, then the text with its quick replies', async () => {
    const fetchMock = mockFetchSequence(ok('m_photo'), ok('m_text'));

    const result = await sendPhotoAndText(PSID, options());

    assert.deepEqual(result, { ok: true, mode: 'photo', messageId: 'm_text', recipientId: PSID });
    assert.deepEqual(sentBodies(fetchMock), [photoBody(IMAGE_URL), questionBody]);
  });

  const photoFailures = [
    ...FALLBACK_CASES.map(([name, step, code, hint]) => [name, step, { reason: 'graph_error', hint, code }]),
    ['a timeout', throwing(timeoutError()), { reason: 'timeout', hint: null, code: null }],
    ['HTTP 500', () => new Response('oops', { status: 500 }), { reason: 'http_error', hint: null, code: null }],
  ];
  for (const [name, step, photoFailure] of photoFailures) {
    it(`still sends the text after the photo fails with ${name}`, async () => {
      const fetchMock = mockFetchSequence(step, ok('m_text'));

      const result = await sendPhotoAndText(PSID, options());

      assert.deepEqual(result, { ok: true, mode: 'text_only', messageId: 'm_text', recipientId: PSID, photoFailure });
      assert.deepEqual(sentBodies(fetchMock)[1], questionBody);
    });
  }

  for (const imageUrl of [undefined, '', 'http://images.example.com/saree.jpg', 'not a url', 42]) {
    it(`skips the photo request for the image ${JSON.stringify(imageUrl)} and sends the text`, async () => {
      const fetchMock = mockFetchSequence(ok('m_text'));

      const result = await sendPhotoAndText(PSID, options({ imageUrl }));

      assert.deepEqual(result, {
        ok: true,
        mode: 'text_only',
        messageId: 'm_text',
        recipientId: PSID,
        photoFailure: { reason: 'invalid_input', hint: null, code: null },
      });
      assert.deepEqual(sentBodies(fetchMock), [questionBody]);
    });
  }

  it('returns the failure when the text fails after the photo', async () => {
    const fetchMock = mockFetchSequence(ok('m_photo'), graphFail(10, 400, 2018278));

    const result = await sendPhotoAndText(PSID, options());

    assert.equal(result.ok, false);
    assert.equal(result.hint, 'outside_messaging_window');
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  const invalid = [
    ['a missing text', options({ text: undefined })],
    ['an empty text', options({ text: ' ' })],
    ['a text over 2000 characters', options({ text: 'a'.repeat(2001) })],
    ['invalid quick replies', options({ quickReplies: [{ title: '', payload: 'X' }] })],
  ];
  for (const [name, value] of invalid) {
    it(`rejects ${name} without calling fetch, so no photo goes out alone`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      assert.deepEqual(await sendPhotoAndText(PSID, value), INVALID_INPUT);
      assert.deepEqual(await sendPhotoAndText('not-a-psid', options()), INVALID_INPUT);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }
});

describe('new send functions: shared guarantees', () => {
  const calls = {
    sendTextMessage: () => sendTextMessage(PSID, 'hi', { quickReplies: [{ title: 'A', payload: 'A' }] }),
    sendGenericTemplate: () => sendGenericTemplate(PSID, [cardInput()]),
    sendButtonTemplate: () => sendButtonTemplate(PSID, 'Pick', [{ title: 'A', payload: 'A' }]),
    sendProductCatalog: () => sendProductCatalog(PSID, catalogOptions()),
    sendOrderConfirmation: () => sendOrderConfirmation(PSID, { text: 'Order?', draftId: 'abc123' }),
    sendPhotoAndText: () =>
      sendPhotoAndText(PSID, { imageUrl: 'https://images.example.com/a.jpg', text: 'How many?', quickReplies: [] }),
  };

  for (const [name, call] of Object.entries(calls)) {
    it(`${name}: the token stays in the Authorization header and out of every result`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(graphError(100, undefined, `bad request for ${TOKEN}`), 400));
      const failed = await call();
      fetchMock.mock.mockImplementation(async () => jsonResponse(successBody));
      const succeeded = await call();

      assert.ok(!JSON.stringify(failed).includes(TOKEN));
      assert.ok(!JSON.stringify(succeeded).includes(TOKEN));
      assert.ok(fetchMock.mock.callCount() >= 2);
      for (const [url, init] of fetchMock.mock.calls.map((recorded) => recorded.arguments)) {
        assert.ok(!url.includes(TOKEN));
        assert.ok(!init.body.includes(TOKEN));
        assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
      }
    });

    it(`${name}: an invalid-token failure result never contains the token either`, async () => {
      mockFetch(async () => jsonResponse(graphError(190, undefined, `token ${TOKEN} expired`), 400));

      const result = await call();

      assert.equal(result.ok, false);
      assert.ok(!JSON.stringify(result).includes(TOKEN));
    });
  }

  const garbage = [undefined, null, 42, 'text', {}, []];

  for (const fn of [sendGenericTemplate, sendButtonTemplate, sendProductCatalog, sendOrderConfirmation, sendPhotoAndText]) {
    it(`${fn.name} never rejects on garbage arguments and does no I/O`, async () => {
      const fetchMock = mockFetch(async () => jsonResponse(successBody));

      for (const value of garbage) {
        for (const result of [await fn(PSID, value), await fn(PSID, value, value), await fn(value, value, value)]) {
          assert.deepEqual(result, INVALID_INPUT);
        }
      }
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }

  it('does not write to the console', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((method) => mock.method(console, method, () => {}));
    mockFetchSequence(ok('a'), ok('b'), graphFail(100), ok('c'), throwing(timeoutError()), ok('d'), ok('e'));

    await sendProductCatalog(PSID, catalogOptions());
    await sendProductCatalog(PSID, catalogOptions());
    await sendGenericTemplate(PSID, [cardInput()]);
    await sendOrderConfirmation(PSID, { text: 'Order?', draftId: 'abc123' });
    await sendButtonTemplate(PSID, 'Pick', [{ title: 'A', payload: 'A' }]);
    await sendProductCatalog(PSID, {});

    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  });
});
