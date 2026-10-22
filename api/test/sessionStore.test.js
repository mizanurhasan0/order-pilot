import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  STEPS,
  SESSION_TTL_MS,
  PURGE_INTERVAL_MS,
  conversationKey,
  createSessionStore,
  sessionStore,
} from '../src/store/sessionStore.js';

const PAGE = '111222333';
const PSID = '5550001';
const KEY = conversationKey(PAGE, PSID);

// A controllable clock, so no test ever has to wait.
function createClock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    advance(ms) {
      time += ms;
    },
  };
}

function createStore(options = {}) {
  const clock = createClock();
  const store = createSessionStore({ now: clock.now, ...options });
  return { store, clock };
}

function defaults(overrides = {}) {
  return {
    step: 'IDLE',
    productId: null,
    page: 1,
    quantity: null,
    phone: null,
    address: null,
    draftId: null,
    expired: false,
    updatedAt: null,
    ...overrides,
  };
}

test('constants: the steps, the 30 minute ttl and the conversation key', () => {
  assert.deepEqual(Object.keys(STEPS), [
    'IDLE',
    'BROWSING_PRODUCTS',
    'WAITING_FOR_QUANTITY',
    'WAITING_FOR_SAVED_DETAILS',
    'WAITING_FOR_PHONE',
    'WAITING_FOR_ADDRESS',
    'WAITING_FOR_CONFIRMATION',
  ]);
  for (const [name, value] of Object.entries(STEPS)) assert.equal(value, name);
  assert.ok(Object.isFrozen(STEPS));
  assert.equal(SESSION_TTL_MS, 30 * 60 * 1000);
  assert.equal(conversationKey('page1', 'user2'), 'page1:user2');
});

test('get: an unknown key gives the default IDLE session and stores nothing', () => {
  const { store } = createStore();
  assert.deepEqual(store.get(KEY), defaults());
  assert.equal(store.size(), 0);
});

test('get: every default session is a new object', () => {
  const { store } = createStore();
  const first = store.get(KEY);
  first.step = STEPS.WAITING_FOR_PHONE;
  assert.deepEqual(store.get(KEY), defaults());
});

test('update: merges the patch into the defaults and stamps updatedAt', () => {
  const { store, clock } = createStore();
  const session = store.update(KEY, { step: STEPS.WAITING_FOR_QUANTITY, productId: 'P001' });

  assert.deepEqual(
    session,
    defaults({ step: 'WAITING_FOR_QUANTITY', productId: 'P001', updatedAt: clock.now() }),
  );
  assert.deepEqual(store.get(KEY), session);
});

test('update: later patches keep the fields they do not mention', () => {
  const { store, clock } = createStore();
  store.update(KEY, { step: STEPS.WAITING_FOR_QUANTITY, productId: 'P001', page: 3 });
  clock.advance(1000);
  const session = store.update(KEY, { step: STEPS.WAITING_FOR_PHONE, quantity: 2 });

  assert.equal(session.step, 'WAITING_FOR_PHONE');
  assert.equal(session.productId, 'P001');
  assert.equal(session.page, 3);
  assert.equal(session.quantity, 2);
  assert.equal(session.updatedAt, clock.now());
});

test('update: null clears a field, undefined leaves it alone', () => {
  const { store } = createStore();
  store.update(KEY, { phone: '01712345678', address: 'House 1, Road 2, Tangail' });
  const session = store.update(KEY, { phone: null, address: undefined });

  assert.equal(session.phone, null);
  assert.equal(session.address, 'House 1, Road 2, Tangail');
});

test('update: unknown fields, expired and updatedAt in a patch are ignored', () => {
  const { store, clock } = createStore();
  const session = store.update(KEY, {
    step: STEPS.BROWSING_PRODUCTS,
    admin: true,
    __proto__: { page: 9 },
    expired: true,
    updatedAt: 42,
  });

  assert.equal(session.step, 'BROWSING_PRODUCTS');
  assert.equal(session.expired, false);
  assert.equal(session.updatedAt, clock.now());
  assert.equal(session.page, 1);
  assert.equal('admin' in session, false);
  assert.deepEqual(Object.keys(session), Object.keys(defaults()));
  assert.equal('admin' in store.get(KEY), false);
});

