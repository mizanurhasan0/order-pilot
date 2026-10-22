import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { CATEGORIES, products } from '../src/data/products.js';
import productsRouter from '../src/routes/products.js';

// The real router is mounted the same way server.js mounts it, on a tiny app
// listening on a random port. Expectations are computed from the data module.

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use('/api/products', productsRouter);
  app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not found' });
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, type: response.headers.get('content-type'), body: await response.json() };
}

function totalPagesFor(total, limit) {
  return Math.max(1, Math.ceil(total / limit));
}

function haystack(product) {
  return `${product.name} ${product.description} ${product.category}`.toLowerCase();
}

function assertBadRequest({ status, body }, messagePattern) {
  assert.equal(status, 400);
  assert.equal(body.success, false);
  assert.equal(typeof body.message, 'string');
  if (messagePattern) assert.match(body.message, messagePattern);
  assert.ok(!('data' in body));
  assert.ok(!('pagination' in body));
}

// ---------------------------------------------------------------- list: success

test('GET /api/products: defaults to page 1 and limit 10', async () => {
  const { status, type, body } = await get('/api/products');
  assert.equal(status, 200);
  assert.match(type, /application\/json/);
  assert.equal(body.success, true);
  assert.deepEqual(body.data, products.slice(0, 10));
  assert.deepEqual(body.pagination, {
    page: 1,
    limit: 10,
    total: products.length,
    totalPages: totalPagesFor(products.length, 10),
  });
});

test('GET /api/products: response has exactly success, data and pagination', async () => {
  const { body } = await get('/api/products');
  assert.deepEqual(Object.keys(body).sort(), ['data', 'pagination', 'success']);
  assert.deepEqual(Object.keys(body.pagination).sort(), ['limit', 'page', 'total', 'totalPages']);
  assert.ok(Array.isArray(body.data));
  for (const product of body.data) {
    assert.deepEqual(Object.keys(product).sort(), Object.keys(products[0]).sort());
  }
});

test('GET /api/products?page=2&limit=3 returns the second page of three', async () => {
  const { status, body } = await get('/api/products?page=2&limit=3');
  assert.equal(status, 200);
  assert.deepEqual(body.data, products.slice(3, 6));
  assert.deepEqual(body.pagination, {
    page: 2,
    limit: 3,
    total: products.length,
    totalPages: totalPagesFor(products.length, 3),
  });
});

test('GET /api/products?limit=50 accepts the maximum limit', async () => {
  const { status, body } = await get('/api/products?limit=50');
  assert.equal(status, 200);
  assert.deepEqual(body.data, products.slice(0, 50));
  assert.equal(body.pagination.limit, 50);
});

test('GET /api/products: a page beyond the end is 200 with empty data', async () => {
  const lastPage = totalPagesFor(products.length, 10);
  const { status, body } = await get(`/api/products?page=${lastPage + 1}`);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.data, []);
  assert.deepEqual(body.pagination, {
    page: lastPage + 1,
    limit: 10,
    total: products.length,
    totalPages: lastPage,
  });
});

test('GET /api/products?category=... filters, ignoring case', async () => {
  for (const category of CATEGORIES) {
    const expected = products.filter((product) => product.category === category);
    for (const variant of [category, category.toLowerCase(), category.toUpperCase()]) {
      const { status, body } = await get(`/api/products?limit=50&category=${encodeURIComponent(variant)}`);
      assert.equal(status, 200, variant);
      assert.deepEqual(body.data, expected.slice(0, 50));
      assert.equal(body.pagination.total, expected.length);
      assert.equal(body.pagination.totalPages, totalPagesFor(expected.length, 50));
    }
  }
});

test('GET /api/products?search=... matches case-insensitively and trims', async () => {
  const term = products[0].name.split(/\s+/)[0].toLowerCase();
  const expected = products.filter((product) => haystack(product).includes(term));
  for (const variant of [term, term.toUpperCase(), `  ${term}  `]) {
    const { status, body } = await get(`/api/products?limit=50&search=${encodeURIComponent(variant)}`);
    assert.equal(status, 200);
    assert.deepEqual(body.data, expected.slice(0, 50));
    assert.equal(body.pagination.total, expected.length);
  }
});

test('GET /api/products: a search with no match is 200 with total 0 and totalPages 1', async () => {
  const { status, body } = await get('/api/products?search=zzz-no-such-product-zzz');
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.data, []);
  assert.deepEqual(body.pagination, { page: 1, limit: 10, total: 0, totalPages: 1 });
});

