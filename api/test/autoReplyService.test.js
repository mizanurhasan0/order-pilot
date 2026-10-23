import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACHMENT_REPLY, normalizeText, processEntries } from '../src/services/autoReplyService.js';
import { conversationService } from '../src/services/conversationService.js';
import { createDedupeCache } from '../src/services/dedupeCache.js';
import { catalogPagePayload, MENU_PAYLOAD, orderProductPayload } from '../src/services/payloads.js';
import { getCatalogPage } from '../src/services/productService.js';
import * as quick from '../src/services/quickReplies.js';
import * as texts from '../src/services/replyTexts.js';
import { orderStore } from '../src/store/orderStore.js';
import { STEPS, conversationKey, sessionStore } from '../src/store/sessionStore.js';

// The welcome menu and the attachment reply written out independently of replyTexts.js,
// so a typo there is caught.
const WELCOME_TEXT = `স্বাগতম! 🛍️

Tangail Botiques-এ আপনাকে স্বাগতম।

আমাদের পণ্য দেখতে অথবা অর্ডার করতে নিচের অপশন নির্বাচন করুন।

1. 🛍️ View Products
2. 📦 My Order Information
3. 👨‍💼 Contact Support`;

const ATTACHMENT_TEXT = `দুঃখিত, আমি এখন শুধু টেক্সট মেসেজ বুঝতে পারি।

নিচের বাটনে চাপুন, অথবা 1, 2 বা 3 লিখুন।`;

// The menu quick replies as the Send API receives them.
const MENU_QUICK_REPLIES = quick.MENU.map(({ title, payload }) => ({ content_type: 'text', title, payload }));

describe('normalizeText', () => {
  test('trims the message', () => {
    assert.equal(normalizeText('  hi  '), 'hi');
    assert.equal(normalizeText('\n\thello\r\n'), 'hello');
  });

  test('lower-cases the message', () => {
    assert.equal(normalizeText('HeLLo'), 'hello');
    assert.equal(normalizeText('ORDER INFORMATION'), 'order information');
  });

  test('collapses internal whitespace to one space', () => {
    assert.equal(normalizeText('order   information'), 'order information');
    assert.equal(normalizeText('order \t\n information'), 'order information');
    assert.equal(normalizeText('order information'), 'order information');
  });

  test('strips leading and trailing punctuation only', () => {
    assert.equal(normalizeText('Hi!'), 'hi');
    assert.equal(normalizeText('hello?!'), 'hello');
    assert.equal(normalizeText('..hi..'), 'hi');
    assert.equal(normalizeText('"hi"'), 'hi');
    assert.equal(normalizeText("'hi'"), 'hi');
    assert.equal(normalizeText('~hi~'), 'hi');
    assert.equal(normalizeText('hi,;:'), 'hi');
    assert.equal(normalizeText('হাই।'), 'হাই');
    assert.equal(normalizeText(' ! hi ! '), 'hi');
    assert.equal(normalizeText('hi, there'), 'hi, there');
    assert.equal(normalizeText('a.b'), 'a.b');
  });

  test('returns an empty string for empty or punctuation-only input', () => {
    assert.equal(normalizeText(''), '');
    assert.equal(normalizeText('   '), '');
    assert.equal(normalizeText('?!.'), '');
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(undefined), '');
  });

  test('converts Bangla digits to ASCII digits', () => {
    assert.equal(normalizeText('১'), '1');
    assert.equal(normalizeText('২'), '2');
    assert.equal(normalizeText('৩'), '3');
    assert.equal(normalizeText('০১২৩৪৫৬৭৮৯'), '0123456789');
    assert.equal(normalizeText('৩।'), '3');
  });

  test('normalizes to NFC', () => {
    assert.equal(normalizeText('é'), 'é');
    assert.equal(normalizeText('হ্যালো'.normalize('NFD')), 'হ্যালো'.normalize('NFC'));
  });

  test('coerces non-string input to a string', () => {
    assert.equal(normalizeText(1), '1');
  });
});

describe('ATTACHMENT_REPLY', () => {
  test('is the attachment rule with its text', () => {
    assert.deepEqual({ ...ATTACHMENT_REPLY }, { rule: 'attachment', text: texts.ATTACHMENT, quickReplies: quick.MENU });
    assert.equal(ATTACHMENT_REPLY.text, ATTACHMENT_TEXT);
  });

  test('replyTexts keeps the agreed welcome text', () => {
    assert.equal(texts.WELCOME, WELCOME_TEXT);
  });
});

