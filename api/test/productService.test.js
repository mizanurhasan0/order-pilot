import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, products } from '../src/data/products.js';
import {
  CATALOG_PAGE_SIZE,
  getCatalogPage,
  getProductById,
  listProducts,
} from '../src/services/productService.js';

// The data module is the single source of truth: every expectation below is
// computed from it, so these tests keep working when the catalog changes.

const available = products.filter((product) => product.available);

function expectedPages(total, size) {
  return Math.max(1, Math.ceil(total / size));
}

// First word of the product name, lower case ('Premium' -> 'premium').
function firstWord(text) {
  return text.split(/\s+/)[0].toLowerCase();
}

function haystack(product) {
  return `${product.name} ${product.description} ${product.category}`.toLowerCase();
}

// Finds a product whose description has a word that is NOT in its name or
// category, so a match on that word can only come from the description.
function findDescriptionOnlyWord() {
  for (const product of products) {
    const own = `${product.name} ${product.category}`.toLowerCase();
    const words = product.description.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const word = words.find((candidate) => !own.includes(candidate));
    if (word) return { product, word };
  }
  return null;
}

// ---------------------------------------------------------------- data

test('data: products and categories look like the documented schema', () => {
  assert.ok(products.length > 0);
  assert.ok(CATEGORIES.length > 0);
  const ids = new Set();
  for (const product of products) {
    assert.match(product.id, /^P\d{3}$/);
    assert.ok(!ids.has(product.id), `duplicate id ${product.id}`);
    ids.add(product.id);
    assert.ok(CATEGORIES.includes(product.category), `${product.id} has an unknown category`);
    assert.ok(Number.isInteger(product.price) && product.price > 0);
    assert.equal(product.currency, 'BDT');
    assert.equal(typeof product.available, 'boolean');
  }
});

// ---------------------------------------------------------------- listProducts

test('listProducts: defaults are page 1 and limit 10 over every product', () => {
  const { data, pagination } = listProducts();
  assert.deepEqual(pagination, {
    page: 1,
    limit: 10,
    total: products.length,
    totalPages: expectedPages(products.length, 10),
  });
  assert.deepEqual(data, products.slice(0, 10));
});

test('listProducts: an empty options object behaves like the defaults', () => {
  assert.deepEqual(listProducts({}), listProducts());
});

test('listProducts: pagination math holds for several limits and walks every product once', () => {
  for (const limit of [1, 3, 7, 10, 50]) {
    const first = listProducts({ page: 1, limit });
    const { total, totalPages } = first.pagination;
    assert.equal(total, products.length);
    assert.equal(totalPages, expectedPages(products.length, limit));

    const seen = [];
    for (let page = 1; page <= totalPages; page += 1) {
      const result = listProducts({ page, limit });
      assert.deepEqual(result.pagination, { page, limit, total, totalPages });
      assert.ok(result.data.length >= 1 && result.data.length <= limit);
      seen.push(...result.data);
    }
    assert.deepEqual(seen, [...products], `limit ${limit} must cover the catalog in order`);
  }
});

test('listProducts: limit 50 returns up to 50 products', () => {
  const { data, pagination } = listProducts({ limit: 50 });
  assert.equal(data.length, Math.min(50, products.length));
  assert.equal(pagination.limit, 50);
  assert.equal(pagination.totalPages, expectedPages(products.length, 50));
});

test('listProducts: a page beyond the end is empty but reports the right pagination', () => {
  const limit = 4;
  const totalPages = expectedPages(products.length, limit);
  const { data, pagination } = listProducts({ page: totalPages + 1, limit });
  assert.deepEqual(data, []);
  assert.deepEqual(pagination, {
    page: totalPages + 1,
    limit,
    total: products.length,
    totalPages,
  });

  assert.deepEqual(listProducts({ page: 100_000 }).data, []);
});

test('listProducts: lists every product, not only the available ones', () => {
  assert.deepEqual(listProducts({ limit: 50 }).data, products.slice(0, 50));
});

