import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import { errorHandler, notFound } from '../src/middleware/errors.js';
import { createOrdersRouter } from '../src/routes/orders.js';
import { createOrderStore } from 'orderpilot-messenger-bot';

// Integration test: the REAL orders router on a tiny Express app on a random port,
// with its own isolated store, and the app's own 404 and error handlers.

const ADMIN_KEY = 'TEST_ADMIN_KEY_0123456789abcdef';
const PHONE = '01712345678';
const ADDRESS = 'House 7, Road 3, Tangail Sadar';

let server;
let baseUrl;
let store;
let savedKey;

// The router keeps one store for its whole life, so it gets this stand-in, which
// forwards to whichever fresh store the current test uses (ids restart at ORD-1001).
const storeForRouter = new Proxy(
  {},
  { get: (target, method) => (...args) => store[method](...args) },
);

const orderData = (overrides = {}) => ({
  productId: 'P001',
  productName: 'Test Saree',
  quantity: 2,
  unitPrice: 1500,
  currency: 'BDT',
  customerPsid: '1111111111',
  phone: PHONE,
  address: ADDRESS,
  ...overrides,
});

before(async () => {
  const app = express();
  app.use('/api/orders', createOrdersRouter({ store: storeForRouter }));
  app.use(notFound);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
});

beforeEach(() => {
  savedKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  store = createOrderStore();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = savedKey;
});

// Sends a request and returns { status, body, text }. Sends the admin key unless key === null.
async function call(method, path, { key = ADMIN_KEY, json, raw, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (key !== null) requestHeaders['x-admin-key'] = key;
  let body;
  if (json !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (raw !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    body = raw;
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers: requestHeaders, body });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed, text };
}

describe('authentication', () => {
  const routes = [
    ['GET', '/api/orders'],
    ['GET', '/api/orders?status=pending'],
    ['GET', '/api/orders/ORD-1001'],
    ['GET', '/api/orders/does/not/exist'],
    ['GET', '/api/orders/ORD-1001/status'],
    ['PATCH', '/api/orders/ORD-1001/status'],
    ['PATCH', '/api/orders/ORD-9999/status'],
    ['POST', '/api/orders'],
    ['DELETE', '/api/orders/ORD-1001'],
    ['PUT', '/api/orders/ORD-1001'],
  ];

  it('answers 401 without a key on every route, including unknown sub-paths', async () => {
    store.create(orderData());
    for (const [method, path] of routes) {
      const res = await call(method, path, { key: null, json: method === 'PATCH' ? { status: 'confirmed' } : undefined });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.deepEqual(res.body, { success: false, message: 'Unauthorized' }, `${method} ${path}`);
    }
    assert.equal(store.get('ORD-1001').status, 'pending');
  });

  it('answers 401 for a wrong key and never echoes it', async () => {
    store.create(orderData());
    const wrong = 'WRONG_KEY_SHOULD_NOT_APPEAR';
    for (const [method, path] of routes) {
      const res = await call(method, path, { key: wrong });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.deepEqual(res.body, { success: false, message: 'Unauthorized' }, `${method} ${path}`);
      assert.equal(res.text.includes(wrong), false);
      assert.equal(res.text.includes(ADMIN_KEY), false);
    }
  });

  it('answers 401 for every request when the server key is not set', async () => {
    delete process.env.ADMIN_API_KEY;
    for (const key of ['', 'undefined', ADMIN_KEY]) {
      const res = await call('GET', '/api/orders', { key });
      assert.equal(res.status, 401);
    }
  });

  it('checks the key before reading the body (bad JSON without a key is still 401)', async () => {
    const res = await call('PATCH', '/api/orders/ORD-1001/status', { key: null, raw: '{not json' });
    assert.equal(res.status, 401);
  });

  it('keeps customer data away from requests without the key', async () => {
    store.create(orderData());
    const res = await call('GET', '/api/orders', { key: null });
    assert.equal(res.text.includes(PHONE), false);
    assert.equal(res.text.includes(ADDRESS), false);
  });
});

