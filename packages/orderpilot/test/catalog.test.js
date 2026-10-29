import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_PAGE_SIZE, createCatalog, createPagedCatalog, isAvailable } from '../src/catalog.js';
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

// ---------------------------------------------------------------- createPagedCatalog (a shop's own queries)

// A fake database: the available fixture products, paged like LIMIT/OFFSET, recording every call.
function fakeDb(rows = available) {
  const calls = [];
  return {
    calls,
    getProduct: async (id) => {
      calls.push(['getProduct', id]);
      return rows.find((row) => row.id === id) ?? null;
    },
    listProducts: async (query) => {
      calls.push(['listProducts', query]);
      return { items: rows.slice(query.offset, query.offset + query.limit), total: rows.length };
    },
  };
}

test('paged: asks for one page only, with page, limit and offset', async () => {
  const db = fakeDb();
  const paged = createPagedCatalog(db);
  const page2 = await paged.getCatalogPage(2);

  assert.deepEqual(db.calls, [['listProducts', { page: 2, limit: 5, offset: 5 }]]);
  assert.deepEqual(page2, await getCatalogPage(2), 'the same page the array catalog gives');
  assert.equal(page2.hasPrev, true);
  assert.equal(page2.totalPages, expectedPages(available.length, CATALOG_PAGE_SIZE));
});

test('paged: a page past the end is asked again as the last page; a bad page is page 1', async () => {
  const db = fakeDb();
  const paged = createPagedCatalog(db);
  const last = expectedPages(available.length, CATALOG_PAGE_SIZE);

  const view = await paged.getCatalogPage(999);
  assert.equal(view.page, last);
  assert.equal(view.hasNext, false);
  assert.ok(view.items.length >= 1);
  assert.deepEqual(db.calls.map(([, query]) => query.page), [999, last]);

  for (const page of [0, -1, 1.5, '2', null]) assert.equal((await paged.getCatalogPage(page)).page, 1, String(page));
});

test('paged: skips unusable and unavailable rows, fills in defaults, never shows more than a page', async () => {
  const rows = [
    { id: 'A1', name: 'One', price: 100 },
    { id: 'A2', name: 'Hidden', price: 100, available: false },
    { id: 'A3', name: 'No price' },
    { id: 'A4', name: 'Four', price: 400 },
    { id: 'A5', name: 'Five', price: 500 },
    { id: 'A6', name: 'Six', price: 600 },
    { id: 'A7', name: 'Seven', price: 700 },
    { id: 'A8', name: 'Eight', price: 800 },
  ];
  // A query that ignores the limit: the bot still shows at most one page.
  const paged = createPagedCatalog({ getProduct: async () => null, listProducts: async () => ({ items: rows, total: 6 }) });
  const view = await paged.getCatalogPage(1);
  assert.deepEqual(view.items.map((product) => [product.id, product.currency]), [
    ['A1', 'BDT'],
    ['A4', 'BDT'],
    ['A5', 'BDT'],
    ['A6', 'BDT'],
    ['A7', 'BDT'],
  ]);
  assert.equal(view.totalPages, 2);
});

test('paged: without a usable total, nothing past the current page is offered', async () => {
  const paged = createPagedCatalog({
    getProduct: async () => null,
    listProducts: async ({ offset, limit }) => ({ items: available.slice(offset, offset + limit) }),
  });
  const view = await paged.getCatalogPage(2);
  assert.equal(view.page, 2);
  assert.equal(view.totalPages, 2);
  assert.equal(view.hasNext, false);
});

test('paged: getProduct gets the id as given, then in upper case', async () => {
  const db = fakeDb();
  const paged = createPagedCatalog(db);
  const first = available[0];

  assert.equal((await paged.getProductById(first.id)).id, first.id);
  assert.equal((await paged.getProductById(`  ${first.id.toLowerCase()}  `)).id, first.id);
  assert.deepEqual(db.calls, [
    ['getProduct', first.id],
    ['getProduct', first.id.toLowerCase()],
    ['getProduct', first.id],
  ]);

  db.calls.length = 0;
  assert.equal(await paged.getProductById('NOPE'), null);
  assert.deepEqual(db.calls, [['getProduct', 'NOPE']], 'an upper-case id is asked once');
  for (const id of [null, undefined, '', '  ', 7]) assert.equal(await paged.getProductById(id), null);
  assert.equal(db.calls.length, 1, 'no query for an empty id');
});

test('paged: a row that is not a usable product is not found; an unavailable one is', async () => {
  const paged = createPagedCatalog({
    getProduct: async (id) => ({ X: { id: 'X', name: 'No price' }, Y: { id: 'Y', name: 'Off', price: 10, available: false } })[id] ?? null,
    listProducts: async () => ({ items: [], total: 0 }),
  });
  assert.equal(await paged.getProductById('X'), null);
  assert.deepEqual(await paged.getProductById('Y'), { id: 'Y', name: 'Off', price: 10, available: false, currency: 'BDT' });
});

test('paged: a failing query rejects, so the conversation can answer with its fallback', async () => {
  const paged = createPagedCatalog({
    getProduct: async () => {
      throw new Error('db down');
    },
    listProducts: async () => {
      throw new Error('db down');
    },
  });
  await assert.rejects(paged.getProductById('P001'), /db down/);
  await assert.rejects(paged.getCatalogPage(1), /db down/);
});

