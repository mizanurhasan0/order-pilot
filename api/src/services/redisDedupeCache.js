// Redis twin of dedupeCache.js. SET NX with a TTL is one atomic check-and-set shared by every
// server instance, so a retried or doubled webhook delivery is answered only once even when
// the copies reach different serverless instances.

import { DEFAULT_TTL_MS } from './dedupeCache.js';

export function createRedisDedupeCache({ redis, prefix = 'orderpilot:', ttlMs = DEFAULT_TTL_MS }) {
  return {
    // Resolves to true the first time a key is seen and false while it is still remembered.
    async markIfNew(key) {
      if (typeof key !== 'string' || key === '') return false;
      return (await redis.set(`${prefix}dedupe:${key}`, '1', { nx: true, px: ttlMs })) === 'OK';
    },
  };
}