test('listProducts: category filter matches exactly and ignores case and spaces', () => {
  for (const category of CATEGORIES) {
    const expected = products.filter((product) => product.category === category);
    const { data, pagination } = listProducts({ category, limit: 50 });
    assert.deepEqual(data, expected.slice(0, 50));
    assert.equal(pagination.total, expected.length);
    assert.equal(pagination.totalPages, expectedPages(expected.length, 50));

    for (const variant of [category.toLowerCase(), category.toUpperCase(), `  ${category}  `]) {
      assert.deepEqual(listProducts({ category: variant, limit: 50 }), listProducts({ category, limit: 50 }));
    }
  }
});

test('listProducts: pagination counts only the filtered products', () => {
  const category = products[0].category;
  const expected = products.filter((product) => product.category === category);
  const first = listProducts({ category, limit: 1 });
  assert.equal(first.pagination.total, expected.length);
  assert.equal(first.pagination.totalPages, expected.length);
  assert.deepEqual(first.data, [expected[0]]);
});

test('listProducts: an unknown category matches nothing', () => {
  const { data, pagination } = listProducts({ category: 'Spaceship' });
  assert.deepEqual(data, []);
  assert.deepEqual(pagination, { page: 1, limit: 10, total: 0, totalPages: 1 });
});

test('listProducts: search is case-insensitive over name', () => {
  const term = firstWord(products[0].name);
  const expected = products.filter((product) => haystack(product).includes(term));
  assert.ok(expected.includes(products[0]));

  for (const variant of [term, term.toUpperCase(), `  ${term}  `]) {
    const { data, pagination } = listProducts({ search: variant, limit: 50 });
    assert.deepEqual(data, expected.slice(0, 50));
    assert.equal(pagination.total, expected.length);
  }
});

test('listProducts: search also matches the description', () => {
  const found = findDescriptionOnlyWord();
  assert.ok(found, 'the data needs at least one description word that is not in its name or category');
  const { data } = listProducts({ search: found.word.toUpperCase(), limit: 50 });
  assert.ok(data.includes(found.product));
  for (const product of data) assert.ok(haystack(product).includes(found.word));
});

test('listProducts: search also matches the category', () => {
  const category = products[0].category;
  const { data, pagination } = listProducts({ search: category.toLowerCase(), limit: 50 });
  for (const product of products.filter((item) => item.category === category)) {
    assert.ok(data.includes(product), `${product.id} should match its own category name`);
  }
  assert.equal(pagination.total, products.filter((product) => haystack(product).includes(category.toLowerCase())).length);
});

test('listProducts: a search with no match gives total 0 and totalPages 1', () => {
  const { data, pagination } = listProducts({ search: 'zzz-no-such-product-zzz' });
  assert.deepEqual(data, []);
  assert.deepEqual(pagination, { page: 1, limit: 10, total: 0, totalPages: 1 });
});

test('listProducts: a blank search or category applies no filter', () => {
  const everything = listProducts({ limit: 50 });
  assert.deepEqual(listProducts({ search: '   ', limit: 50 }), everything);
  assert.deepEqual(listProducts({ category: '   ', limit: 50 }), everything);
  assert.deepEqual(listProducts({ search: undefined, category: undefined, limit: 50 }), everything);
});

test('listProducts: category and search combine (both must match)', () => {
  const target = products[0];
  const search = firstWord(target.name);
  const expected = products.filter(
    (product) => product.category === target.category && haystack(product).includes(search),
  );
  const { data, pagination } = listProducts({ category: target.category.toUpperCase(), search, limit: 50 });
  assert.deepEqual(data, expected.slice(0, 50));
  assert.equal(pagination.total, expected.length);
  assert.ok(data.includes(target));

  // A category that does not contain the target product never returns it.
  const other = CATEGORIES.find((name) => name !== target.category);
  const { data: others } = listProducts({ category: other, search: target.name, limit: 50 });
  assert.ok(!others.includes(target));
});

test('listProducts: invalid page or limit values fall back to the defaults', () => {
  const defaults = listProducts();
  for (const page of [0, -1, 1.5, NaN, 'abc', null, undefined]) {
    assert.equal(listProducts({ page }).pagination.page, 1, `page ${String(page)}`);
  }
  for (const limit of [0, -5, 2.5, NaN, 'abc', null]) {
    assert.deepEqual(listProducts({ limit }), defaults, `limit ${String(limit)}`);
  }
});

