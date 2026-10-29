// Redis session store: the persistent twin of sessionStore.js.
//
// Same methods and results as the memory store, except that every method returns a promise
// (and there is no size/clear/purge: Redis expires the keys itself). Expiry is still decided
// here from updatedAt, exactly like the memory store, so the one-time `expired: true` notice
// keeps working. Redis drops the key PURGE_INTERVAL_MS after that, which mirrors the memory
// store's periodic purge.
//
// Values are written as JSON strings. A client that parses them itself (Upstash's default
// automaticDeserialization) hands back objects, which are read as they are.

import { applyPatch, defaultSession, PURGE_INTERVAL_MS, SESSION_TTL_MS } from './sessionStore.js';

export function createRedisSessionStore({ redis, prefix = 'orderpilot:', ttlMs = SESSION_TTL_MS, now = Date.now }) {
  if (typeof ttlMs !== 'number' || !(ttlMs > 0)) {
    throw new RangeError('ttlMs must be a positive number');
  }

  const keyFor = (key) => `${prefix}session:${key}`;
  const isExpired = (session, currentTime) => currentTime - session.updatedAt >= ttlMs;

  async function read(key) {
    const value = await redis.get(keyFor(key));
    if (typeof value === 'string') return JSON.parse(value);
    return value !== null && typeof value === 'object' ? value : null;
  }

  return {
    async get(key) {
      const session = await read(key);
      if (!session) return defaultSession();

      if (isExpired(session, now())) {
        await redis.del(keyFor(key));
        return defaultSession(true);
      }
      return session;
    },

    async update(key, patch = {}) {
      if (typeof key !== 'string' || key === '') {
        throw new TypeError('session key must be a non-empty string');
      }

      const currentTime = now();
      const existing = await read(key);
      const base = existing && !isExpired(existing, currentTime) ? existing : defaultSession();
      const next = applyPatch(base, patch, currentTime);

      await redis.set(keyFor(key), JSON.stringify(next), { px: ttlMs + PURGE_INTERVAL_MS });
      return { ...next };
    },

    async reset(key) {
      await redis.del(keyFor(key));
      return defaultSession();
    },

    async delete(key) {
      return (await redis.del(keyFor(key))) > 0;
    },
  };
}
