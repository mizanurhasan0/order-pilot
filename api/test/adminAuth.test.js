import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { requireAdminKey } from '../src/middleware/adminAuth.js';
import { safeEqual } from '../src/utils/safeEqual.js';

// Unit tests for the admin key middleware, using plain fake req/res objects (no server).

const SERVER_KEY = 'TEST_ADMIN_KEY_0123456789abcdef';

let savedKey;

beforeEach(() => {
  savedKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = SERVER_KEY;
});

afterEach(() => {
  mock.restoreAll();
  if (savedKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = savedKey;
});

// Runs the middleware once and reports what it did.
function run(headers = {}) {
  const result = { nextCalls: 0, status: null, body: null };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  requireAdminKey({ headers }, res, () => {
    result.nextCalls += 1;
  });
  return result;
}

function assertUnauthorized(result) {
  assert.equal(result.nextCalls, 0);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { success: false, message: 'Unauthorized' });
}

describe('requireAdminKey', () => {
  it('calls next() for the correct key', () => {
    const result = run({ 'x-admin-key': SERVER_KEY });
    assert.equal(result.nextCalls, 1);
    assert.equal(result.status, null);
    assert.equal(result.body, null);
  });

  it('rejects a missing header with 401', () => {
    assertUnauthorized(run({}));
  });

  it('rejects a wrong key with 401', () => {
    assertUnauthorized(run({ 'x-admin-key': 'wrong-key' }));
    assertUnauthorized(run({ 'x-admin-key': `${SERVER_KEY}x` }));
    assertUnauthorized(run({ 'x-admin-key': SERVER_KEY.slice(0, -1) }));
    assertUnauthorized(run({ 'x-admin-key': SERVER_KEY.toLowerCase() }));
  });

  it('rejects an empty key with 401', () => {
    assertUnauthorized(run({ 'x-admin-key': '' }));
  });

  it('rejects a repeated header (array), even when one value is correct', () => {
    assertUnauthorized(run({ 'x-admin-key': [SERVER_KEY] }));
    assertUnauthorized(run({ 'x-admin-key': [SERVER_KEY, SERVER_KEY] }));
  });

  it('always rejects when the server key is unset or blank', () => {
    delete process.env.ADMIN_API_KEY;
    assertUnauthorized(run({ 'x-admin-key': '' }));
    assertUnauthorized(run({ 'x-admin-key': 'undefined' }));
    assertUnauthorized(run({}));

    process.env.ADMIN_API_KEY = '   ';
    assertUnauthorized(run({ 'x-admin-key': '' }));
    assertUnauthorized(run({ 'x-admin-key': '   ' }));
  });

  it('reads the server key at request time', () => {
    assert.equal(run({ 'x-admin-key': SERVER_KEY }).nextCalls, 1);
    process.env.ADMIN_API_KEY = 'ANOTHER_ADMIN_KEY_0123456789';
    assertUnauthorized(run({ 'x-admin-key': SERVER_KEY }));
    assert.equal(run({ 'x-admin-key': 'ANOTHER_ADMIN_KEY_0123456789' }).nextCalls, 1);
  });

  it('never echoes the submitted or the real key', () => {
    const submitted = 'SUBMITTED_SECRET_VALUE_123456';
    const result = run({ 'x-admin-key': submitted });
    const text = JSON.stringify(result.body);
    assert.equal(text.includes(submitted), false);
    assert.equal(text.includes(SERVER_KEY), false);
  });

  it('never logs the keys', () => {
    const lines = [];
    const originals = {};
    for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
      originals[method] = console[method];
      console[method] = (...args) => lines.push(args.join(' '));
    }
    try {
      run({ 'x-admin-key': 'SUBMITTED_SECRET_VALUE_123456' });
      run({ 'x-admin-key': SERVER_KEY });
    } finally {
      Object.assign(console, originals);
    }
    assert.deepEqual(lines, []);
  });
});

describe('constant-time comparison', () => {
  it('compares the keys with crypto.timingSafeEqual', () => {
    const spy = mock.method(crypto, 'timingSafeEqual');
    assert.equal(run({ 'x-admin-key': SERVER_KEY }).nextCalls, 1);
    assert.equal(spy.mock.callCount(), 1);
    // Both sides are SHA-256 digests, so the buffers always have the same length.
    const [a, b] = spy.mock.calls[0].arguments;
    assert.equal(a.length, 32);
    assert.equal(b.length, 32);

    assertUnauthorized(run({ 'x-admin-key': 'wrong' }));
    assert.equal(spy.mock.callCount(), 2);
  });
});

describe('safeEqual', () => {
  it('returns true only for identical strings', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'ABC'), false);
  });

  it('handles strings of different lengths without throwing', () => {
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', 'abc'), false);
    assert.equal(safeEqual('', ''), true);
  });
});