test('update: an empty, missing or non-object patch only refreshes the session', () => {
  const { store, clock } = createStore();
  store.update(KEY, { quantity: 4 });
  clock.advance(500);

  for (const patch of [undefined, null, {}, 'text', 5]) {
    const session = store.update(KEY, patch);
    assert.equal(session.quantity, 4);
    assert.equal(session.updatedAt, clock.now());
  }
});

test('update: rejects a bad key or an unknown step and changes nothing', () => {
  const { store } = createStore();
  store.update(KEY, { step: STEPS.WAITING_FOR_PHONE });

  assert.throws(() => store.update('', { page: 2 }), TypeError);
  assert.throws(() => store.update(undefined, { page: 2 }), TypeError);
  assert.throws(() => store.update(KEY, { step: 'WAITING_FOR_NOTHING' }), RangeError);
  assert.throws(() => store.update(KEY, { step: null }), RangeError);

  assert.equal(store.get(KEY).step, 'WAITING_FOR_PHONE');
  assert.equal(store.get(KEY).page, 1);
  assert.equal(store.size(), 1);
});

test('copies: changing a returned session does not change the store', () => {
  const { store } = createStore();
  const returned = store.update(KEY, { step: STEPS.WAITING_FOR_PHONE, quantity: 2 });
  returned.step = STEPS.IDLE;
  returned.quantity = 99;
  returned.phone = 'tampered';

  const fetched = store.get(KEY);
  assert.equal(fetched.step, 'WAITING_FOR_PHONE');
  assert.equal(fetched.quantity, 2);
  assert.equal(fetched.phone, null);

  fetched.step = STEPS.WAITING_FOR_CONFIRMATION;
  fetched.address = 'tampered';
  assert.equal(store.get(KEY).step, 'WAITING_FOR_PHONE');
  assert.equal(store.get(KEY).address, null);
  assert.notEqual(store.get(KEY), store.get(KEY));
});

test('ttl: a session idle for just under ttlMs is still there', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update(KEY, { step: STEPS.WAITING_FOR_ADDRESS, phone: '01712345678' });
  clock.advance(999);

  const session = store.get(KEY);
  assert.equal(session.step, 'WAITING_FOR_ADDRESS');
  assert.equal(session.phone, '01712345678');
  assert.equal(session.expired, false);
  assert.equal(store.size(), 1);
});

test('ttl: a session idle for exactly ttlMs is expired and its data is gone', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update(KEY, { step: STEPS.WAITING_FOR_ADDRESS, phone: '01712345678' });
  clock.advance(1000);

  assert.deepEqual(store.get(KEY), defaults({ expired: true }));
  assert.equal(store.size(), 0);
});

test('ttl: the default is 30 minutes', () => {
  const clock = createClock();
  const store = createSessionStore({ now: clock.now });
  store.update(KEY, { step: STEPS.WAITING_FOR_PHONE });

  clock.advance(SESSION_TTL_MS - 1);
  assert.equal(store.get(KEY).step, 'WAITING_FOR_PHONE');
  clock.advance(1);
  assert.equal(store.get(KEY).expired, true);
});

test('expired: true is delivered exactly once', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update(KEY, { step: STEPS.WAITING_FOR_QUANTITY, productId: 'P001' });
  clock.advance(5000);

  assert.equal(store.get(KEY).expired, true);
  assert.deepEqual(store.get(KEY), defaults());
  assert.deepEqual(store.get(KEY), defaults());
});

test('expired: counting sessions does not swallow the expired notice', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update(KEY, { step: STEPS.WAITING_FOR_QUANTITY });
  clock.advance(1000);

  assert.equal(store.size(), 0);
  assert.equal(store.get(KEY).expired, true);
});