describe('processEntries', () => {
  const TOKEN = 'TEST_TOKEN_DO_NOT_LEAK';
  const PAGE_ID = '1234567890';
  const PSID = '9876543210123456';
  const OTHER_PSID = '5555555555555555';
  const GRAPH_URL = `https://graph.facebook.com/v26.0/${PAGE_ID}/messages`;
  const FAKE_ENV = {
    ENABLE_AUTO_REPLY: 'true',
    PAGE_ACCESS_TOKEN: TOKEN,
    FACEBOOK_PAGE_ID: PAGE_ID,
    META_GRAPH_API_VERSION: 'v26.0',
  };
  const PHONE = '01712345678';
  const ADDRESS = 'House 12, Road 3, Tangail Sadar';

  const firstPage = getCatalogPage(1);
  const product = firstPage.items[0];
  const sessionKey = conversationKey(PAGE_ID, PSID);

  let savedEnv;
  let logs;
  let fetchMock;
  let cache;
  let midCounter = 0;

  function captureLogs() {
    const lines = [];
    for (const level of ['log', 'warn', 'error']) {
      mock.method(console, level, (...args) => {
        lines.push({ level, tag: String(args[0]), data: args[1], text: args.map(String).join(' ') });
      });
    }
    return lines;
  }

  const graphOk = (messageId = 'm_reply_1') =>
    new Response(JSON.stringify({ recipient_id: PSID, message_id: messageId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const graphError = (status, error) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  // Parsed JSON payload of every log line with this tag.
  const logged = (tag) => logs.filter((line) => line.tag === tag).map((line) => JSON.parse(line.data));
  const ignoredReasons = () => logged('[Messenger] Ignored event').map((data) => data.reason);

  const sentRequests = () =>
    fetchMock.mock.calls.map((call) => {
      const [url, init] = call.arguments;
      return { url, init, body: JSON.parse(init.body) };
    });
  const sentBodies = () => sentRequests().map((request) => request.body);
  const sentTo = (psid) => sentBodies().filter((body) => body.recipient.id === psid);

  const templateOf = (body) => body.message.attachment?.payload;
  const quickReplyPayloads = (body) => body.message.quick_replies.map((item) => item.payload);

  function assertNoLeaks(...extraSecrets) {
    for (const secret of [TOKEN, PSID, ...extraSecrets]) {
      for (const line of logs) {
        assert.ok(!line.text.includes(secret), `log line "${line.tag}" leaked a secret`);
      }
    }
  }

  const baseEvent = (extra = {}) => ({
    sender: { id: PSID },
    recipient: { id: PAGE_ID },
    timestamp: 1700000000000,
    ...extra,
  });
  const nextMid = () => `m_ar_${(midCounter += 1)}`;
  const messageEvent = (message = {}, overrides = {}) =>
    baseEvent({ message: { mid: 'm_1', text: 'hi', ...message }, ...overrides });
  const textEvent = (text, overrides = {}) => messageEvent({ mid: nextMid(), text }, overrides);
  const quickReplyEvent = (payload, text = 'a button title', overrides = {}) =>
    messageEvent({ mid: nextMid(), text, quick_reply: { payload } }, overrides);
  const postbackEvent = (payload, postback = {}, overrides = {}) =>
    baseEvent({ postback: { mid: nextMid(), title: 'a button', payload, ...postback }, ...overrides });
  // What Messenger sends when someone opens the chat through https://m.me/<page>?ref=<ref>.
  const linkReferral = (ref) => ({ ref, source: 'SHORTLINK', type: 'OPEN_THREAD' });
  const referralEvent = (ref, overrides = {}) => baseEvent({ referral: linkReferral(ref), ...overrides });
  const entryOf = (events, id = PAGE_ID) => ({ id, time: 1700000000000, messaging: events });
  const run = (entries) => processEntries(entries, { cache });

  const say = (text) => run([entryOf([textEvent(text)])]);
  const tap = (payload) => run([entryOf([postbackEvent(payload)])]);

  // Takes the customer through the questions up to the order summary; returns its draft id.
  async function reachSummary() {
    await tap(orderProductPayload(product.id));
    await say('3');
    await say(PHONE);
    await say(ADDRESS);
    const [confirmQuickReply] = sentBodies().at(-1).message.quick_replies;
    return confirmQuickReply.payload.split(':')[1];
  }

  beforeEach(() => {
    savedEnv = {};
    for (const key of Object.keys(FAKE_ENV)) savedEnv[key] = process.env[key];
    Object.assign(process.env, FAKE_ENV);

    logs = captureLogs();
    fetchMock = mock.method(globalThis, 'fetch', async () => graphOk());
    cache = createDedupeCache();
    sessionStore.clear();
    orderStore.clear();
  });

  afterEach(() => {
    // Whatever a test did, the token and the full PSID must never reach a log.
    try {
      assertNoLeaks();
    } finally {
      mock.restoreAll();
      sessionStore.clear();
      orderStore.clear();
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  describe('replies', () => {
    test('greeting message gets one POST with the welcome menu', async () => {
      await run([entryOf([messageEvent({ text: 'Hi!' })])]);

      const requests = sentRequests();
      assert.equal(requests.length, 1);
      const [{ url, init, body }] = requests;
      assert.equal(url, GRAPH_URL);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
      assert.ok(!url.includes(TOKEN));
      assert.deepEqual(body, {
        recipient: { id: PSID },
        messaging_type: 'RESPONSE',
        message: { text: WELCOME_TEXT, quick_replies: MENU_QUICK_REPLIES },
      });
    });

    const textCases = [
      ['hello', 'welcome', texts.WELCOME],
      ['হাই', 'welcome', WELCOME_TEXT],
      ['2', 'order_info', texts.orderInfo([])],
      ['order information', 'order_info', texts.orderInfo([])],
      ['3', 'support', texts.SUPPORT],
      ['help', 'support', texts.SUPPORT],
      ['some unknown message', 'fallback', texts.FALLBACK],
    ];
    for (const [text, rule, expected] of textCases) {
      test(`${JSON.stringify(text)} gets the ${rule} reply`, async () => {
        await say(text);

        const requests = sentRequests();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].body.message.text, expected);
        assert.equal(requests[0].body.recipient.id, PSID);
        assert.deepEqual(logged('[AutoReply] Matching reply rule'), [{ rule, step: STEPS.IDLE }]);
      });
    }

    test('the empty order list is worded in Bangla and offers the catalog', async () => {
      await say('2');
      assert.ok(sentBodies()[0].message.text.startsWith('আপনার কোনো অর্ডার পাওয়া যায়নি।'));
    });

    for (const text of ['1', '১', 'view products']) {
      test(`${JSON.stringify(text)} sends one carousel of the first page and then the navigation`, async () => {
        await say(text);

        const [carousel, nav] = sentBodies();
        assert.equal(sentBodies().length, 2);
        const template = templateOf(carousel);
        assert.equal(template.template_type, 'generic');
        assert.deepEqual(
          template.elements.map((element) => element.buttons[0].payload),
          firstPage.items.map((item) => orderProductPayload(item.id)),
        );
        assert.ok(template.elements[0].title.includes(`৳${product.price}`));
        assert.equal(nav.message.text, texts.catalogNav(firstPage));
        assert.deepEqual(
          quickReplyPayloads(nav),
          [
            ...firstPage.items.map((item) => orderProductPayload(item.id)),
            ...(firstPage.hasNext ? [catalogPagePayload(2)] : []),
            MENU_PAYLOAD,
          ],
        );
        assert.deepEqual(logged('[AutoReply] Matching reply rule'), [
          { rule: 'catalog', step: STEPS.BROWSING_PRODUCTS },
        ]);
        assert.deepEqual(logged('[SendAPI] Reply sent successfully').map((data) => data.mode), ['template']);
        assert.equal(sessionStore.get(sessionKey).step, STEPS.BROWSING_PRODUCTS);
      });
    }

    test('a quick-reply payload wins over its text', async () => {
      await run([entryOf([quickReplyEvent(catalogPagePayload(2), 'hello')])]);

      const [carousel] = sentBodies();
      assert.deepEqual(
        templateOf(carousel).elements.map((element) => element.buttons[0].payload),
        getCatalogPage(2).items.map((item) => orderProductPayload(item.id)),
      );
      assert.deepEqual(logged('[AutoReply] Matching reply rule'), [
        { rule: 'catalog_page', step: STEPS.BROWSING_PRODUCTS },
      ]);
    });

    test('a Menu quick reply sends the welcome menu', async () => {
      await run([entryOf([quickReplyEvent(MENU_PAYLOAD, 'Menu')])]);
      assert.deepEqual(sentBodies().map((body) => body.message.text), [WELCOME_TEXT]);
    });

    test('an "Order Now" postback starts a draft and asks for the quantity', async () => {
      await tap(orderProductPayload(product.id));

      assert.deepEqual(sentBodies().map((body) => body.message.text), [texts.orderStart(product)]);
      assert.ok(sentBodies()[0].message.text.includes(product.name));
      assert.ok(sentBodies()[0].message.text.includes(`৳${product.price}`));
      const session = sessionStore.get(sessionKey);
      assert.equal(session.step, STEPS.WAITING_FOR_QUANTITY);
      assert.equal(session.productId, product.id);
      assert.equal(orderStore.size(), 0);
    });

    for (const payload of ['GET_STARTED', 'MENU', 'SOMETHING_NEW:42']) {
      test(`the postback ${payload} gets the welcome menu`, async () => {
        await run([entryOf([postbackEvent(payload)])]);
        assert.deepEqual(sentBodies().map((body) => body.message.text), [WELCOME_TEXT]);
      });
    }

    test('the order summary is sent as text with Confirm and Cancel quick replies', async () => {
      const draftId = await reachSummary();

      const summary = sentBodies().at(-1);
      assert.equal(summary.message.attachment, undefined);
      assert.ok(summary.message.text.includes(PHONE));
      assert.ok(summary.message.text.includes(ADDRESS));
      assert.deepEqual(quickReplyPayloads(summary), [`CONFIRM_ORDER:${draftId}`, 'CANCEL_ORDER']);
      assert.equal(orderStore.size(), 0, 'nothing is ordered before the customer confirms');
    });

    test('confirming the summary creates the order and sends the confirmation text', async () => {
      const draftId = await reachSummary();
      await tap(`CONFIRM_ORDER:${draftId}`);

      const [order] = orderStore.list();
      assert.equal(orderStore.size(), 1);
      assert.equal(order.customerPsid, PSID);
      assert.equal(order.subtotal, product.price * 3);
      assert.equal(sentBodies().at(-1).message.text, texts.orderConfirmed(order));
      assert.ok(sentBodies().at(-1).message.text.includes(order.id));
      assert.equal(sessionStore.get(sessionKey).step, STEPS.IDLE);
    });

    test('attachment-only message gets the attachment reply and no attachment URL is fetched', async () => {
      const attachmentUrl = 'https://cdn.example.test/photos/customer-photo.jpg';
      const event = messageEvent({
        text: undefined,
        attachments: [{ type: 'image', payload: { url: attachmentUrl } }],
      });
      await run([entryOf([event])]);

      const requests = sentRequests();
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, GRAPH_URL);
      assert.equal(requests[0].body.message.text, ATTACHMENT_REPLY.text);
      assert.equal(requests[0].body.message.text, ATTACHMENT_TEXT);
      assert.ok(requests.every((request) => !request.url.includes('cdn.example.test')));
      assert.deepEqual(logged('[AutoReply] Matching reply rule'), [{ rule: 'attachment', step: null }]);
      const [incoming] = logged('[Messenger] Incoming customer message');
      assert.equal(incoming.attachmentCount, 1);
      assert.equal(incoming.kind, 'attachment');
      assertNoLeaks(attachmentUrl);
    });

    test('an attachment does not touch the session', async () => {
      await tap(orderProductPayload(product.id));
      await say('2');
      const before = sessionStore.get(sessionKey);
      assert.equal(before.step, STEPS.WAITING_FOR_PHONE);

      // Even reading would be a touch: get() deletes an expired session and reports it only once.
      const spies = ['get', 'update', 'reset', 'delete'].map((method) => mock.method(sessionStore, method));
      await run([entryOf([messageEvent({ mid: nextMid(), text: undefined, attachments: [{ type: 'image' }] })])]);
      assert.deepEqual(spies.map((spy) => spy.mock.callCount()), [0, 0, 0, 0]);
      spies.forEach((spy) => spy.mock.restore());

      assert.equal(sentBodies().at(-1).message.text, ATTACHMENT_TEXT);
      assert.deepEqual(sessionStore.get(sessionKey), before);
    });

    test('empty text with an attachment gets the attachment reply', async () => {
      const event = messageEvent({
        text: '   ',
        attachments: [{ type: 'audio', payload: { url: 'https://cdn.example.test/a.mp3' } }],
      });
      await run([entryOf([event])]);

      assert.equal(sentRequests().length, 1);
      assert.equal(sentRequests()[0].body.message.text, ATTACHMENT_TEXT);
    });

    test('text plus attachment: the text rule wins', async () => {
      const event = messageEvent({
        text: 'hello',
        attachments: [{ type: 'image', payload: { url: 'https://cdn.example.test/p.jpg' } }],
      });
      await run([entryOf([event])]);

      const requests = sentRequests();
      assert.equal(requests.length, 1);
      assert.equal(requests[0].body.message.text, WELCOME_TEXT);
      const [incoming] = logged('[Messenger] Incoming customer message');
      assert.equal(incoming.textLength, 5);
      assert.equal(incoming.attachmentCount, 1);
      assert.equal(incoming.kind, 'text');
    });

    test('all events in an entry, and all entries, are handled', async () => {
      const third = '7777777777777777';
      const fourth = '8888888888888888';
      const events = [
        messageEvent({ mid: 'm_a', text: 'hi' }),
        messageEvent({ mid: 'm_b', text: '2' }, { sender: { id: OTHER_PSID } }),
        messageEvent({ mid: 'm_c', text: '3' }, { sender: { id: third } }),
      ];
      const second = messageEvent({ mid: 'm_d', text: 'help' }, { sender: { id: fourth } });
      await run([entryOf(events), entryOf([second])]);

      const byRecipient = new Map(sentBodies().map((body) => [body.recipient.id, body.message.text]));
      assert.equal(byRecipient.size, 4);
      assert.equal(byRecipient.get(PSID), WELCOME_TEXT);
      assert.equal(byRecipient.get(OTHER_PSID), texts.orderInfo([]));
      assert.equal(byRecipient.get(third), texts.SUPPORT);
      assert.equal(byRecipient.get(fourth), texts.SUPPORT);
      assert.equal(logged('[SendAPI] Reply sent successfully').length, 4);
    });

    test('the same mid twice in one payload is answered once', async () => {
      const event = messageEvent({ mid: 'm_same' });
      await run([entryOf([event, event])]);

      assert.equal(sentRequests().length, 1);
      assert.deepEqual(ignoredReasons(), ['duplicate']);
    });

    test('works with the default cache when no cache option is given', async () => {
      const entries = [entryOf([messageEvent({ mid: 'm_default_cache_only_here' })])];
      await processEntries(entries);
      await processEntries(entries);

      assert.equal(sentRequests().length, 1);
      assert.deepEqual(ignoredReasons(), ['duplicate']);
    });
  });

  describe('skipped events', () => {
    const skipCases = [
      ['page_mismatch', () => [entryOf([messageEvent()], '9999999999')]],
      ['self_sender', () => [entryOf([messageEvent({}, { sender: { id: PAGE_ID } })])]],
      ['recipient_mismatch', () => [entryOf([messageEvent({}, { recipient: { id: '5555555555' } })])]],
      ['no_sender', () => [entryOf([messageEvent({}, { sender: undefined })])]],
      ['no_sender', () => [entryOf([messageEvent({}, { sender: {} })])]],
      ['no_sender', () => [entryOf([messageEvent({}, { sender: { id: '' } })])]],
      ['echo', () => [entryOf([messageEvent({ is_echo: true, app_id: 123 })])]],
      [
        'self_sender',
        () => [entryOf([messageEvent({ is_echo: true }, { sender: { id: PAGE_ID }, recipient: { id: PSID } })])],
      ],
      ['no_mid', () => [entryOf([messageEvent({ mid: undefined })])]],
      ['no_mid', () => [entryOf([messageEvent({ mid: '' })])]],
      ['no_mid', () => [entryOf([messageEvent({ mid: 12345 })])]],
      ['no_payload', () => [entryOf([baseEvent({ postback: { mid: 'm_p', title: 'Get Started' } })])]],
      ['no_payload', () => [entryOf([baseEvent({ postback: { mid: 'm_p', payload: '' } })])]],
      ['no_payload', () => [entryOf([baseEvent({ postback: { mid: 'm_p', payload: { a: 1 } } })])]],
      ['unsupported_event', () => [entryOf([baseEvent({ delivery: { mids: ['m_d'], watermark: 1 } })])]],
      ['unsupported_event', () => [entryOf([baseEvent({ read: { watermark: 1 } })])]],
      [
        'unsupported_event',
        () => [entryOf([baseEvent({ reaction: { mid: 'm_r', action: 'react', emoji: '❤', reaction: 'love' } })])],
      ],
      ['unsupported_event', () => [entryOf([baseEvent({ message: 'not an object' })])]],
      ['unsupported_event', () => [entryOf([baseEvent({ postback: 'not an object' })])]],
      ['no_content', () => [entryOf([messageEvent({ text: '' })])]],
      ['no_content', () => [entryOf([messageEvent({ text: '   \n ' })])]],
      ['no_content', () => [entryOf([messageEvent({ text: undefined })])]],
      ['no_content', () => [entryOf([messageEvent({ text: undefined, attachments: [] })])]],
      ['no_content', () => [entryOf([messageEvent({ text: 42, attachments: 'x' })])]],
      ['invalid_event', () => [entryOf([null])]],
    ];

    for (const [reason, build] of skipCases) {
      test(`${reason}: ${JSON.stringify(build()).slice(0, 80)}`, async () => {
        await run(build());

        assert.equal(fetchMock.mock.callCount(), 0);
        assert.deepEqual(ignoredReasons(), [reason]);
        assert.equal(logged('[Messenger] Incoming customer message').length, 0);
      });
    }

    test('an echo of a postback-style reply never starts anything', async () => {
      await run([entryOf([messageEvent({ is_echo: true, text: texts.WELCOME }, { sender: { id: PAGE_ID } })])]);
      assert.equal(fetchMock.mock.callCount(), 0);
    });

    test('duplicate mid: the second delivery with the same cache is ignored', async () => {
      const entries = [entryOf([messageEvent({ mid: 'm_dup' })])];
      await run(entries);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.deepEqual(ignoredReasons(), []);

      await run(entries);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.deepEqual(ignoredReasons(), ['duplicate']);
    });

    test('a duplicate is detected even while the first reply is still in flight', async () => {
      let release;
      fetchMock.mock.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve(graphOk());
          }),
      );
      const entries = [entryOf([messageEvent({ mid: 'm_inflight' })])];

      const first = run(entries);
      // The stores are awaited, so let the first event reach its (held) send before the copy arrives.
      while (fetchMock.mock.callCount() === 0) await new Promise((resolve) => setImmediate(resolve));
      await run(entries);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.deepEqual(ignoredReasons(), ['duplicate']);

      release();
      await first;
      assert.equal(logged('[SendAPI] Reply sent successfully').length, 1);
    });

    test('a skipped event does not stop the other events of the entry', async () => {
      const events = [
        baseEvent({ delivery: { mids: ['m_d'], watermark: 1 } }),
        messageEvent({ mid: 'm_ok', text: '3' }),
        messageEvent({ mid: 'm_echo', is_echo: true }),
      ];
      await run([entryOf(events)]);

      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(sentRequests()[0].body.message.text, texts.SUPPORT);
      assert.deepEqual(ignoredReasons().sort(), ['echo', 'unsupported_event']);
    });

    test('ignored-event logs carry only the reason', async () => {
      await run([entryOf([messageEvent({ text: 'secret customer words', is_echo: true })])]);

      const [line] = logs.filter((entry) => entry.tag === '[Messenger] Ignored event');
      assert.deepEqual(JSON.parse(line.data), { reason: 'echo' });
      assertNoLeaks('secret customer words');
    });
  });

  describe('postbacks and duplicates', () => {
    test('the same postback mid delivered twice is answered once', async () => {
      const event = postbackEvent(orderProductPayload(product.id), { mid: 'm_pb_same' });
      await run([entryOf([event])]);
      await run([entryOf([event])]);

      assert.equal(sentRequests().length, 1);
      assert.deepEqual(ignoredReasons(), ['duplicate']);
    });

    test('without a mid, the same sender, time and payload count as one tap', async () => {
      const event = postbackEvent('MENU', { mid: undefined });
      await run([entryOf([event, event])]);

      assert.equal(sentRequests().length, 1);
      assert.deepEqual(ignoredReasons(), ['duplicate']);
    });

    test('without a mid, another time or another payload is a new tap', async () => {
      const first = postbackEvent('MENU', { mid: undefined });
      const later = { ...first, timestamp: first.timestamp + 1 };
      const other = postbackEvent('GET_STARTED', { mid: undefined });
      await run([entryOf([first, later, other])]);

      assert.equal(sentRequests().length, 3);
      assert.deepEqual(ignoredReasons(), []);
    });

    test('a postback without a payload sends nothing and does not use up its mid', async () => {
      await run([entryOf([baseEvent({ postback: { mid: 'm_pb_empty', title: 'x' } })])]);
      assert.equal(sentRequests().length, 0);
      assert.deepEqual(ignoredReasons(), ['no_payload']);

      await run([entryOf([baseEvent({ postback: { mid: 'm_pb_empty', title: 'x', payload: 'MENU' } })])]);
      assert.equal(sentRequests().length, 1);
    });

    test('a duplicate Confirm tap is answered once and creates one order', async () => {
      const draftId = await reachSummary();
      const confirm = postbackEvent(`CONFIRM_ORDER:${draftId}`, { mid: 'm_confirm' });
      await run([entryOf([confirm])]);
      await run([entryOf([confirm])]);
      await tap(`CONFIRM_ORDER:${draftId}`);

      assert.equal(orderStore.size(), 1);
      assert.equal(logged('[Order] Order created').length, 1);
    });
  });

  describe('product links (m.me ref)', () => {
    const link = orderProductPayload(product.id);
    const replyTexts = () => sentBodies().map((body) => body.message.text);
    const photoOf = (body) => body.message.attachment;
    // A link order starts with the product photo, then the quantity question.
    const assertPhotoThenQuestion = () => {
      const [photo, question] = sentBodies();
      assert.equal(sentBodies().length, 2);
      assert.deepEqual(photoOf(photo), { type: 'image', payload: { url: product.imageUrl } });
      assert.equal(question.message.text, texts.orderStart(product));
      assert.deepEqual(quickReplyPayloads(question), quick.QUANTITY.map((item) => item.payload));
    };

    test('opening the chat through a product link shows its photo and asks for the quantity', async () => {
      await run([entryOf([referralEvent(link)])]);

      assertPhotoThenQuestion();
      assert.deepEqual(logged('[AutoReply] Matching reply rule'), [
        { rule: 'order_start', step: STEPS.WAITING_FOR_QUANTITY },
      ]);
      assert.deepEqual(logged('[SendAPI] Reply sent successfully').map((data) => data.mode), ['photo']);
      const session = sessionStore.get(sessionKey);
      assert.equal(session.step, STEPS.WAITING_FOR_QUANTITY);
      assert.equal(session.productId, product.id);
      assert.equal(orderStore.size(), 0);
    });

    test('Get Started tapped by a new customer who came through a product link starts that order', async () => {
      await run([entryOf([postbackEvent('GET_STARTED', { referral: linkReferral(link) })])]);

      assertPhotoThenQuestion();
      assert.equal(sessionStore.get(sessionKey).productId, product.id);
    });

    test('a photo Meta cannot fetch is skipped and the quantity question still goes out', async () => {
      fetchMock.mock.mockImplementationOnce(async () =>
        graphError(400, { message: 'Failed to fetch the image', type: 'OAuthException', code: 100 }),
      );
      await run([entryOf([referralEvent(link)])]);

      assert.equal(sentBodies().length, 2);
      assert.equal(sentBodies()[1].message.text, texts.orderStart(product));
      assert.deepEqual(logged('[SendAPI] Product photo failed, text sent without it'), [
        { reason: 'graph_error', hint: 'invalid_parameter', code: 100 },
      ]);
      assert.deepEqual(logged('[SendAPI] Reply sent successfully').map((data) => data.mode), ['text_only']);
      assert.equal(sessionStore.get(sessionKey).step, STEPS.WAITING_FOR_QUANTITY);
    });

    test('tapping Order Now on a card sends no extra photo', async () => {
      await tap(link);
      assert.deepEqual(sentBodies().map(photoOf), [undefined]);
    });

    for (const ref of [undefined, '', 'summer_sale', 'MENU', 'ORDER_PRODUCT:', 'CONFIRM_ORDER:abc123']) {
      test(`Get Started with the ref ${JSON.stringify(ref)} gets the welcome menu`, async () => {
        await run([entryOf([postbackEvent('GET_STARTED', { referral: linkReferral(ref) })])]);
        assert.deepEqual(replyTexts(), [WELCOME_TEXT]);
      });
    }

    test('a product link in the middle of an order replaces the draft', async () => {
      await tap(orderProductPayload(firstPage.items[1].id));
      await say('2');
      await run([entryOf([referralEvent(link)])]);

      assert.equal(replyTexts().at(-1), texts.orderStart(product));
      const session = sessionStore.get(sessionKey);
      assert.equal(session.step, STEPS.WAITING_FOR_QUANTITY);
      assert.equal(session.productId, product.id);
      assert.equal(session.quantity, null);
    });

    test('a link to an unknown product says so and offers the menu', async () => {
      await run([entryOf([referralEvent(orderProductPayload('P999'))])]);

      assert.deepEqual(replyTexts(), [texts.PRODUCT_NOT_FOUND]);
      assert.deepEqual(quickReplyPayloads(sentBodies()[0]), quick.MENU.map((item) => item.payload));
      assert.equal(sessionStore.get(sessionKey).step, STEPS.IDLE);
    });

    for (const ref of [undefined, '', 'summer_sale', 'MENU', 'GET_STARTED', 'ORDER_PRODUCT:', 'QUANTITY:2', 42]) {
      test(`a link with the ref ${JSON.stringify(ref)} is not answered`, async () => {
        await run([entryOf([referralEvent(ref)])]);

        assert.equal(fetchMock.mock.callCount(), 0);
        assert.deepEqual(ignoredReasons(), ['unsupported_referral']);
        assert.equal(logged('[Messenger] Incoming customer message').length, 0);
      });
    }

    test('an ad referral without a ref is not answered', async () => {
      await run([entryOf([baseEvent({ referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '6045246247433' } })])]);
      assert.equal(fetchMock.mock.callCount(), 0);
      assert.deepEqual(ignoredReasons(), ['unsupported_referral']);
    });

    test('the same link click delivered twice is answered once', async () => {
      const event = referralEvent(link);
      await run([entryOf([event])]);
      await run([entryOf([event])]);

      assert.equal(sentRequests().length, 2); // one photo and one question
      assert.deepEqual(ignoredReasons(), ['duplicate']);
    });

    test('a later click on the same link is answered again', async () => {
      const first = referralEvent(link);
      await run([entryOf([first, { ...first, timestamp: first.timestamp + 1 }])]);

      assert.equal(sentRequests().length, 4);
      assert.deepEqual(ignoredReasons(), []);
    });

    test('a link from another sender to another Page is not answered', async () => {
      await run([entryOf([referralEvent(link)], '9999999999')]);
      await run([entryOf([referralEvent(link, { sender: { id: PAGE_ID } })])]);

      assert.equal(fetchMock.mock.callCount(), 0);
      assert.deepEqual(ignoredReasons(), ['page_mismatch', 'self_sender']);
    });

    test('a link click is logged as a referral with the payload type only, never the ref', async () => {
      await run([entryOf([referralEvent(link)])]);
      await run([entryOf([postbackEvent('GET_STARTED', { mid: 'm_gs_link', referral: linkReferral(link) })])]);

      assert.deepEqual(logged('[Messenger] Incoming customer message'), [
        {
          pageId: PAGE_ID,
          senderId: '…3456',
          mid: null,
          kind: 'referral',
          payloadType: 'ORDER_PRODUCT',
          textLength: 0,
          attachmentCount: 0,
        },
        {
          pageId: PAGE_ID,
          senderId: '…3456',
          mid: 'm_gs_link',
          kind: 'referral',
          payloadType: 'ORDER_PRODUCT',
          textLength: 0,
          attachmentCount: 0,
        },
      ]);
      assertNoLeaks(link, product.name);
    });
  });

  describe('sending in order', () => {
    const view = getCatalogPage(1);
    const replyList = [
      { kind: 'text', rule: 'welcome', text: 'first reply' },
      {
        kind: 'catalog',
        rule: 'catalog',
        products: view.items,
        page: 1,
        totalPages: view.totalPages,
        navText: 'navigation text',
        fallbackText: 'fallback text',
      },
      { kind: 'order_confirmation', rule: 'order_summary', text: 'summary text', draftId: 'abc123' },
    ];

    test('a reply list is sent one by one: text, catalog, order confirmation', async () => {
      mock.method(conversationService, 'handle', () => replyList);

      await say('anything');

      const bodies = sentBodies();
      assert.equal(bodies.length, 4);
      assert.equal(bodies[0].message.text, 'first reply');
      assert.equal(templateOf(bodies[1]).template_type, 'generic');
      assert.equal(bodies[2].message.text, 'navigation text');
      assert.equal(bodies[3].message.text, 'summary text');
      assert.deepEqual(quickReplyPayloads(bodies[3]), ['CONFIRM_ORDER:abc123', 'CANCEL_ORDER']);
      assert.deepEqual(
        logged('[SendAPI] Reply sent successfully').map(({ rule, mode }) => [rule, mode]),
        [
          ['welcome', undefined],
          ['catalog', 'template'],
          ['order_summary', 'quick_replies'],
        ],
      );
    });

    test('after the first failed send the rest of the list is dropped', async () => {
      mock.method(conversationService, 'handle', () => replyList);
      fetchMock.mock.mockImplementation(async () =>
        graphError(400, { message: 'bad token', type: 'OAuthException', code: 190, fbtrace_id: 'Atrace1' }),
      );

      await say('anything');

      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(logged('[SendAPI] Reply failed').length, 1);
      assert.deepEqual(logged('[AutoReply] Matching reply rule'), [{ rule: 'welcome', step: STEPS.IDLE }]);
      assert.equal(logged('[SendAPI] Reply sent successfully').length, 0);
    });

    test('a failure in the middle of the list stops the list there', async () => {
      mock.method(conversationService, 'handle', () => replyList);
      let calls = 0;
      fetchMock.mock.mockImplementation(async () => {
        calls += 1;
        return calls === 1 ? graphOk() : graphError(400, { message: 'x', code: 190 });
      });

      await say('anything');

      assert.equal(logged('[SendAPI] Reply sent successfully').length, 1);
      assert.equal(logged('[SendAPI] Reply failed')[0].rule, 'catalog');
      assert.ok(sentBodies().every((body) => body.message.text !== 'summary text'));
    });

    // A Graph mock whose sends stay pending until the test releases them. Releasing everything
    // in `finally` matters: the per-customer queue is shared, so a stuck send would block the
    // later tests of the same customer.
    function heldSends(shouldHold) {
      const releases = [];
      fetchMock.mock.mockImplementation((url, init) => {
        const { recipient } = JSON.parse(init.body);
        if (!shouldHold(recipient.id, releases.length)) return graphOk('m_not_held');
        return new Promise((resolve) => releases.push(() => resolve(graphOk('m_held'))));
      });
      return {
        releases,
        async untilHeld(count) {
          for (let turn = 0; turn < 100 && releases.length < count; turn += 1) {
            await new Promise((resolve) => setImmediate(resolve));
          }
          assert.ok(releases.length >= count, `expected ${count} held send(s)`);
        },
        releaseAll: () => releases.forEach((release) => release()),
      };
    }

    test('the events of one customer are answered in arrival order even when the first send is slow', async () => {
      const held = heldSends((psid, heldSoFar) => psid === PSID && heldSoFar === 0);
      try {
        const batch = run([entryOf([textEvent('hi'), textEvent('1')])]);
        await held.untilHeld(1);
        // A different customer is answered completely while the first customer's send is pending.
        await run([entryOf([textEvent('3', { sender: { id: OTHER_PSID } })])]);
        assert.deepEqual(sentTo(OTHER_PSID).map((body) => body.message.text), [texts.SUPPORT]);
        assert.equal(sentTo(PSID).length, 1, 'the second event waits for the first');

        held.releaseAll();
        await batch;

        const toCustomer = sentTo(PSID);
        assert.equal(toCustomer.length, 3);
        assert.equal(toCustomer[0].message.text, WELCOME_TEXT);
        assert.equal(templateOf(toCustomer[1]).template_type, 'generic');
        assert.equal(toCustomer[2].message.text, texts.catalogNav(view));
      } finally {
        held.releaseAll();
      }
    });

    test('events of one customer see each other\'s state in order', async () => {
      const held = heldSends(() => true);
      try {
        const batch = run([entryOf([postbackEvent(orderProductPayload(product.id)), textEvent('4')])]);
        await held.untilHeld(1);
        held.releases[0]();
        await held.untilHeld(2);
        held.releases[1]();
        await batch;

        assert.deepEqual(sentBodies().map((body) => body.message.text), [texts.orderStart(product), texts.ASK_PHONE]);
      } finally {
        held.releaseAll();
      }
    });

    test('a failed send for one event does not block the next event of that customer', async () => {
      let calls = 0;
      fetchMock.mock.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return graphOk('m_second');
      });

      await run([entryOf([textEvent('hi'), textEvent('3')])]);

      assert.equal(logged('[SendAPI] Reply failed').length, 1);
      assert.deepEqual(
        logged('[SendAPI] Reply sent successfully').map((data) => data.messageId),
        ['m_second'],
      );
    });
  });

  describe('switch and failures', () => {
    for (const value of ['false', '', undefined, 'yes', '1']) {
      test(`ENABLE_AUTO_REPLY=${JSON.stringify(value)} makes no calls and resolves`, async () => {
        if (value === undefined) delete process.env.ENABLE_AUTO_REPLY;
        else process.env.ENABLE_AUTO_REPLY = value;

        assert.equal(await run([entryOf([messageEvent()])]), undefined);
        assert.equal(fetchMock.mock.callCount(), 0);
        assert.deepEqual(logs, []);
      });
    }

    test('a Graph error (190) is logged with its hint and processEntries still resolves', async () => {
      fetchMock.mock.mockImplementation(async () =>
        graphError(400, {
          message: `Invalid OAuth access token ${TOKEN}`,
          type: 'OAuthException',
          code: 190,
          fbtrace_id: 'Atrace123',
        }),
      );

      assert.equal(await run([entryOf([messageEvent()])]), undefined);

      assert.equal(fetchMock.mock.callCount(), 1);
      const errors = logs.filter((line) => line.level === 'error');
      assert.equal(errors.length, 1);
      assert.equal(errors[0].tag, '[SendAPI] Reply failed');
      assert.deepEqual(JSON.parse(errors[0].data), {
        senderId: '…3456',
        rule: 'welcome',
        reason: 'graph_error',
        status: 400,
        code: 190,
        subcode: null,
        hint: 'invalid_access_token',
        fbtraceId: 'Atrace123',
      });
      assert.equal(logged('[SendAPI] Reply sent successfully').length, 0);
    });

    test('a non-JSON HTTP failure is logged as http_error', async () => {
      fetchMock.mock.mockImplementation(async () => new Response('Bad Gateway', { status: 502 }));

      await run([entryOf([messageEvent()])]);

      const [failure] = logged('[SendAPI] Reply failed');
      assert.equal(failure.reason, 'http_error');
      assert.equal(failure.status, 502);
      assert.equal(failure.hint, null);
    });

    test('a rejecting fetch is logged and processEntries still resolves', async () => {
      fetchMock.mock.mockImplementation(async () => {
        throw new TypeError(`fetch failed for ${TOKEN}`);
      });

      assert.equal(await run([entryOf([messageEvent()])]), undefined);

      const [failure] = logged('[SendAPI] Reply failed');
      assert.equal(failure.reason, 'network');
      assert.equal(failure.rule, 'welcome');
      assert.equal(failure.senderId, '…3456');
    });

    test('a timed-out fetch is logged as a timeout', async () => {
      fetchMock.mock.mockImplementation(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      });

      await run([entryOf([messageEvent()])]);

      assert.equal(logged('[SendAPI] Reply failed')[0].reason, 'timeout');
    });

    test('a failed send for one customer does not affect another', async () => {
      let calls = 0;
      fetchMock.mock.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return graphOk('m_reply_2');
      });
      const events = [
        messageEvent({ mid: 'm_a' }),
        messageEvent({ mid: 'm_b' }, { sender: { id: OTHER_PSID } }),
      ];

      await run([entryOf(events)]);

      assert.equal(logged('[SendAPI] Reply failed').length, 1);
      assert.deepEqual(
        logged('[SendAPI] Reply sent successfully').map((data) => data.messageId),
        ['m_reply_2'],
      );
    });

    test('an unexpected error in one event is logged by name and the others still run', async () => {
      const throwingCache = {
        markIfNew(mid) {
          if (mid === 'm_bad') throw new RangeError('boom with internal details');
          return true;
        },
      };
      const events = [messageEvent({ mid: 'm_bad' }), messageEvent({ mid: 'm_good', text: '3' })];

      assert.equal(await processEntries([entryOf(events)], { cache: throwingCache }), undefined);

      assert.deepEqual(logged('[AutoReply] Unexpected error'), [{ name: 'RangeError' }]);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(sentRequests()[0].body.message.text, texts.SUPPORT);
      for (const line of logs) assert.ok(!line.text.includes('boom with internal details'));
    });

    test('an error thrown by the conversation is contained and the queue keeps working', async () => {
      const handle = mock.method(conversationService, 'handle', () => {
        throw new EvalError('conversation exploded');
      });

      assert.equal(await say('hi'), undefined);
      assert.deepEqual(logged('[AutoReply] Unexpected error'), [{ name: 'EvalError' }]);
      assert.equal(fetchMock.mock.callCount(), 0);

      handle.mock.restore();
      await say('hi');
      assert.equal(fetchMock.mock.callCount(), 1);
    });

    test('an event that throws while being read is contained', async () => {
      const hostile = {
        get sender() {
          throw new SyntaxError('hostile getter');
        },
        recipient: { id: PAGE_ID },
      };
      await run([entryOf([hostile, messageEvent({ mid: 'm_after' })])]);

      assert.deepEqual(logged('[AutoReply] Unexpected error'), [{ name: 'SyntaxError' }]);
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  });

  describe('garbage input', () => {
    const garbage = [
      ['null', null],
      ['undefined', undefined],
      ['a string', 'x'],
      ['a number', 5],
      ['an object', { entry: [] }],
      ['an empty array', []],
      [
        'mixed junk',
        [null, 5, {}, { messaging: 'x' }, { id: PAGE_ID, messaging: [null, 7, {}] }, { id: PAGE_ID }],
      ],
    ];
    for (const [name, input] of garbage) {
      test(`${name} resolves without throwing or sending`, async () => {
        assert.equal(await run(input), undefined);
        assert.equal(fetchMock.mock.callCount(), 0);
        assert.equal(logged('[SendAPI] Reply failed').length, 0);
      });
    }

    test('junk events inside a page entry are ignored with a reason', async () => {
      await run([{ id: PAGE_ID, messaging: [null, 7, {}] }]);

      assert.deepEqual(ignoredReasons(), ['invalid_event', 'invalid_event', 'no_sender']);
    });

    test('bad options do not break it', async () => {
      assert.equal(await processEntries([entryOf([messageEvent({ mid: 'm_opt_null' })])], null), undefined);
      assert.equal(await processEntries([], undefined), undefined);
      assert.equal(await processEntries([entryOf([messageEvent()])], { cache: {} }), undefined);
      assert.deepEqual(logged('[AutoReply] Unexpected error'), [{ name: 'TypeError' }]);
    });
  });

  describe('logging', () => {
    test('uses the agreed tags and fields, and never logs secrets or message text', async () => {
      const customerText = 'my private words about 42 red sarees';
      await run([entryOf([messageEvent({ mid: 'm_log', text: customerText })])]);

      assert.deepEqual(logged('[Messenger] Incoming customer message'), [
        {
          pageId: PAGE_ID,
          senderId: '…3456',
          mid: 'm_log',
          kind: 'text',
          payloadType: null,
          textLength: customerText.length,
          attachmentCount: 0,
        },
      ]);
      assert.deepEqual(logged('[AutoReply] Matching reply rule'), [{ rule: 'fallback', step: 'IDLE' }]);
      assert.deepEqual(logged('[SendAPI] Reply sent successfully'), [
        { senderId: '…3456', rule: 'fallback', messageId: 'm_reply_1' },
      ]);
      assert.deepEqual(
        logs.map((line) => line.tag),
        [
          '[Messenger] Incoming customer message',
          '[AutoReply] Matching reply rule',
          '[SendAPI] Reply sent successfully',
        ],
      );
      assert.ok(logs.every((line) => line.level === 'log'));
      assertNoLeaks(customerText);
    });

    test('a postback is logged by kind and payload type, never by payload value', async () => {
      const payload = orderProductPayload(product.id);
      await run([entryOf([postbackEvent(payload, { mid: 'm_pb_log' })])]);

      assert.deepEqual(logged('[Messenger] Incoming customer message'), [
        {
          pageId: PAGE_ID,
          senderId: '…3456',
          mid: 'm_pb_log',
          kind: 'postback',
          payloadType: 'ORDER_PRODUCT',
          textLength: 0,
          attachmentCount: 0,
        },
      ]);
      assert.deepEqual(logged('[AutoReply] Matching reply rule'), [
        { rule: 'order_start', step: STEPS.WAITING_FOR_QUANTITY },
      ]);
      assertNoLeaks(payload, product.name);
    });

    test('a postback without a mid is logged with mid null', async () => {
      await run([entryOf([postbackEvent('MENU', { mid: undefined })])]);
      assert.equal(logged('[Messenger] Incoming customer message')[0].mid, null);
    });

    test('a quick reply is logged as quick_reply with the payload type only', async () => {
      await run([entryOf([quickReplyEvent(catalogPagePayload(2), 'Next ▶')])]);

      const [incoming] = logged('[Messenger] Incoming customer message');
      assert.equal(incoming.kind, 'quick_reply');
      assert.equal(incoming.payloadType, 'CATALOG_PAGE');
      assert.equal(incoming.textLength, 'Next ▶'.length);
      assertNoLeaks(catalogPagePayload(2));
    });

    test('an unknown payload is logged as "unknown" without its value', async () => {
      await run([entryOf([postbackEvent('SECRET_THING:abc123')])]);

      assert.equal(logged('[Messenger] Incoming customer message')[0].payloadType, 'unknown');
      assertNoLeaks('SECRET_THING', 'abc123');
    });

    test('logs the created order by id and amounts, with no phone number, address or psid', async () => {
      const draftId = await reachSummary();
      logs.length = 0;
      await tap(`CONFIRM_ORDER:${draftId}`);

      const [order] = orderStore.list();
      assert.deepEqual(logged('[Order] Order created'), [
        { orderId: order.id, productId: product.id, quantity: 3, subtotal: product.price * 3 },
      ]);
      assert.deepEqual(logged('[AutoReply] Matching reply rule'), [{ rule: 'order_confirmed', step: STEPS.IDLE }]);
      assertNoLeaks(PHONE, ADDRESS, draftId, '1712345678');
    });

    test('the whole order conversation never logs the phone number or the address', async () => {
      const draftId = await reachSummary();
      await tap(`CONFIRM_ORDER:${draftId}`);
      await say('2');

      assertNoLeaks(PHONE, ADDRESS, draftId, '1712345678', 'Tangail Sadar');
    });

    test('a failed carousel template is logged as a warning and the text fallback is used', async () => {
      fetchMock.mock.mockImplementation(async (url, init) => {
        const { message } = JSON.parse(init.body);
        return message.attachment
          ? graphError(400, { message: 'Invalid image', type: 'OAuthException', code: 100, fbtrace_id: 'Atr' })
          : graphOk('m_fallback');
      });

      await say('1');

      const bodies = sentBodies();
      assert.equal(bodies.length, 2);
      assert.equal(bodies[1].message.text, texts.catalogFallback(firstPage.items, 1, firstPage.totalPages));
      assert.deepEqual(logged('[SendAPI] Catalog template failed, text fallback used'), [
        { reason: 'graph_error', hint: 'invalid_parameter', code: 100 },
      ]);
      assert.deepEqual(logged('[SendAPI] Reply sent successfully'), [
        { senderId: '…3456', rule: 'catalog', messageId: 'm_fallback', mode: 'text_fallback' },
      ]);
      const warning = logs.find((line) => line.tag.startsWith('[SendAPI] Catalog template failed'));
      assert.equal(warning.level, 'warn');
      assert.equal(logs.filter((line) => line.level === 'error').length, 0);
    });

    test('a failed navigation message is logged as a warning and the carousel is not resent', async () => {
      let calls = 0;
      fetchMock.mock.mockImplementation(async () => {
        calls += 1;
        return calls === 1
          ? graphOk('m_carousel')
          : graphError(400, { message: 'gone', type: 'OAuthException', code: 551, fbtrace_id: 'Atr' });
      });

      await say('1');

      assert.equal(fetchMock.mock.callCount(), 2);
      assert.deepEqual(logged('[SendAPI] Catalog navigation failed'), [
        { reason: 'graph_error', hint: 'recipient_unavailable', code: 551 },
      ]);
      assert.deepEqual(logged('[SendAPI] Reply sent successfully'), [
        { senderId: '…3456', rule: 'catalog', messageId: 'm_carousel', mode: 'template' },
      ]);
      assert.equal(logs.find((line) => line.tag === '[SendAPI] Catalog navigation failed').level, 'warn');
    });

    test('the phone-number quick reply is answered like the typed number and never logged', async () => {
      await tap(orderProductPayload(product.id));
      await say('3');
      logs.length = 0;

      await run([entryOf([quickReplyEvent('+8801712345678', '+8801712345678')])]);

      assert.equal(sessionStore.get(sessionKey).phone, PHONE);
      assert.equal(sessionStore.get(sessionKey).step, STEPS.WAITING_FOR_ADDRESS);
      assert.deepEqual(logged('[AutoReply] Matching reply rule'), [{ rule: 'phone_ok', step: STEPS.WAITING_FOR_ADDRESS }]);
      const [incoming] = logged('[Messenger] Incoming customer message');
      assert.equal(incoming.kind, 'text');
      assert.equal(incoming.payloadType, null);
      assertNoLeaks(PHONE, '1712345678');
    });

    test('failure logs use console.error and keep secrets and message text out', async () => {
      const customerText = 'my private words about 42 red sarees';
      fetchMock.mock.mockImplementation(async () =>
        graphError(400, { message: `bad token ${TOKEN}`, type: 'OAuthException', code: 190, fbtrace_id: 'Atrace9' }),
      );

      await run([entryOf([messageEvent({ mid: 'm_log2', text: customerText })])]);

      const failures = logs.filter((line) => line.tag === '[SendAPI] Reply failed');
      assert.equal(failures.length, 1);
      assert.equal(failures[0].level, 'error');
      assert.equal(JSON.parse(failures[0].data).hint, 'invalid_access_token');
      assertNoLeaks(customerText);
    });
  });
});
