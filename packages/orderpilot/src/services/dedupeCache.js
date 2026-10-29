// In-memory duplicate filter for webhook message ids (mids).
//
// Meta retries a delivery when it does not get a quick 200 and can also send the
// same message twice, so a customer could otherwise receive the same reply twice.
//
// Limits: the memory is lost on restart and is not shared between instances.
// redisDedupeCache.js does the same with a Redis SET NX and a TTL, and is used
// whenever Redis is configured.

export const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

export function createDedupeCache({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = Date.now,
} = {}) {
  // key -> expiry time. Every entry lives for the same ttlMs, so Map insertion
  // order is also expiry order: expired keys are always at the front.
  const entries = new Map();

  function purgeExpired(currentTime) {
    for (const [key, expiresAt] of entries) {
      if (expiresAt > currentTime) break;
      entries.delete(key);
    }
  }

  return {
    // Synchronous check-and-set, so two concurrent deliveries of the same mid
    // can never both see "new". Returns true the first time a key is seen and
    // false while it is still remembered. A key is forgotten once ttlMs has
    // fully elapsed.
    markIfNew(key) {
      if (typeof key !== 'string' || key === '') return false;

      const currentTime = now();
      purgeExpired(currentTime);
      if (entries.has(key)) return false;

      entries.set(key, currentTime + ttlMs);
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      return true;
    },

    size() {
      purgeExpired(now());
      return entries.size;
    },

    clear() {
      entries.clear();
    },
  };
}
