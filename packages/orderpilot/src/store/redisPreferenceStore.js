// Redis preference store: the persistent twin of preferenceStore.js. Same methods, each
// returning a promise. One key per customer, `<prefix>language:<pageId:psid>`, kept a year
// after the last change.

import { isLanguage } from '../services/language.js';

export const PREFERENCE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function createRedisPreferenceStore({ redis, prefix = 'orderpilot:', ttlMs = PREFERENCE_TTL_MS }) {
  const keyFor = (key) => `${prefix}language:${key}`;

  return {
    async getLanguage(key) {
      const value = await redis.get(keyFor(key));
      return isLanguage(value) ? value : null;
    },

    async setLanguage(key, language) {
      if (typeof key !== 'string' || key === '') throw new TypeError('preference key must be a non-empty string');
      if (!isLanguage(language)) throw new RangeError(`unknown language: ${String(language)}`);
      await redis.set(keyFor(key), language, { px: ttlMs });
      return language;
    },
  };
}
