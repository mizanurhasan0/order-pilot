import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDedupeCache } from '../src/services/dedupeCache.js';

// A controllable clock, so no test ever has to wait.
function createClock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    advance(ms) {
      time += ms;
    },
  };
}

test('markIfNew: true the first time, false for a duplicate', () => {
  const cache = createDedupeCache();
  assert.equal(cache.markIfNew('m_1'), true);
  assert.equal(cache.markIfNew('m_1'), false);
  assert.equal(cache.markIfNew('m_1'), false);
});

test('markIfNew: different keys are tracked independently', () => {
  const cache = createDedupeCache();
  assert.equal(cache.markIfNew('m_1'), true);
  assert.equal(cache.markIfNew('m_2'), true);
  assert.equal(cache.markIfNew('m_1'), false);
  assert.equal(cache.markIfNew('m_2'), false);
});

test('markIfNew: a key is still a duplicate just before ttlMs', () => {
  const clock = createClock();
  const cache = createDedupeCache({ ttlMs: 1000, now: clock.now });
  assert.equal(cache.markIfNew('m_1'), true);
  clock.advance(999);
  assert.equal(cache.markIfNew('m_1'), false);
});

test('markIfNew: a key expires at exactly ttlMs and is new again', () => {
  const clock = createClock();
  const cache = createDedupeCache({ ttlMs: 1000, now: clock.now });
  assert.equal(cache.markIfNew('m_1'), true);
  clock.advance(1000);
  assert.equal(cache.markIfNew('m_1'), true);
  // The re-recorded key is a duplicate again, with a fresh TTL.
  clock.advance(999);
  assert.equal(cache.markIfNew('m_1'), false);
});

test('markIfNew: duplicates do not extend the TTL', () => {
  const clock = createClock();
  const cache = createDedupeCache({ ttlMs: 1000, now: clock.now });
  assert.equal(cache.markIfNew('m_1'), true);
  clock.advance(600);
  assert.equal(cache.markIfNew('m_1'), false);
  clock.advance(400);
  assert.equal(cache.markIfNew('m_1'), true);
});

test('markIfNew: uses a 10 minute TTL by default', () => {
  const clock = createClock();
  const cache = createDedupeCache({ now: clock.now });
  assert.equal(cache.markIfNew('m_1'), true);
  clock.advance(10 * 60 * 1000 - 1);
  assert.equal(cache.markIfNew('m_1'), false);
  clock.advance(1);
  assert.equal(cache.markIfNew('m_1'), true);
});

test('markIfNew: evicts the oldest entries beyond maxEntries', () => {
  const clock = createClock();
  const cache = createDedupeCache({ maxEntries: 3, now: clock.now });
  for (const key of ['a', 'b', 'c']) {
    assert.equal(cache.markIfNew(key), true);
    clock.advance(1);
  }
  assert.equal(cache.size(), 3);

  assert.equal(cache.markIfNew('d'), true);
  assert.equal(cache.size(), 3);

  // 'a' was the oldest, so it is the one that was forgotten.
  assert.equal(cache.markIfNew('b'), false);
  assert.equal(cache.markIfNew('c'), false);
  assert.equal(cache.markIfNew('d'), false);
  assert.equal(cache.markIfNew('a'), true);
  assert.equal(cache.size(), 3);
});

test('markIfNew: duplicates never trigger an eviction', () => {
  const cache = createDedupeCache({ maxEntries: 2 });
  assert.equal(cache.markIfNew('a'), true);
  assert.equal(cache.markIfNew('b'), true);
  assert.equal(cache.markIfNew('a'), false);
  assert.equal(cache.markIfNew('b'), false);
  assert.equal(cache.size(), 2);
});

test('markIfNew: non-string and empty keys return false and are not stored', () => {
  const cache = createDedupeCache();
  for (const key of [undefined, null, '', 0, 1, 42, true, false, {}, [], ['m_1'], Symbol('m_1'), () => 'm_1']) {
    assert.equal(cache.markIfNew(key), false);
  }
  assert.equal(cache.size(), 0);
});

test('size: counts live entries and drops expired ones', () => {
  const clock = createClock();
  const cache = createDedupeCache({ ttlMs: 1000, now: clock.now });
  assert.equal(cache.size(), 0);

  cache.markIfNew('a');
  clock.advance(500);
  cache.markIfNew('b');
  assert.equal(cache.size(), 2);

  clock.advance(500); // 'a' reaches exactly ttlMs
  assert.equal(cache.size(), 1);

  clock.advance(500); // 'b' reaches exactly ttlMs
  assert.equal(cache.size(), 0);
});

test('clear: forgets every key', () => {
  const cache = createDedupeCache();
  cache.markIfNew('a');
  cache.markIfNew('b');
  assert.equal(cache.size(), 2);

  cache.clear();
  assert.equal(cache.size(), 0);
  assert.equal(cache.markIfNew('a'), true);
  assert.equal(cache.markIfNew('b'), true);
});

test('createDedupeCache: caches do not share state', () => {
  const first = createDedupeCache();
  const second = createDedupeCache();
  assert.equal(first.markIfNew('m_1'), true);
  assert.equal(second.markIfNew('m_1'), true);
  assert.equal(first.markIfNew('m_1'), false);
});
