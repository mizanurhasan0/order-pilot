import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_PAGE_SIZE, createCatalog, isAvailable } from '../src/catalog.js';
import { products } from './fixtures/products.js';

const available = products.filter((product) => product.available);
const catalog = createCatalog(products);
const getCatalogPage = (page, size) => catalog.getCatalogPage(page, size);

function expectedPages(total, size) {
  return Math.max(1, Math.ceil(total / size));
}

// ---------------------------------------------------------------- sources

test('products must be an array or a function', () => {
  for (const bad of [null, 'P001', 42, { id: 'P001' }]) {
    assert.throws(() => createCatalog(bad), TypeError, String(bad));
  }
  assert.doesNotThrow(() => createCatalog());
});

test('a function source (sync or async) is read on every lookup', async () => {
  let calls = 0;
  let rows = [{ id: 'A1', name: 'One', price: 100 }];
  const fromDb = createCatalog(async () => {
    calls += 1;
    return rows;
  });
  assert.equal((await fromDb.getProductById('a1')).name, 'One');
  rows = [{ id: 'A1', name: 'Renamed', price: 100 }];
  assert.equal((await fromDb.getProductById('A1')).name, 'Renamed');
  assert.equal(calls, 2);

  const sync = createCatalog(() => rows);
  assert.equal((await sync.getCatalogPage(1)).items.length, 1);
  // Anything but an array from the function means no products.
  assert.deepEqual((await createCatalog(async () => null).getCatalogPage(1)).items, []);
});

test('invalid products are skipped; currency and availability get defaults', async () => {
  const mixed = createCatalog([
    { id: 'OK1', name: 'Fine', price: 500 },
    { id: 'OK2', name: 'Priced', price: 700, currency: 'USD', available: true },
    { id: 'OFF', name: 'Hidden', price: 300, available: false },
    { id: '', name: 'No id', price: 100 },
    { id: 'NONAME', price: 100 },
    { id: 'FREE', name: 'Zero', price: 0 },
    { id: 'HALF', name: 'Decimal', price: 99.5 },
    { id: 7, name: 'Number id', price: 100 },
    null,
    'P001',
  ]);
  const page = await mixed.getCatalogPage(1);
  assert.deepEqual(page.items.map((product) => [product.id, product.currency]), [['OK1', 'BDT'], ['OK2', 'USD']]);
  assert.equal((await mixed.getProductById('off')).available, false, 'an unavailable product can still be looked up');
  assert.equal(await mixed.getProductById('HALF'), null);
  assert.equal(await mixed.getProductById('  ok1  ').then((product) => product.id), 'OK1');
  for (const id of [null, undefined, '', '   ', 7]) assert.equal(await mixed.getProductById(id), null);
});

test('isAvailable: only available === false hides a product', () => {
  assert.equal(isAvailable({ available: false }), false);
  assert.equal(isAvailable({ available: true }), true);
  assert.equal(isAvailable({}), true);
});

// ---------------------------------------------------------------- getCatalogPage

test('getCatalogPage: the default page size is 5', async () => {
  assert.equal(CATALOG_PAGE_SIZE, 5);
  const { items, page, totalPages } = await getCatalogPage(1);
  assert.equal(items.length, Math.min(5, available.length));
  assert.equal(page, 1);
  assert.equal(totalPages, expectedPages(available.length, 5));
  assert.deepEqual(await getCatalogPage(1), await getCatalogPage(1, CATALOG_PAGE_SIZE));
});

test('getCatalogPage: walks only the available products, in order, with correct hasPrev/hasNext', async () => {
  const { totalPages } = await getCatalogPage(1);
  const seen = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const result = await getCatalogPage(page);
    assert.equal(result.page, page);
    assert.equal(result.totalPages, totalPages);
    assert.equal(result.hasPrev, page > 1);
    assert.equal(result.hasNext, page < totalPages);
    assert.ok(result.items.length >= 1 && result.items.length <= CATALOG_PAGE_SIZE);
    for (const item of result.items) assert.equal(item.available, true);
    seen.push(...result.items);
  }
  assert.deepEqual(seen, available);
});

test('getCatalogPage: an out-of-range page is clamped into 1..totalPages', async () => {
  const { totalPages } = await getCatalogPage(1);
  const last = await getCatalogPage(totalPages);

  for (const page of [totalPages + 1, totalPages + 100, 1_000_000]) {
    assert.deepEqual(await getCatalogPage(page), last, `page ${page}`);
  }
  assert.equal(last.hasNext, false);

  for (const page of [0, -1, -100]) {
    assert.deepEqual(await getCatalogPage(page), await getCatalogPage(1), `page ${page}`);
  }
  assert.equal((await getCatalogPage(0)).hasPrev, false);
});

test('getCatalogPage: NaN, float, string and missing pages become page 1', async () => {
  const first = await getCatalogPage(1);
  for (const page of [NaN, 1.5, 2.9, -0.5, Infinity, '2', 'abc', null, undefined, {}]) {
    assert.deepEqual(await getCatalogPage(page), first, `page ${String(page)}`);
  }
});

test('getCatalogPage: supports a custom page size', async () => {
  const size = 3;
  const first = await getCatalogPage(1, size);
  assert.equal(first.items.length, Math.min(size, available.length));
  assert.equal(first.totalPages, expectedPages(available.length, size));
  assert.deepEqual(first.items, available.slice(0, size));

  const seen = [];
  for (let page = 1; page <= first.totalPages; page += 1) seen.push(...(await getCatalogPage(page, size)).items);
  assert.deepEqual(seen, available);

  // One huge page holds everything.
  const all = await getCatalogPage(1, 10_000);
  assert.deepEqual(all.items, available);
  assert.equal(all.totalPages, 1);
  assert.equal(all.hasPrev, false);
  assert.equal(all.hasNext, false);
});

test('getCatalogPage: an invalid page size falls back to 5', async () => {
  const expected = await getCatalogPage(1);
  for (const size of [0, -3, 2.5, NaN, 'abc', null]) {
    assert.deepEqual(await getCatalogPage(1, size), expected, `size ${String(size)}`);
  }
});

test('getCatalogPage: changing the returned items does not affect the catalog', async () => {
  const result = await getCatalogPage(1);
  const expected = [...result.items];
  result.items.length = 0;
  assert.deepEqual((await getCatalogPage(1)).items, expected);
});
