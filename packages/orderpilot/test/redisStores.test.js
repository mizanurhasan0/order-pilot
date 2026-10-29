import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRedisDedupeCache } from '../src/services/redisDedupeCache.js';
import { createRedisOrderStore } from '../src/store/redisOrderStore.js';
import { PREFERENCE_TTL_MS, createRedisPreferenceStore } from '../src/store/redisPreferenceStore.js';
import { createRedisSessionStore } from '../src/store/redisSessionStore.js';
import { PURGE_INTERVAL_MS, SESSION_TTL_MS, STEPS } from '../src/store/sessionStore.js';
import { createFakeRedis } from './fixtures/fakeRedis.js';

// The Redis stores against a small in-memory fake of the @upstash/redis commands they use.

function setup() {
  let time = 1_000_000;
  const clock = {
    now: () => time,
    advance(ms) {
      time += ms;
    },
  };
  const redis = createFakeRedis({ now: clock.now });
  return { clock, redis };
}

const orderData = (overrides = {}) => ({
  productId: 'P001',
  productName: 'Saree',
  quantity: 2,
  unitPrice: 500,
  currency: 'BDT',
  customerPsid: '1000000001',
  phone: '01712345678',
  address: 'House 12, Road 3, Tangail',
  ...overrides,
});

describe('createRedisOrderStore', () => {
  it('creates numbered pending orders and lists them newest first', async () => {
    const { redis } = setup();
    const store = createRedisOrderStore({ redis, now: () => new Date('2026-01-01T00:00:00Z') });

    const { order, created } = await store.create(orderData());
    assert.equal(created, true);
    assert.equal(order.id, 'ORD-1001');
    assert.equal(order.status, 'pending');
    assert.equal(order.subtotal, 1000);
    assert.equal(order.createdAt, '2026-01-01T00:00:00.000Z');

    await store.create(orderData({ customerPsid: '1000000002' }));
    assert.deepEqual((await store.list()).map((o) => o.id), ['ORD-1002', 'ORD-1001']);
    assert.deepEqual(await store.get('ORD-1001'), order);
    assert.equal(await store.size(), 2);
  });

  it('returns the existing order for a repeated idempotency key', async () => {
    const { redis } = setup();
    const store = createRedisOrderStore({ redis });

    const first = await store.create(orderData(), { idempotencyKey: 'draft-1' });
    const again = await store.create(orderData(), { idempotencyKey: 'draft-1' });
    assert.equal(again.created, false);
    assert.deepEqual(again.order, first.order);
    assert.deepEqual(await store.findByIdempotencyKey('draft-1'), first.order);
    assert.equal(await store.findByIdempotencyKey('draft-2'), null);
    assert.equal(await store.size(), 1);
  });

  it('two concurrent creates with one key make one order', async () => {
    const { redis } = setup();
    const store = createRedisOrderStore({ redis });

    const results = await Promise.all([
      store.create(orderData(), { idempotencyKey: 'tap' }),
      store.create(orderData(), { idempotencyKey: 'tap' }),
    ]);
    assert.deepEqual(results.map((r) => r.created).sort(), [false, true]);
    assert.equal(results[0].order.id, results[1].order.id);
    assert.equal((await store.list()).length, 1);
  });

  it('filters by status, updates status and lists a customer\'s latest orders', async () => {
    const { redis } = setup();
    const store = createRedisOrderStore({ redis });
    for (let i = 0; i < 4; i += 1) await store.create(orderData());
    await store.create(orderData({ customerPsid: 'someone-else' }));

    const updated = await store.updateStatus('ORD-1002', 'confirmed');
    assert.equal(updated.status, 'confirmed');
    assert.equal((await store.get('ORD-1002')).status, 'confirmed');
    assert.deepEqual((await store.list({ status: 'confirmed' })).map((o) => o.id), ['ORD-1002']);
    assert.equal(await store.updateStatus('ORD-9999', 'confirmed'), null);
    await assert.rejects(store.updateStatus('ORD-1001', 'shipped'), RangeError);
    await assert.rejects(store.list({ status: 'shipped' }), RangeError);

    const latest = await store.listByCustomer('1000000001', { limit: 3 });
    assert.deepEqual(latest.map((o) => o.id), ['ORD-1004', 'ORD-1003', 'ORD-1002']);
    assert.deepEqual(await store.listByCustomer('1000000001', { limit: 0 }), []);
  });

  it('rejects invalid order data like the memory store', async () => {
    const { redis } = setup();
    const store = createRedisOrderStore({ redis });
    await assert.rejects(store.create(orderData({ quantity: 0 })), TypeError);
    await assert.rejects(store.create(orderData(), { idempotencyKey: '' }), TypeError);
    assert.equal(await store.get(''), null);
    assert.equal(await store.size(), 0);
  });
});

