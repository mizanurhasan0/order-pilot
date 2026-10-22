// Redis order store: the persistent twin of orderStore.js.
//
// Same methods and results as the memory store, except that every method returns a promise.
// Used whenever Redis is configured, which Vercel requires: serverless instances share no
// memory and are recycled at any time.
//
// Keys, all under `prefix`:
//   orders:seq              counter behind the ORD-<number> ids (never reused)
//   order:<id>              the order as JSON
//   orders:all              sorted set of ids scored by order number, for list()
//   orders:psid:<psid>      the same per customer, for listByCustomer()
//   orders:draft:<key>      idempotency key -> order id
//
// Values are JSON strings written and parsed here, so the client must be created with
// automaticDeserialization: false. list() loads every order, which suits a small shop.

import { buildOrder, FIRST_ORDER_NUMBER, validateOrderData, validateStatus } from './orderStore.js';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : null);

export function createRedisOrderStore({ redis, prefix = 'orderpilot:', now = () => new Date() }) {
  const keys = {
    seq: `${prefix}orders:seq`,
    all: `${prefix}orders:all`,
    order: (id) => `${prefix}order:${id}`,
    customer: (psid) => `${prefix}orders:psid:${psid}`,
    draft: (key) => `${prefix}orders:draft:${key}`,
  };

  async function get(id) {
    if (!isNonEmptyString(id)) return null;
    return parse(await redis.get(keys.order(id)));
  }

  // The orders behind `ids`, in the same order. Ids without a stored order are skipped.
  async function getMany(ids) {
    if (ids.length === 0) return [];
    const values = await redis.mget(...ids.map(keys.order));
    return values.map(parse).filter(Boolean);
  }

  async function findByIdempotencyKey(key) {
    if (!isNonEmptyString(key)) return null;
    return get(await redis.get(keys.draft(key)));
  }

  return {
    async create(data, { idempotencyKey } = {}) {
      validateOrderData(data);
      if (idempotencyKey !== undefined && !isNonEmptyString(idempotencyKey)) {
        throw new TypeError('idempotencyKey must be a non-empty string');
      }

      if (idempotencyKey !== undefined) {
        const existing = await findByIdempotencyKey(idempotencyKey);
        if (existing) return { order: existing, created: false };
      }

      const number = FIRST_ORDER_NUMBER - 1 + (await redis.incr(keys.seq));
      const order = buildOrder(`ORD-${number}`, data, now());
      await redis.set(keys.order(order.id), JSON.stringify(order));

      // The key is claimed only after the order is written, so whoever finds the key also finds
      // the order. A concurrent create with the same key loses the NX race and gets the winner.
      if (idempotencyKey !== undefined) {
        const claimed = await redis.set(keys.draft(idempotencyKey), order.id, { nx: true });
        if (claimed !== 'OK') {
          await redis.del(keys.order(order.id));
          const winner = await findByIdempotencyKey(idempotencyKey);
          if (!winner) throw new Error('idempotency key is claimed by a missing order');
          return { order: winner, created: false };
        }
      }

      await Promise.all([
        redis.zadd(keys.all, { score: number, member: order.id }),
        redis.zadd(keys.customer(order.customerPsid), { score: number, member: order.id }),
      ]);
      return { order, created: true };
    },

    get,

    async list({ status } = {}) {
      if (status !== undefined) validateStatus(status);
      const orders = await getMany(await redis.zrange(keys.all, 0, -1, { rev: true }));
      return orders.filter((order) => status === undefined || order.status === status);
    },

    async listByCustomer(customerPsid, { limit = 3 } = {}) {
      const count = Math.floor(Math.max(0, limit));
      if (count === 0 || !isNonEmptyString(customerPsid)) return [];
      return getMany(await redis.zrange(keys.customer(customerPsid), 0, count - 1, { rev: true }));
    },

    async updateStatus(id, status) {
      validateStatus(status);
      const order = await get(id);
      if (!order) return null;
      order.status = status;
      // XX: only overwrite, never recreate an order that disappeared in the meantime.
      const saved = await redis.set(keys.order(order.id), JSON.stringify(order), { xx: true });
      return saved === 'OK' ? order : null;
    },

    findByIdempotencyKey,

    async size() {
      return redis.zcard(keys.all);
    },
  };
}
