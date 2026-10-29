// Per-customer settings that outlive a conversation session: for now only the language.
//
// One entry per conversation key (`pageId:psid`), like sessions, but no 30-minute expiry: the
// language a customer chose (or the one detected from their Facebook locale) is kept. In memory
// at most maxEntries are kept, the oldest dropped first; redisPreferenceStore.js keeps them in
// Redis for a year.

import { isLanguage } from '../services/language.js';

const DEFAULT_MAX_ENTRIES = 50_000;

export function createPreferenceStore({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  const languages = new Map();

  return {
    // The stored language, or null when none was stored yet.
    getLanguage(key) {
      return languages.get(key) ?? null;
    },

    setLanguage(key, language) {
      if (typeof key !== 'string' || key === '') throw new TypeError('preference key must be a non-empty string');
      if (!isLanguage(language)) throw new RangeError(`unknown language: ${String(language)}`);
      languages.delete(key); // re-inserted last, so it is the newest entry
      languages.set(key, language);
      if (languages.size > maxEntries) languages.delete(languages.keys().next().value);
      return language;
    },

    size() {
      return languages.size;
    },

    clear() {
      languages.clear();
    },
  };
}

export const preferenceStore = createPreferenceStore();
