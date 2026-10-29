// In-memory order store.
//
// IMPORTANT: orders live only in this process's memory. Restarting the server
// deletes every order. redisOrderStore.js is the persistent version with the same
// methods, used whenever Redis is configured (always on Vercel).

export const ORDER_STATUSES = Object.freeze(['pending', 'confirmed', 'cancelled']);

export const FIRST_ORDER_NUMBER = 1001;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

export function validateOrderData(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Order data must be an object');
  }
  for (const field of ['productId', 'productName', 'currency', 'customerPsid', 'phone', 'address']) {
    if (!isNonEmptyString(data[field])) throw new TypeError(`${field} must be a non-empty string`);
  }
  for (const field of ['quantity', 'unitPrice']) {
    if (!isPositiveInteger(data[field])) throw new TypeError(`${field} must be a positive integer`);
  }
}

export function validateStatus(status) {
  if (!ORDER_STATUSES.includes(status)) {
    throw new RangeError(`status must be one of: ${ORDER_STATUSES.join(', ')}`);
  }
}

// A new pending order from validated data. Shared with the Redis store.
export function buildOrder(id, data, createdAt) {
  return {
    id,
    productId: data.productId,
    productName: data.productName,
    quantity: data.quantity,
    unitPrice: data.unitPrice,
    subtotal: data.unitPrice * data.quantity,
    currency: data.currency,
    customerPsid: data.customerPsid,
    phone: data.phone,
    address: data.address,
    status: 'pending',
    createdAt: createdAt.toISOString(),
  };
}

// Every order leaves the store as a copy, so callers can never change stored data.
const copy = (order) => ({ ...order });

export function createOrderStore({ now = () => new Date() } = {}) {
  // Insertion order == creation order. The counter lives here (not derived from
  // the map size), so ids keep increasing and are never reused, even after clear().
  const orders = new Map();
  const idempotencyIndex = new Map();
  let nextOrderNumber = FIRST_ORDER_NUMBER;

  // Newest first. Orders are only ever appended, so reversing insertion order is enough.
  const newestFirst = () => [...orders.values()].reverse();

  return {
    create(data, { idempotencyKey } = {}) {
      validateOrderData(data);
      if (idempotencyKey !== undefined && !isNonEmptyString(idempotencyKey)) {
        throw new TypeError('idempotencyKey must be a non-empty string');
      }

      if (idempotencyKey !== undefined) {
        const existing = orders.get(idempotencyIndex.get(idempotencyKey));
        if (existing) return { order: copy(existing), created: false };
      }

      const order = buildOrder(`ORD-${nextOrderNumber}`, data, now());
      nextOrderNumber += 1;
      orders.set(order.id, order);
      if (idempotencyKey !== undefined) idempotencyIndex.set(idempotencyKey, order.id);
      return { order: copy(order), created: true };
    },

    get(id) {
      const order = orders.get(id);
      return order ? copy(order) : null;
    },

    list({ status } = {}) {
      if (status !== undefined) validateStatus(status);
      return newestFirst()
        .filter((order) => status === undefined || order.status === status)
        .map(copy);
    },

    listByCustomer(customerPsid, { limit = 3 } = {}) {
      return newestFirst()
        .filter((order) => order.customerPsid === customerPsid)
        .slice(0, Math.max(0, limit))
        .map(copy);
    },

    updateStatus(id, status) {
      validateStatus(status);
      const order = orders.get(id);
      if (!order) return null;
      order.status = status;
      return copy(order);
    },

    findByIdempotencyKey(key) {
      const order = orders.get(idempotencyIndex.get(key));
      return order ? copy(order) : null;
    },

    // Removes every order. The id counter is NOT reset, so ids are never reused.
    clear() {
      orders.clear();
      idempotencyIndex.clear();
    },

    size() {
      return orders.size;
    },
  };
}

export const orderStore = createOrderStore();