test('GET /api/products: category, search and pagination combine', async () => {
  const target = products[0];
  const term = target.name.split(/\s+/)[0].toLowerCase();
  const expected = products.filter(
    (product) => product.category === target.category && haystack(product).includes(term),
  );
  const query = `category=${encodeURIComponent(target.category.toLowerCase())}&search=${encodeURIComponent(term)}&page=1&limit=1`;
  const { status, body } = await get(`/api/products?${query}`);
  assert.equal(status, 200);
  assert.deepEqual(body.data, expected.slice(0, 1));
  assert.deepEqual(body.pagination, {
    page: 1,
    limit: 1,
    total: expected.length,
    totalPages: totalPagesFor(expected.length, 1),
  });
});

test('GET /api/products: a 100-character search is allowed, spaces around it do not count', async () => {
  const hundred = 'x'.repeat(100);
  for (const search of [hundred, `   ${hundred}   `]) {
    const { status, body } = await get(`/api/products?search=${encodeURIComponent(search)}`);
    assert.equal(status, 200);
    assert.equal(body.pagination.total, 0);
  }
});

test('GET /api/products: blank category and search mean no filter, unknown parameters are ignored', async () => {
  const plain = await get('/api/products');
  assert.deepEqual((await get('/api/products?category=&search=')).body, plain.body);
  assert.deepEqual((await get('/api/products?category=%20&search=%20')).body, plain.body);
  assert.deepEqual((await get('/api/products?colour=red&sort=price')).body, plain.body);
});

// ---------------------------------------------------------------- list: 400

test('GET /api/products: invalid page values are 400', async () => {
  for (const page of ['0', '-1', 'abc', '1.5', '1.0', '1e2', '+1', '%201', '', '99999999999999999999']) {
    assertBadRequest(await get(`/api/products?page=${page}`), /page/);
  }
});

test('GET /api/products: invalid limit values are 400', async () => {
  for (const limit of ['0', '51', '-1', 'abc', '1.5', '1e1', '', '1000']) {
    assertBadRequest(await get(`/api/products?limit=${limit}`), /limit/);
  }
});

test('GET /api/products: repeated query parameters are 400', async () => {
  assertBadRequest(await get('/api/products?page=1&page=2'), /page/);
  assertBadRequest(await get('/api/products?limit=1&limit=2'), /limit/);
  assertBadRequest(await get(`/api/products?category=${CATEGORIES[0]}&category=${CATEGORIES[1]}`), /category/);
  assertBadRequest(await get('/api/products?search=a&search=b'), /search/);
});

test('GET /api/products: an unknown category is 400 and lists the valid ones', async () => {
  const result = await get('/api/products?category=Spaceship');
  assertBadRequest(result, /category/i);
  assert.deepEqual(result.body.categories, [...CATEGORIES]);

  // A substring of a real category is not a match.
  assertBadRequest(await get(`/api/products?category=${encodeURIComponent(CATEGORIES[0].slice(0, 3))}`));
});

test('GET /api/products: a search longer than 100 characters is 400', async () => {
  assertBadRequest(await get(`/api/products?search=${'x'.repeat(101)}`), /search/);
});

// ---------------------------------------------------------------- one product

test('GET /api/products/:id returns the product', async () => {
  const product = products[0];
  const { status, type, body } = await get(`/api/products/${product.id}`);
  assert.equal(status, 200);
  assert.match(type, /application\/json/);
  assert.deepEqual(body, { success: true, data: product });
});

test('GET /api/products/:id accepts a lowercase id and surrounding spaces', async () => {
  const product = products[0];
  const lower = await get(`/api/products/${product.id.toLowerCase()}`);
  assert.equal(lower.status, 200);
  assert.deepEqual(lower.body.data, product);

  const padded = await get(`/api/products/${encodeURIComponent(` ${product.id} `)}`);
  assert.equal(padded.status, 200);
  assert.deepEqual(padded.body.data, product);
});

test('GET /api/products/:id finds every product', async () => {
  for (const product of products) {
    const { status, body } = await get(`/api/products/${product.id}`);
    assert.equal(status, 200);
    assert.equal(body.data.id, product.id);
  }
});

test('GET /api/products/:id is 404 for an unknown id', async () => {
  for (const id of ['P999999', 'nope', 'P000']) {
    const { status, body } = await get(`/api/products/${id}`);
    assert.equal(status, 404, id);
    assert.deepEqual(body, { success: false, message: 'Product not found' });
  }
});

// ---------------------------------------------------------------- other methods

test('unknown HTTP methods do not succeed', async () => {
  const id = products[0].id;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/api/products', `/api/products/${id}`]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked', price: 1 }),
      });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.ok, false);
      await response.arrayBuffer();
    }
  }
  // Nothing changed.
  const { body } = await get(`/api/products/${id}`);
  assert.deepEqual(body.data, products[0]);
});