test('expired: updating an expired session starts from the defaults', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update(KEY, { step: STEPS.WAITING_FOR_PHONE, productId: 'P001', quantity: 3 });
  clock.advance(1000);

  const session = store.update(KEY, { step: STEPS.BROWSING_PRODUCTS });
  assert.deepEqual(session, defaults({ step: 'BROWSING_PRODUCTS', updatedAt: clock.now() }));
  assert.equal(store.get(KEY).expired, false);
});

test('ttl: update refreshes the TTL', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update(KEY, { step: STEPS.WAITING_FOR_QUANTITY });
  clock.advance(900);
  store.update(KEY, { quantity: 2 });
  clock.advance(900);

  const session = store.get(KEY);
  assert.equal(session.expired, false);
  assert.equal(session.quantity, 2);

  clock.advance(100);
  assert.equal(store.get(KEY).expired, true);
});

test('ttl: reading a session does not refresh the TTL', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update(KEY, { step: STEPS.WAITING_FOR_QUANTITY });
  clock.advance(900);
  assert.equal(store.get(KEY).step, 'WAITING_FOR_QUANTITY');
  clock.advance(100);

  assert.equal(store.get(KEY).expired, true);
});

test('isolation: two keys never share state', () => {
  const { store } = createStore();
  const keyA = conversationKey(PAGE, 'customer-a');
  const keyB = conversationKey(PAGE, 'customer-b');

  store.update(keyA, { step: STEPS.WAITING_FOR_PHONE, productId: 'P001', quantity: 2 });
  store.update(keyB, { step: STEPS.WAITING_FOR_ADDRESS, productId: 'P002', quantity: 5 });

  assert.equal(store.get(keyA).productId, 'P001');
  assert.equal(store.get(keyA).quantity, 2);
  assert.equal(store.get(keyB).productId, 'P002');
  assert.equal(store.get(keyB).quantity, 5);

  store.reset(keyA);
  assert.deepEqual(store.get(keyA), defaults());
  assert.equal(store.get(keyB).step, 'WAITING_FOR_ADDRESS');
});

test('isolation: the same PSID on two pages has two separate sessions', () => {
  const { store } = createStore();
  const onPageOne = conversationKey('page-1', PSID);
  const onPageTwo = conversationKey('page-2', PSID);

  store.update(onPageOne, { step: STEPS.WAITING_FOR_QUANTITY, productId: 'P001' });

  assert.deepEqual(store.get(onPageTwo), defaults());
  store.update(onPageTwo, { step: STEPS.BROWSING_PRODUCTS, page: 4 });

  assert.equal(store.get(onPageOne).step, 'WAITING_FOR_QUANTITY');
  assert.equal(store.get(onPageOne).page, 1);
  assert.equal(store.get(onPageTwo).step, 'BROWSING_PRODUCTS');
  assert.equal(store.get(onPageTwo).page, 4);
  assert.equal(store.size(), 2);
});

test('isolation: expiry of one session does not touch the others', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  const keyA = conversationKey(PAGE, 'a');
  const keyB = conversationKey(PAGE, 'b');

  store.update(keyA, { step: STEPS.WAITING_FOR_PHONE });
  clock.advance(600);
  store.update(keyB, { step: STEPS.WAITING_FOR_PHONE });
  clock.advance(500);

  assert.equal(store.get(keyA).expired, true);
  assert.equal(store.get(keyB).step, 'WAITING_FOR_PHONE');
});

test('maxSessions: the oldest session is evicted first', () => {
  const { store, clock } = createStore({ maxSessions: 3 });
  for (const id of ['a', 'b', 'c', 'd']) {
    store.update(id, { step: STEPS.BROWSING_PRODUCTS });
    clock.advance(1);
  }

  assert.equal(store.size(), 3);
  assert.equal(store.get('a').step, 'IDLE');
  for (const id of ['b', 'c', 'd']) assert.equal(store.get(id).step, 'BROWSING_PRODUCTS');
});

