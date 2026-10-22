import { products } from '../data/products.js';

// Product lookups for the REST API and the Messenger catalog. The data lives in
// src/data/products.js, so everything here is plain in-memory array work.

export const CATALOG_PAGE_SIZE = 5;
const DEFAULT_LIMIT = 10;

const productsById = new Map(products.map((product) => [product.id.toUpperCase(), product]));

// Returns `value` when it is an integer >= 1, otherwise the fallback.
function positiveInt(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

function matchesCategory(product, category) {
  return product.category.toLowerCase() === category;
}

function matchesSearch(product, search) {
  const haystack = `${product.name} ${product.description} ${product.category}`.toLowerCase();
  return haystack.includes(search);
}

// Returns one page of products (available or not) plus pagination details.
// `total` and `totalPages` are counted after the filters; a page beyond the
// end gives an empty `data` array but still reports the correct totals.
export function listProducts({ page = 1, limit = DEFAULT_LIMIT, category, search } = {}) {
  const safePage = positiveInt(page, 1);
  const safeLimit = positiveInt(limit, DEFAULT_LIMIT);
  const categoryFilter = typeof category === 'string' ? category.trim().toLowerCase() : '';
  const searchFilter = typeof search === 'string' ? search.trim().toLowerCase() : '';

  let matches = products;
  if (categoryFilter) matches = matches.filter((product) => matchesCategory(product, categoryFilter));
  if (searchFilter) matches = matches.filter((product) => matchesSearch(product, searchFilter));

  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const start = (safePage - 1) * safeLimit;

  return {
    data: matches.slice(start, start + safeLimit),
    pagination: { page: safePage, limit: safeLimit, total, totalPages },
  };
}

// Finds a product by id, ignoring case and surrounding spaces ('p001' -> P001).
export function getProductById(id) {
  if (typeof id !== 'string') return null;
  return productsById.get(id.trim().toUpperCase()) ?? null;
}

// One page of the Messenger catalog: available products only. An out-of-range
// page is clamped into 1..totalPages and a non-integer page becomes 1.
export function getCatalogPage(page, pageSize = CATALOG_PAGE_SIZE) {
  const size = positiveInt(pageSize, CATALOG_PAGE_SIZE);
  const available = products.filter((product) => product.available);
  const totalPages = Math.max(1, Math.ceil(available.length / size));
  const current = Math.min(positiveInt(page, 1), totalPages);
  const start = (current - 1) * size;

  return {
    items: available.slice(start, start + size),
    page: current,
    totalPages,
    hasPrev: current > 1,
    hasNext: current < totalPages,
  };
}
