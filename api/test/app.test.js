import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

// The assembled app (src/app.js): the startup check of every setting, the 503 guard while
// anything is missing, and the routes in order. app.js checks the settings when it is imported, so
// each case imports its own copy (the query string makes a new module instance).

const SETTINGS = {
  META_VERIFY_TOKEN: 'APP_TEST_VERIFY',
  META_APP_SECRET: 'APP_TEST_SECRET',
  ADMIN_API_KEY: 'APP_TEST_ADMIN_KEY_0123456789',
  ENABLE_AUTO_REPLY: 'false',
};
const KEYS = [...Object.keys(SETTINGS), 'PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID'];

let saved;
let errors;
let server;

async function start(name) {
  const { default: app, configProblems } = await import(`../src/app.js?${name}`);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { configProblems, get: (path, headers) => fetch(`${base}${path}`, { headers }) };
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  errors = [];
  mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
});

afterEach(async () => {
  mock.restoreAll();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('app', () => {
  it('without its settings, names them once and answers every request with 503', async () => {
    const { configProblems, get } = await start('unconfigured');

    assert.deepEqual(configProblems, ['ADMIN_API_KEY', 'appSecret (META_APP_SECRET)', 'verifyToken (META_VERIFY_TOKEN)']);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^Missing or invalid settings: ADMIN_API_KEY, appSecret \(META_APP_SECRET\)/);
    for (const path of ['/health', '/api/products', '/api/webhooks/facebook']) {
      const res = await get(path);
      assert.equal(res.status, 503, path);
      assert.deepEqual(await res.json(), { success: false, message: 'Server is not configured' });
    }
  });

  it('asks for the Page token and ID only when ENABLE_AUTO_REPLY=true', async () => {
    Object.assign(process.env, SETTINGS, { ENABLE_AUTO_REPLY: 'true' });
    const { configProblems } = await start('replies-on');
    assert.deepEqual(configProblems, ['pageAccessToken (PAGE_ACCESS_TOKEN)', 'pageId (FACEBOOK_PAGE_ID)']);
  });

  it('with its settings, serves health, products, the webhook and the protected orders API', async () => {
    Object.assign(process.env, SETTINGS);
    const { configProblems, get } = await start('configured');

    assert.deepEqual(configProblems, []);
    assert.equal(errors.length, 0);
    assert.equal((await get('/health')).status, 200);
    assert.equal((await get('/api/products?limit=1')).status, 200);
    const verified = await get('/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=APP_TEST_VERIFY&hub.challenge=OK');
    assert.equal(await verified.text(), 'OK');
    assert.equal((await get('/api/orders')).status, 401);
    assert.equal((await get('/api/orders', { 'x-admin-key': SETTINGS.ADMIN_API_KEY })).status, 200);

    const missing = await get('/nope');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { success: false, message: 'Not found' });
  });
});