describe('createRedisSessionStore', () => {
  const KEY = 'page-1:1000000001';

  it('starts as a default IDLE session and keeps patched fields', async () => {
    const { redis, clock } = setup();
    const sessions = createRedisSessionStore({ redis, now: clock.now });

    assert.equal((await sessions.get(KEY)).step, STEPS.IDLE);
    await sessions.update(KEY, { step: STEPS.WAITING_FOR_PHONE, quantity: 2, unknown: 'ignored' });
    const session = await sessions.get(KEY);
    assert.equal(session.step, STEPS.WAITING_FOR_PHONE);
    assert.equal(session.quantity, 2);
    assert.equal(session.expired, false);
    assert.equal('unknown' in session, false);
    await assert.rejects(sessions.update(KEY, { step: 'NOPE' }), RangeError);
  });

  it('reports an expired session once, then starts fresh', async () => {
    const { redis, clock } = setup();
    const sessions = createRedisSessionStore({ redis, now: clock.now });

    await sessions.update(KEY, { step: STEPS.WAITING_FOR_ADDRESS });
    clock.advance(SESSION_TTL_MS);
    assert.equal((await sessions.get(KEY)).expired, true);
    const next = await sessions.get(KEY);
    assert.equal(next.expired, false);
    assert.equal(next.step, STEPS.IDLE);
  });

  it('lets Redis drop the key after the TTL plus the purge interval', async () => {
    const { redis, clock } = setup();
    const sessions = createRedisSessionStore({ redis, now: clock.now });

    await sessions.update(KEY, { step: STEPS.WAITING_FOR_ADDRESS });
    clock.advance(SESSION_TTL_MS + PURGE_INTERVAL_MS);
    assert.equal(await redis.get(`orderpilot:session:${KEY}`), null);
    assert.equal((await sessions.get(KEY)).expired, false);
  });

  it('reset and delete forget the session', async () => {
    const { redis, clock } = setup();
    const sessions = createRedisSessionStore({ redis, now: clock.now });

    await sessions.update(KEY, { step: STEPS.WAITING_FOR_PHONE });
    assert.equal((await sessions.reset(KEY)).step, STEPS.IDLE);
    assert.equal((await sessions.get(KEY)).step, STEPS.IDLE);
    await sessions.update(KEY, { step: STEPS.WAITING_FOR_PHONE });
    assert.equal(await sessions.delete(KEY), true);
    assert.equal(await sessions.delete(KEY), false);
  });
});

describe('createRedisDedupeCache', () => {
  it('answers true once per key until the TTL has passed', async () => {
    const { redis, clock } = setup();
    // The fake reads time from the clock, so the TTL is checked against it.
    const cache = createRedisDedupeCache({ redis, ttlMs: 1000 });

    assert.equal(await cache.markIfNew('m_1'), true);
    assert.equal(await cache.markIfNew('m_1'), false);
    assert.equal(await cache.markIfNew('m_2'), true);
    clock.advance(1000);
    assert.equal(await cache.markIfNew('m_1'), true);
    assert.equal(await cache.markIfNew(''), false);
    assert.equal(await cache.markIfNew(undefined), false);
  });
});

describe('createRedisPreferenceStore', () => {
  it('remembers a language per conversation key for a year', async () => {
    const { clock, redis } = setup();
    const store = createRedisPreferenceStore({ redis });

    assert.equal(await store.getLanguage('page:1'), null);
    assert.equal(await store.setLanguage('page:1', 'en'), 'en');
    assert.equal(await store.getLanguage('page:1'), 'en');
    assert.equal(redis.strings.get('orderpilot:language:page:1').value, 'en');

    clock.advance(PREFERENCE_TTL_MS - 1);
    assert.equal(await store.getLanguage('page:1'), 'en');
    clock.advance(1);
    assert.equal(await store.getLanguage('page:1'), null);
  });

  it('rejects unknown languages and ignores a stored value it does not know', async () => {
    const { redis } = setup();
    const store = createRedisPreferenceStore({ redis });
    await assert.rejects(store.setLanguage('page:1', 'fr'), RangeError);
    await assert.rejects(store.setLanguage('', 'en'), TypeError);
    await redis.set('orderpilot:language:page:2', 'xx');
    assert.equal(await store.getLanguage('page:2'), null);
  });
});