test('maxSessions: updating a session makes it the most recent, not the oldest', () => {
  const { store, clock } = createStore({ maxSessions: 3 });
  for (const id of ['a', 'b', 'c']) {
    store.update(id, { step: STEPS.BROWSING_PRODUCTS });
    clock.advance(1);
  }
  store.update('a', { page: 2 });
  clock.advance(1);
  store.update('d', { step: STEPS.BROWSING_PRODUCTS });

  assert.equal(store.size(), 3);
  assert.equal(store.get('b').step, 'IDLE');
  assert.equal(store.get('a').page, 2);
  assert.equal(store.get('c').step, 'BROWSING_PRODUCTS');
  assert.equal(store.get('d').step, 'BROWSING_PRODUCTS');
});

test('maxSessions: updating an existing key never evicts anyone', () => {
  const { store } = createStore({ maxSessions: 2 });
  store.update('a', { step: STEPS.BROWSING_PRODUCTS });
  store.update('b', { step: STEPS.BROWSING_PRODUCTS });
  store.update('b', { page: 2 });
  store.update('a', { page: 2 });

  assert.equal(store.size(), 2);
  assert.equal(store.get('a').page, 2);
  assert.equal(store.get('b').page, 2);
});

test('maxSessions: the default limit is large and many sessions fit', () => {
  const { store } = createStore();
  for (let i = 0; i < 500; i += 1) store.update(`key-${i}`, { page: 2 });
  assert.equal(store.size(), 500);
});

test('reset and delete: forget a session', () => {
  const { store } = createStore();
  store.update(KEY, { step: STEPS.WAITING_FOR_PHONE, quantity: 2 });

  assert.deepEqual(store.reset(KEY), defaults());
  assert.deepEqual(store.get(KEY), defaults());
  assert.equal(store.size(), 0);

  store.update(KEY, { step: STEPS.WAITING_FOR_PHONE });
  assert.equal(store.delete(KEY), true);
  assert.equal(store.delete(KEY), false);
  assert.deepEqual(store.get(KEY), defaults());
});

test('reset: resetting an unknown key is harmless', () => {
  const { store } = createStore();
  assert.doesNotThrow(() => store.reset('nobody'));
  assert.equal(store.size(), 0);
});

test('purgeExpired: removes only expired sessions and returns how many', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update('old-1', { step: STEPS.WAITING_FOR_PHONE });
  clock.advance(100);
  store.update('old-2', { step: STEPS.WAITING_FOR_PHONE });
  clock.advance(500);
  store.update('fresh', { step: STEPS.WAITING_FOR_PHONE });
  clock.advance(450);

  // Only old-1 is 1000 ms old.
  assert.equal(store.purgeExpired(), 1);
  assert.equal(store.size(), 2);

  clock.advance(100);
  assert.equal(store.purgeExpired(), 1);
  assert.equal(store.size(), 1);
  assert.equal(store.get('fresh').step, 'WAITING_FOR_PHONE');
  assert.equal(store.purgeExpired(), 0);
});

test('purgeExpired: a purged session reads as a plain default, not as expired', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update(KEY, { step: STEPS.WAITING_FOR_PHONE });
  clock.advance(1000);
  store.purgeExpired();

  assert.deepEqual(store.get(KEY), defaults());
});

test('size and clear: size counts live sessions and clear forgets all of them', () => {
  const { store, clock } = createStore({ ttlMs: 1000 });
  store.update('a', { page: 2 });
  clock.advance(600);
  store.update('b', { page: 2 });
  assert.equal(store.size(), 2);

  clock.advance(400);
  assert.equal(store.size(), 1);

  store.clear();
  assert.equal(store.size(), 0);
  assert.deepEqual(store.get('b'), defaults());
});

