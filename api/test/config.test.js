import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getRedisConfig,
  invalidAdminVars,
  invalidAutoReplyVars,
  invalidConfigVars,
  invalidStorageVars,
  isAutoReplyEnabled,
} from '../src/config.js';

describe('invalidAdminVars', () => {
  it('accepts a key of 16 characters or more', () => {
    assert.deepEqual(invalidAdminVars({ ADMIN_API_KEY: 'a'.repeat(16) }), []);
    assert.deepEqual(invalidAdminVars({ ADMIN_API_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef' }), []);
  });

  it('reports a missing or blank key by name', () => {
    assert.deepEqual(invalidAdminVars({}), ['ADMIN_API_KEY']);
    assert.deepEqual(invalidAdminVars({ ADMIN_API_KEY: '' }), ['ADMIN_API_KEY']);
    assert.deepEqual(invalidAdminVars({ ADMIN_API_KEY: '   ' }), ['ADMIN_API_KEY']);
  });

  it('reports a placeholder key', () => {
    assert.deepEqual(invalidAdminVars({ ADMIN_API_KEY: 'replace_with_secure_random_key' }), ['ADMIN_API_KEY']);
  });

  it('reports a key shorter than 16 characters', () => {
    assert.deepEqual(invalidAdminVars({ ADMIN_API_KEY: 'a'.repeat(15) }), ['ADMIN_API_KEY']);
    assert.deepEqual(invalidAdminVars({ ADMIN_API_KEY: `  ${'a'.repeat(15)}  ` }), ['ADMIN_API_KEY']);
  });

  it('reads process.env by default and returns names only', () => {
    const saved = process.env.ADMIN_API_KEY;
    try {
      process.env.ADMIN_API_KEY = 'short';
      assert.deepEqual(invalidAdminVars(), ['ADMIN_API_KEY']);
      process.env.ADMIN_API_KEY = 'a'.repeat(24);
      assert.deepEqual(invalidAdminVars(), []);
    } finally {
      if (saved === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = saved;
    }
  });
});

describe('invalidStorageVars', () => {
  const URL = 'https://example-12345.upstash.io';

  it('allows memory storage outside Vercel', () => {
    assert.deepEqual(invalidStorageVars({}), []);
  });

  it('requires Redis on Vercel', () => {
    assert.deepEqual(invalidStorageVars({ VERCEL: '1' }), ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']);
    assert.deepEqual(invalidStorageVars({ VERCEL: '1', KV_REST_API_URL: URL, KV_REST_API_TOKEN: 'token' }), []);
  });

  it('reports a half-set or malformed pair by name', () => {
    assert.deepEqual(invalidStorageVars({ UPSTASH_REDIS_REST_URL: URL }), ['UPSTASH_REDIS_REST_TOKEN']);
    assert.deepEqual(invalidStorageVars({ UPSTASH_REDIS_REST_TOKEN: 'token' }), ['UPSTASH_REDIS_REST_URL']);
    assert.deepEqual(
      invalidStorageVars({ UPSTASH_REDIS_REST_URL: 'http://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token' }),
      ['UPSTASH_REDIS_REST_URL'],
    );
  });

  it('prefers the UPSTASH_* names over the KV_* names', () => {
    assert.deepEqual(
      getRedisConfig({ UPSTASH_REDIS_REST_URL: URL, UPSTASH_REDIS_REST_TOKEN: 'a', KV_REST_API_URL: 'x', KV_REST_API_TOKEN: 'b' }),
      { url: URL, token: 'a' },
    );
    assert.equal(getRedisConfig({}), null);
  });
});

describe('ENABLE_AUTO_REPLY', () => {
  it('is on only for "true", in any case', () => {
    for (const value of ['true', 'TRUE', ' true ']) assert.equal(isAutoReplyEnabled({ ENABLE_AUTO_REPLY: value }), true, value);
    for (const value of [undefined, '', 'false', 'yes', '1']) {
      assert.equal(isAutoReplyEnabled({ ENABLE_AUTO_REPLY: value }), false, String(value));
    }
  });

  it('rejects anything but true, false or unset, so a typo never switches replies', () => {
    for (const value of [undefined, '', 'true', 'False']) assert.deepEqual(invalidAutoReplyVars({ ENABLE_AUTO_REPLY: value }), []);
    for (const value of ['yes', '1', 'on']) assert.deepEqual(invalidAutoReplyVars({ ENABLE_AUTO_REPLY: value }), ['ENABLE_AUTO_REPLY']);
  });
});

describe('invalidConfigVars', () => {
  it('lists every problem with this backend\'s own variables, by name', () => {
    assert.deepEqual(invalidConfigVars({ ENABLE_AUTO_REPLY: 'yes', VERCEL: '1' }), [
      'ENABLE_AUTO_REPLY',
      'ADMIN_API_KEY',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ]);
    assert.deepEqual(invalidConfigVars({ ADMIN_API_KEY: 'k'.repeat(24) }), []);
  });
});