test('listProducts: the returned array can be changed without affecting the catalog', () => {
  const first = listProducts({ limit: 50 });
  const length = first.data.length;
  first.data.push({ id: 'FAKE' });
  first.data.length = 0;
  assert.equal(listProducts({ limit: 50 }).data.length, length);
  assert.equal(listProducts({ limit: 50 }).pagination.total, products.length);
});

// ---------------------------------------------------------------- getProductById

test('getProductById: finds every product by its exact id', () => {
  for (const product of products) assert.equal(getProductById(product.id), product);
});

test('getProductById: ignores case and surrounding spaces', () => {
  const { id } = products[0];
  assert.equal(getProductById(id.toLowerCase()), products[0]);
  assert.equal(getProductById(id.toUpperCase()), products[0]);
  assert.equal(getProductById(`  ${id.toLowerCase()}\t`), products[0]);
  assert.equal(getProductById(`\n${id}\n`), products[0]);
});

test('getProductById: unknown ids return null', () => {
  for (const id of ['P999999', 'X001', '', '   ', 'P', `${products[0].id} extra`, `${products[0].id}x`]) {
    assert.equal(getProductById(id), null, JSON.stringify(id));
  }
});

test('getProductById: non-string input returns null', () => {
  for (const id of [undefined, null, 1, 0, NaN, true, {}, [], [products[0].id], () => products[0].id]) {
    assert.equal(getProductById(id), null);
  }
});

// ---------------------------------------------------------------- getCatalogPage

test('getCatalogPage: the default page size is 5', () => {
  assert.equal(CATALOG_PAGE_SIZE, 5);
  const { items, page, totalPages } = getCatalogPage(1);
  assert.equal(items.length, Math.min(5, available.length));
  assert.equal(page, 1);
  assert.equal(totalPages, expectedPages(available.length, 5));
  assert.deepEqual(getCatalogPage(1), getCatalogPage(1, CATALOG_PAGE_SIZE));
});

test('getCatalogPage: walks only the available products, in order, with correct hasPrev/hasNext', () => {
  const { totalPages } = getCatalogPage(1);
  const seen = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const result = getCatalogPage(page);
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

test('getCatalogPage: an out-of-range page is clamped into 1..totalPages', () => {
  const { totalPages } = getCatalogPage(1);
  const last = getCatalogPage(totalPages);

  for (const page of [totalPages + 1, totalPages + 100, 1_000_000]) {
    assert.deepEqual(getCatalogPage(page), last, `page ${page}`);
  }
  assert.equal(last.hasNext, false);

  for (const page of [0, -1, -100]) {
    assert.deepEqual(getCatalogPage(page), getCatalogPage(1), `page ${page}`);
  }
  assert.equal(getCatalogPage(0).hasPrev, false);
});

test('getCatalogPage: NaN, float, string and missing pages become page 1', () => {
  const first = getCatalogPage(1);
  for (const page of [NaN, 1.5, 2.9, -0.5, Infinity, '2', 'abc', null, undefined, {}]) {
    assert.deepEqual(getCatalogPage(page), first, `page ${String(page)}`);
  }
});

test('getCatalogPage: supports a custom page size', () => {
  const size = 3;
  const first = getCatalogPage(1, size);
  assert.equal(first.items.length, Math.min(size, available.length));
  assert.equal(first.totalPages, expectedPages(available.length, size));
  assert.deepEqual(first.items, available.slice(0, size));

  const seen = [];
  for (let page = 1; page <= first.totalPages; page += 1) seen.push(...getCatalogPage(page, size).items);
  assert.deepEqual(seen, available);

  // One huge page holds everything.
  const all = getCatalogPage(1, 10_000);
  assert.deepEqual(all.items, available);
  assert.equal(all.totalPages, 1);
  assert.equal(all.hasPrev, false);
  assert.equal(all.hasNext, false);
});

test('getCatalogPage: an invalid page size falls back to 5', () => {
  const expected = getCatalogPage(1);
  for (const size of [0, -3, 2.5, NaN, 'abc', null]) {
    assert.deepEqual(getCatalogPage(1, size), expected, `size ${String(size)}`);
  }
});

test('getCatalogPage: changing the returned items does not affect the catalog', () => {
  const result = getCatalogPage(1);
  const expected = [...result.items];
  result.items.length = 0;
  assert.deepEqual(getCatalogPage(1).items, expected);
});
