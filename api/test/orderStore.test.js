import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ORDER_STATUSES, createOrderStore, orderStore } from '../src/store/orderStore.js';

// Unit tests for the in-memory order store. Each test uses its own store and a fake clock.

const orderData = (overrides = {}) => ({
  productId: 'P001',
  productName: 'Test Saree',
  quantity: 2,
  unitPrice: 1500,
  currency: 'BDT',
  customerPsid: '1111111111',
  phone: '01712345678',
  address: 'House 1, Road 2, Tangail',
  ...overrides,
});

let store;
let tick;

beforeEach(() => {
  tick = 0;
  // Every call moves the clock forward one second, so createdAt values are distinct and ordered.
  store = createOrderStore({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) });
});

describe('ORDER_STATUSES', () => {
  it('lists the allowed statuses and is frozen', () => {
    assert.deepEqual([...ORDER_STATUSES], ['pending', 'confirmed', 'cancelled']);
    assert.ok(Object.isFrozen(ORDER_STATUSES));
  });
});

describe('create', () => {
  it('stores a pending order with a price snapshot and a computed subtotal', () => {
    const { order, created } = store.create(orderData());
    assert.equal(created, true);
    assert.deepEqual(order, {
      id: 'ORD-1001',
      productId: 'P001',
      productName: 'Test Saree',
      quantity: 2,
      unitPrice: 1500,
      subtotal: 3000,
      currency: 'BDT',
      customerPsid: '1111111111',
      phone: '01712345678',
      address: 'House 1, Road 2, Tangail',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(store.size(), 1);
  });

  it('does not store extra fields or react to later changes of the input', () => {
    const data = orderData({ deliveryCharge: 60 });
    const { order } = store.create(data);
    data.unitPrice = 1;
    data.productName = 'Changed';
    assert.equal('deliveryCharge' in order, false);
    assert.equal(store.get(order.id).unitPrice, 1500);
    assert.equal(store.get(order.id).productName, 'Test Saree');
  });

  it('gives increasing ids that are never reused, even after clear()', () => {
    assert.equal(store.create(orderData()).order.id, 'ORD-1001');
    assert.equal(store.create(orderData()).order.id, 'ORD-1002');
    store.clear();
    assert.equal(store.size(), 0);
    assert.equal(store.create(orderData()).order.id, 'ORD-1003');
  });

  it('does not use an id for a rejected order', () => {
    assert.throws(() => store.create(orderData({ quantity: 0 })), TypeError);
    assert.equal(store.create(orderData()).order.id, 'ORD-1001');
  });

  it('returns the existing order when the idempotency key is used again', () => {
    const first = store.create(orderData(), { idempotencyKey: 'draft-1' });
    const second = store.create(orderData({ quantity: 5 }), { idempotencyKey: 'draft-1' });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.deepEqual(second.order, first.order);
    assert.equal(second.order.quantity, 2);
    assert.equal(store.size(), 1);
    // The next new order still gets the next id.
    assert.equal(store.create(orderData(), { idempotencyKey: 'draft-2' }).order.id, 'ORD-1002');
  });

  it('creates separate orders when no idempotency key is given', () => {
    store.create(orderData());
    store.create(orderData());
    assert.equal(store.size(), 2);
  });

  it('forgets idempotency keys on clear()', () => {
    store.create(orderData(), { idempotencyKey: 'draft-1' });
    store.clear();
    assert.equal(store.findByIdempotencyKey('draft-1'), null);
    const again = store.create(orderData(), { idempotencyKey: 'draft-1' });
    assert.equal(again.created, true);
    assert.equal(again.order.id, 'ORD-1002');
  });

  it('throws a TypeError for missing or invalid fields', () => {
    const bad = [
      ['productId', undefined],
      ['productId', ''],
      ['productId', 5],
      ['productName', '   '],
      ['currency', null],
      ['customerPsid', ''],
      ['phone', undefined],
      ['address', ''],
      ['quantity', 0],
      ['quantity', -1],
      ['quantity', 1.5],
      ['quantity', '2'],
      ['quantity', Number.NaN],
      ['unitPrice', 0],
      ['unitPrice', 10.5],
      ['unitPrice', '100'],
      ['unitPrice', Infinity],
    ];
    for (const [field, value] of bad) {
      assert.throws(
        () => store.create(orderData({ [field]: value })),
        TypeError,
        `${field}=${String(value)} should be rejected`,
      );
    }
    for (const data of [undefined, null, 'order', [], 42]) {
      assert.throws(() => store.create(data), TypeError);
    }
    assert.equal(store.size(), 0);
  });

  it('throws a TypeError for an invalid idempotency key', () => {
    for (const idempotencyKey of ['', '   ', 5, null]) {
      assert.throws(() => store.create(orderData(), { idempotencyKey }), TypeError);
    }
    assert.equal(store.size(), 0);
  });
});

describe('copies', () => {
  it('never hands out references to stored orders', () => {
    const { order } = store.create(orderData(), { idempotencyKey: 'k' });
    order.status = 'cancelled';
    order.phone = 'changed';

    const fromGet = store.get(order.id);
    assert.equal(fromGet.status, 'pending');
    assert.equal(fromGet.phone, '01712345678');
    fromGet.status = 'confirmed';

    store.list()[0].status = 'confirmed';
    store.listByCustomer('1111111111')[0].status = 'confirmed';
    store.findByIdempotencyKey('k').status = 'confirmed';
    store.updateStatus(order.id, 'confirmed').phone = 'changed';
    store.create(orderData(), { idempotencyKey: 'k' }).order.status = 'cancelled';

    const after = store.get(order.id);
    assert.equal(after.status, 'confirmed');
    assert.equal(after.phone, '01712345678');
  });
});

describe('get and findByIdempotencyKey', () => {
  it('return null for unknown values', () => {
    assert.equal(store.get('ORD-9999'), null);
    assert.equal(store.get(undefined), null);
    assert.equal(store.findByIdempotencyKey('missing'), null);
    assert.equal(store.findByIdempotencyKey(undefined), null);
  });

  it('find the order created with a key', () => {
    const { order } = store.create(orderData(), { idempotencyKey: 'draft-1' });
    assert.deepEqual(store.findByIdempotencyKey('draft-1'), order);
    assert.deepEqual(store.get(order.id), order);
  });
});

describe('list', () => {
  it('returns every order newest first', () => {
    store.create(orderData());
    store.create(orderData());
    store.create(orderData());
    assert.deepEqual(
      store.list().map((order) => order.id),
      ['ORD-1003', 'ORD-1002', 'ORD-1001'],
    );
  });

  it('filters by status', () => {
    store.create(orderData());
    store.create(orderData());
    store.create(orderData());
    store.updateStatus('ORD-1002', 'confirmed');
    store.updateStatus('ORD-1001', 'cancelled');
    assert.deepEqual(store.list({ status: 'pending' }).map((order) => order.id), ['ORD-1003']);
    assert.deepEqual(store.list({ status: 'confirmed' }).map((order) => order.id), ['ORD-1002']);
    assert.deepEqual(store.list({ status: 'cancelled' }).map((order) => order.id), ['ORD-1001']);
    assert.equal(store.list().length, 3);
  });

  it('returns an empty array for an empty store', () => {
    assert.deepEqual(store.list(), []);
    assert.deepEqual(store.list({ status: 'pending' }), []);
  });

  it('throws a RangeError for an unknown status filter', () => {
    assert.throws(() => store.list({ status: 'shipped' }), RangeError);
  });
});

describe('listByCustomer', () => {
  it('returns only that customer\'s orders, newest first, limited to 3 by default', () => {
    store.create(orderData({ customerPsid: 'A' }));
    store.create(orderData({ customerPsid: 'B' }));
    store.create(orderData({ customerPsid: 'A' }));
    store.create(orderData({ customerPsid: 'A' }));
    store.create(orderData({ customerPsid: 'A' }));

    assert.deepEqual(
      store.listByCustomer('A').map((order) => order.id),
      ['ORD-1005', 'ORD-1004', 'ORD-1003'],
    );
    assert.deepEqual(store.listByCustomer('B').map((order) => order.id), ['ORD-1002']);
  });

  it('honours a custom limit', () => {
    store.create(orderData({ customerPsid: 'A' }));
    store.create(orderData({ customerPsid: 'A' }));
    store.create(orderData({ customerPsid: 'A' }));
    assert.equal(store.listByCustomer('A', { limit: 1 }).length, 1);
    assert.equal(store.listByCustomer('A', { limit: 10 }).length, 3);
    assert.equal(store.listByCustomer('A', { limit: 0 }).length, 0);
  });

  it('returns an empty array for an unknown customer', () => {
    store.create(orderData({ customerPsid: 'A' }));
    assert.deepEqual(store.listByCustomer('nobody'), []);
  });
});

describe('updateStatus', () => {
  it('changes the status and returns the updated copy', () => {
    const { order } = store.create(orderData());
    const updated = store.updateStatus(order.id, 'confirmed');
    assert.equal(updated.status, 'confirmed');
    assert.equal(updated.id, order.id);
    assert.equal(store.get(order.id).status, 'confirmed');
    assert.equal(store.updateStatus(order.id, 'cancelled').status, 'cancelled');
    assert.equal(store.updateStatus(order.id, 'pending').status, 'pending');
  });

  it('returns null for an unknown id', () => {
    assert.equal(store.updateStatus('ORD-9999', 'confirmed'), null);
  });

  it('throws a RangeError for a status that is not allowed', () => {
    const { order } = store.create(orderData());
    for (const status of ['shipped', '', 'PENDING', undefined, null, 5]) {
      assert.throws(() => store.updateStatus(order.id, status), RangeError);
    }
    assert.equal(store.get(order.id).status, 'pending');
  });
});

describe('size and clear', () => {
  it('count and remove every order', () => {
    assert.equal(store.size(), 0);
    store.create(orderData());
    store.create(orderData());
    assert.equal(store.size(), 2);
    store.clear();
    assert.equal(store.size(), 0);
    assert.deepEqual(store.list(), []);
  });
});

describe('default store', () => {
  it('is a shared singleton that exposes the same API', () => {
    assert.equal(typeof orderStore.create, 'function');
    assert.equal(typeof orderStore.listByCustomer, 'function');
  });
});
