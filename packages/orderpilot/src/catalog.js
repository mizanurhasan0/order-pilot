// The products the bot sells, from whatever the shop passes to createOrderPilot():
// an array, or a function (sync or async) that returns one, for example a database query. The
// function is called on every lookup, so a changed product shows up at once; cache inside it
// when the query is expensive.
//
// Product = { id, name, price, imageUrl, description?, category?, currency?, available? }
//   id        "P001": what customers type and what product links carry (case-insensitive)
//   price     whole currency units (৳1250 is 1250), a positive integer
//   imageUrl  a public HTTPS image (Messenger fetches it); square photos look best
//   currency  defaults to "BDT"; available defaults to true (false hides the product)
// Products without a usable id, name or price are skipped.

export const CATALOG_PAGE_SIZE = 5;
export const DEFAULT_CURRENCY = 'BDT';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

const isProduct = (value) =>
  value !== null &&
  typeof value === 'object' &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.name) &&
  Number.isSafeInteger(value.price) &&
  value.price > 0;

const withDefaults = (product) =>
  isNonEmptyString(product.currency) ? product : { ...product, currency: DEFAULT_CURRENCY };

export const isAvailable = (product) => product?.available !== false;

// Returns `value` when it is an integer >= 1, otherwise the fallback.
function positiveInt(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

export function createCatalog(source = []) {
  if (!Array.isArray(source) && typeof source !== 'function') {
    throw new TypeError('products must be an array of products or a function that returns one');
  }

  async function all() {
    const list = typeof source === 'function' ? await source() : source;
    return Array.isArray(list) ? list.filter(isProduct).map(withDefaults) : [];
  }

  return {
    // Finds a product by id, ignoring case and surrounding spaces ('p001' -> P001), available or not.
    async getProductById(id) {
      if (typeof id !== 'string' || id.trim() === '') return null;
      const wanted = id.trim().toUpperCase();
      return (await all()).find((product) => product.id.trim().toUpperCase() === wanted) ?? null;
    },

    // One page of the Messenger catalog: available products only. An out-of-range
    // page is clamped into 1..totalPages and a non-integer page becomes 1.
    async getCatalogPage(page, pageSize = CATALOG_PAGE_SIZE) {
      const size = positiveInt(pageSize, CATALOG_PAGE_SIZE);
      const available = (await all()).filter(isAvailable);
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
    },
  };
}
