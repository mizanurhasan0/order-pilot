import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LANGUAGE, isLanguage, languageFromLocale } from '../src/services/language.js';
import { createPreferenceStore } from '../src/store/preferenceStore.js';

describe('languageFromLocale', () => {
  it('gives English for English Facebook locales', () => {
    for (const locale of ['en_US', 'en_GB', 'en_IN', 'EN_us', ' en_US ', 'en-GB', 'en']) {
      assert.equal(languageFromLocale(locale), 'en', locale);
    }
  });

  it('gives Bangla for Bangla, other and missing locales', () => {
    assert.equal(DEFAULT_LANGUAGE, 'bn');
    for (const locale of ['bn_IN', 'bn_BD', 'hi_IN', 'ar_AR', 'eng', 'fr_FR', '', null, undefined, 42]) {
      assert.equal(languageFromLocale(locale), 'bn', String(locale));
    }
  });

  it('knows exactly the two languages', () => {
    assert.ok(isLanguage('bn') && isLanguage('en'));
    for (const value of ['', 'EN', 'fr', null, undefined]) assert.equal(isLanguage(value), false);
  });
});

describe('createPreferenceStore', () => {
  it('remembers a language per conversation key and returns null before that', () => {
    const store = createPreferenceStore();
    assert.equal(store.getLanguage('page:1'), null);
    assert.equal(store.setLanguage('page:1', 'en'), 'en');
    assert.equal(store.getLanguage('page:1'), 'en');
    assert.equal(store.getLanguage('page:2'), null);
    store.setLanguage('page:1', 'bn');
    assert.equal(store.getLanguage('page:1'), 'bn');
  });

  it('rejects unknown languages and empty keys', () => {
    const store = createPreferenceStore();
    assert.throws(() => store.setLanguage('page:1', 'fr'), RangeError);
    assert.throws(() => store.setLanguage('', 'en'), TypeError);
    assert.equal(store.size(), 0);
  });

  it('keeps at most maxEntries, dropping the least recently set first', () => {
    const store = createPreferenceStore({ maxEntries: 2 });
    store.setLanguage('a', 'en');
    store.setLanguage('b', 'en');
    store.setLanguage('a', 'bn'); // a is now the newest
    store.setLanguage('c', 'en');
    assert.equal(store.getLanguage('b'), null);
    assert.equal(store.getLanguage('a'), 'bn');
    assert.equal(store.getLanguage('c'), 'en');
    assert.equal(store.size(), 2);
  });
});
