// In-memory conversation sessions: where each customer is in the ordering flow.
//
// One session per conversation key (`pageId:psid`), so two customers, or the same
// customer on two Pages, never share state. A session that was idle for the
// whole ttlMs is forgotten, and the first read after that reports `expired: true`
// exactly once so the bot can say the conversation timed out.
//
// Limits: sessions live in memory only. Restarting the server deletes every
// session, and the data is not shared between instances. redisSessionStore.js
// keeps the same behaviour in Redis for serverless and multi-instance hosting.

export const STEPS = Object.freeze({
  IDLE: 'IDLE',
  BROWSING_PRODUCTS: 'BROWSING_PRODUCTS',
  WAITING_FOR_QUANTITY: 'WAITING_FOR_QUANTITY',
  WAITING_FOR_PHONE: 'WAITING_FOR_PHONE',
  WAITING_FOR_ADDRESS: 'WAITING_FOR_ADDRESS',
  WAITING_FOR_CONFIRMATION: 'WAITING_FOR_CONFIRMATION',
});

export const SESSION_TTL_MS = 30 * 60 * 1000;
export const PURGE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 10_000;

const STEP_VALUES = new Set(Object.values(STEPS));
// The only fields update() copies from a patch. `expired` and `updatedAt` are
// owned by the store itself.
const PATCH_FIELDS = ['step', 'productId', 'page', 'quantity', 'phone', 'address', 'draftId'];

export function conversationKey(pageId, psid) {
  return `${pageId}:${psid}`;
}

export function defaultSession(expired = false) {
  return {
    step: STEPS.IDLE,
    productId: null,
    page: 1,
    quantity: null,
    phone: null,
    address: null,
    draftId: null,
    expired,
    updatedAt: null,
  };
}

// The session update() stores: `base` with the known fields of `patch` merged in. Shared with
// the Redis store so both apply exactly the same rules. Throws on an unknown step.
export function applyPatch(base, patch, currentTime) {
  const next = { ...base, expired: false };
  if (typeof patch === 'object' && patch !== null) {
    for (const field of PATCH_FIELDS) {
      // Own properties only, so inherited values are never picked up.
      if (Object.hasOwn(patch, field) && patch[field] !== undefined) {
        next[field] = patch[field];
      }
    }
  }
  if (!STEP_VALUES.has(next.step)) {
    throw new RangeError(`unknown step: ${String(next.step)}`);
  }
  next.updatedAt = currentTime;
  return next;
}

export function createSessionStore({
  ttlMs = SESSION_TTL_MS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  now = Date.now,
  autoPurge = false,
} = {}) {
  if (typeof ttlMs !== 'number' || !(ttlMs > 0)) {
    throw new RangeError('ttlMs must be a positive number');
  }
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new RangeError('maxSessions must be a positive integer');
  }

  // key -> stored session. update() deletes and re-inserts its key, so Map order
  // is recency order: the least recently updated session is always first. That
  // is also the oldest updatedAt, so expired sessions are always at the front.
  const sessions = new Map();
  let timer = null;

  function isExpired(session, currentTime) {
    return currentTime - session.updatedAt >= ttlMs;
  }

  // Removes every expired session and returns how many were removed.
  function purgeExpired() {
    const currentTime = now();
    let removed = 0;
    for (const [key, session] of sessions) {
      if (!isExpired(session, currentTime)) break;
      sessions.delete(key);
      removed += 1;
    }
    return removed;
  }

  if (autoPurge) {
    timer = setInterval(() => {
      purgeExpired();
    }, PURGE_INTERVAL_MS);
    // Never let the cleanup timer keep the process (or a test run) alive.
    timer.unref();
  }

  return {
    // Always returns a copy, so callers cannot change the stored session. An
    // unknown key gives a default IDLE session without storing anything. A
    // session idle for ttlMs or more is deleted and reported once with
    // `expired: true`; the next read is a plain default again.
    get(key) {
      const session = sessions.get(key);
      if (!session) return defaultSession();

      if (isExpired(session, now())) {
        sessions.delete(key);
        return defaultSession(true);
      }
      return { ...session };
    },

    // Merges the known fields of `patch` into the session, refreshes its TTL and
    // marks it as the most recently used. Unknown keys and `undefined` values
    // are ignored; use null to clear a field. Returns a copy.
    update(key, patch = {}) {
      if (typeof key !== 'string' || key === '') {
        throw new TypeError('session key must be a non-empty string');
      }

      const currentTime = now();
      const existing = sessions.get(key);
      const base = existing && !isExpired(existing, currentTime) ? existing : defaultSession();
      const next = applyPatch(base, patch, currentTime);

      sessions.delete(key);
      sessions.set(key, next);
      while (sessions.size > maxSessions) {
        sessions.delete(sessions.keys().next().value);
      }
      return { ...next };
    },

    // Forgets the session, so the next get() is a plain default. Returns that
    // default session.
    reset(key) {
      sessions.delete(key);
      return defaultSession();
    },

    // Same as reset, but tells whether a session was stored.
    delete(key) {
      return sessions.delete(key);
    },

    purgeExpired,

    // Number of live sessions. Expired sessions that are not purged yet are not
    // counted, and counting never deletes them (so it cannot swallow an
    // `expired: true` notice).
    size() {
      const currentTime = now();
      let expiredCount = 0;
      for (const session of sessions.values()) {
        if (!isExpired(session, currentTime)) break;
        expiredCount += 1;
      }
      return sessions.size - expiredCount;
    },

    clear() {
      sessions.clear();
    },

    // Stops the auto-purge timer, if any. Safe to call more than once.
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export const sessionStore = createSessionStore({ autoPurge: true });