describe('GET /api/orders', () => {
  it('returns an empty list for an empty store', async () => {
    const res = await call('GET', '/api/orders');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, count: 0, data: [] });
  });

  it('returns every order newest first, with full phone and address behind the key', async () => {
    store.create(orderData());
    store.create(orderData({ productName: 'Second' }));
    const res = await call('GET', '/api/orders');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.count, 2);
    assert.deepEqual(res.body.data.map((order) => order.id), ['ORD-1002', 'ORD-1001']);
    assert.equal(res.body.data[0].phone, PHONE);
    assert.equal(res.body.data[0].address, ADDRESS);
    assert.equal(res.body.data[0].subtotal, 3000);
    assert.equal(res.body.data[0].status, 'pending');
  });

  it('filters by status', async () => {
    store.create(orderData());
    store.create(orderData());
    store.updateStatus('ORD-1001', 'confirmed');
    const pending = await call('GET', '/api/orders?status=pending');
    assert.equal(pending.status, 200);
    assert.equal(pending.body.count, 1);
    assert.equal(pending.body.data[0].id, 'ORD-1002');
    const confirmed = await call('GET', '/api/orders?status=confirmed');
    assert.deepEqual(confirmed.body.data.map((order) => order.id), ['ORD-1001']);
    const cancelled = await call('GET', '/api/orders?status=cancelled');
    assert.deepEqual(cancelled.body, { success: true, count: 0, data: [] });
  });

  it('answers 400 for an invalid status filter', async () => {
    for (const query of ['status=shipped', 'status=', 'status=PENDING', 'status=pending&status=confirmed']) {
      const res = await call('GET', `/api/orders?${query}`);
      assert.equal(res.status, 400, query);
      assert.equal(res.body.success, false);
      assert.equal(typeof res.body.message, 'string');
    }
  });
});

describe('GET /api/orders/:id', () => {
  it('returns the order', async () => {
    store.create(orderData());
    const res = await call('GET', '/api/orders/ORD-1001');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, 'ORD-1001');
    assert.equal(res.body.data.phone, PHONE);
    assert.equal(res.body.data.address, ADDRESS);
  });

  it('answers 404 for an unknown id', async () => {
    const res = await call('GET', '/api/orders/ORD-9999');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { success: false, message: 'Order not found' });
  });
});

describe('PATCH /api/orders/:id/status', () => {
  it('changes the status', async () => {
    store.create(orderData());
    const res = await call('PATCH', '/api/orders/ORD-1001/status', { json: { status: 'confirmed' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, 'ORD-1001');
    assert.equal(res.body.data.status, 'confirmed');
    assert.equal(store.get('ORD-1001').status, 'confirmed');

    const again = await call('PATCH', '/api/orders/ORD-1001/status', { json: { status: 'cancelled' } });
    assert.equal(again.body.data.status, 'cancelled');
  });

  it('answers 400 for a missing or invalid status', async () => {
    store.create(orderData());
    const bodies = [{}, { status: 'shipped' }, { status: '' }, { status: 5 }, { status: null }, { status: ['pending'] }, { state: 'confirmed' }];
    for (const json of bodies) {
      const res = await call('PATCH', '/api/orders/ORD-1001/status', { json });
      assert.equal(res.status, 400, JSON.stringify(json));
      assert.equal(res.body.success, false);
    }
    assert.equal(store.get('ORD-1001').status, 'pending');
  });

  it('answers 400 for a missing body or a body that is not an object', async () => {
    store.create(orderData());
    const noBody = await call('PATCH', '/api/orders/ORD-1001/status');
    assert.equal(noBody.status, 400);
    for (const raw of ['[]', '"confirmed"', '42', 'null', 'true']) {
      const res = await call('PATCH', '/api/orders/ORD-1001/status', { raw });
      assert.equal(res.status, 400, raw);
      assert.equal(res.body.success, false);
    }
    assert.equal(store.get('ORD-1001').status, 'pending');
  });

  it('answers 400 for malformed JSON without echoing the body', async () => {
    store.create(orderData());
    const res = await call('PATCH', '/api/orders/ORD-1001/status', { raw: '{"status": "confirmed", SECRET_BODY_TEXT' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { success: false, message: 'Bad request' });
    assert.equal(res.text.includes('SECRET_BODY_TEXT'), false);
  });

  it('answers 413 for a body larger than 10 kb', async () => {
    store.create(orderData());
    const res = await call('PATCH', '/api/orders/ORD-1001/status', { json: { status: 'confirmed', padding: 'x'.repeat(11 * 1024) } });
    assert.equal(res.status, 413);
    assert.equal(store.get('ORD-1001').status, 'pending');
  });

  it('answers 404 for an unknown id', async () => {
    const res = await call('PATCH', '/api/orders/ORD-9999/status', { json: { status: 'confirmed' } });
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { success: false, message: 'Order not found' });
  });
});

describe('other requests with a valid key', () => {
  it('fall through to the 404 handler', async () => {
    for (const [method, path] of [['POST', '/api/orders'], ['DELETE', '/api/orders/ORD-1001'], ['GET', '/api/orders/a/b/c']]) {
      const res = await call(method, path);
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.deepEqual(res.body, { success: false, message: 'Not found' });
    }
  });
});