test('options: invalid ttlMs or maxSessions are rejected', () => {
  assert.throws(() => createSessionStore({ ttlMs: 0 }), RangeError);
  assert.throws(() => createSessionStore({ ttlMs: -5 }), RangeError);
  assert.throws(() => createSessionStore({ ttlMs: '1000' }), RangeError);
  assert.throws(() => createSessionStore({ maxSessions: 0 }), RangeError);
  assert.throws(() => createSessionStore({ maxSessions: 1.5 }), RangeError);
});

test('autoPurge: off by default, so no timer is created', () => {
  const setIntervalMock = mock.method(globalThis, 'setInterval');
  try {
    const store = createSessionStore();
    store.stop();
    assert.equal(setIntervalMock.mock.callCount(), 0);
  } finally {
    setIntervalMock.mock.restore();
  }
});

test('autoPurge: the timer is unref\'d, runs every 5 minutes and stop() clears it', () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const created = [];
  const cleared = [];
  globalThis.setInterval = (...args) => {
    const timer = originalSetInterval(...args);
    created.push({ timer, delay: args[1], hasRefRightAfterCreate: timer.hasRef() });
    return timer;
  };
  globalThis.clearInterval = (timer) => {
    cleared.push(timer);
    return originalClearInterval(timer);
  };

  let store;
  try {
    store = createSessionStore({ autoPurge: true });
    assert.equal(created.length, 1);
    assert.equal(created[0].delay, PURGE_INTERVAL_MS);
    assert.equal(PURGE_INTERVAL_MS, 5 * 60 * 1000);
    // hasRef() false means the timer cannot keep the process (or test run) alive.
    assert.equal(created[0].timer.hasRef(), false);

    store.stop();
    assert.deepEqual(cleared, [created[0].timer]);

    // Stopping twice is harmless and does not clear anything again.
    store.stop();
    assert.equal(cleared.length, 1);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (store) store.stop();
    for (const { timer } of created) originalClearInterval(timer);
  }
});

test('autoPurge: every tick removes expired sessions', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const clock = createClock();
  const store = createSessionStore({ autoPurge: true, ttlMs: 1000, now: clock.now });
  try {
    store.update('a', { step: STEPS.WAITING_FOR_PHONE });
    clock.advance(PURGE_INTERVAL_MS);
    mock.timers.tick(PURGE_INTERVAL_MS);

    // Purged by the timer: no expired notice is left behind.
    assert.deepEqual(store.get('a'), defaults());
  } finally {
    store.stop();
    mock.timers.reset();
  }
});

test('autoPurge: after stop() the timer no longer purges', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const clock = createClock();
  const store = createSessionStore({ autoPurge: true, ttlMs: 1000, now: clock.now });
  try {
    store.update('a', { step: STEPS.WAITING_FOR_PHONE });
    store.stop();
    clock.advance(PURGE_INTERVAL_MS);
    mock.timers.tick(PURGE_INTERVAL_MS);

    // Not purged, so the expired notice is still waiting for the customer.
    assert.equal(store.get('a').expired, true);
  } finally {
    store.stop();
    mock.timers.reset();
  }
});

test('singleton: sessionStore uses the same API with the real clock', () => {
  try {
    const key = conversationKey('singleton-page', 'singleton-psid');
    assert.deepEqual(Object.keys(sessionStore).sort(), [
      'clear',
      'delete',
      'get',
      'purgeExpired',
      'reset',
      'size',
      'stop',
      'update',
    ]);
    const session = sessionStore.update(key, { step: STEPS.BROWSING_PRODUCTS, page: 2 });
    assert.equal(typeof session.updatedAt, 'number');
    assert.equal(sessionStore.get(key).page, 2);
  } finally {
    sessionStore.clear();
    sessionStore.stop();
  }
});

test('importing the module leaves no timer that keeps the process alive', () => {
  const moduleUrl = new URL('../src/store/sessionStore.js', import.meta.url).href;
  const script = `import(${JSON.stringify(moduleUrl)}).then(() => console.log('imported'))`;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 20_000,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  });

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'imported');
});
