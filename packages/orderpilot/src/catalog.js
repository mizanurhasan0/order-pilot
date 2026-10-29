// The products the bot sells. A shop gives createOrderPilot() one of two things:
//
//   products  an array, or a function (sync or async) that returns the whole list. Simple, and fine
//             for a few hundred products: the function runs on every lookup (createCatalog).
//   catalog   two functions over the shop's own database, for a large catalog: the bot then only
//             ever asks for one page of products or one product (createPagedCatalog).
//
// Product = { id, name, price, imageUrl, description?, category?, currency?, available? }
//   id        "P001": what customers type and what product links carry
//   price     whole currency units (৳1250 is 1250), a positive integer
//   imageUrl  a public HTTPS image (Messenger fetches it); square photos look best
//   currency  defaults to "BDT"; available defaults to true (false hides the product)
// Products without a usable id, name or price are skipped.
//
// Both give the conversation the same two async methods: getProductById(id) and
// getCatalogPage(page, pageSize).

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

// The products of a list a customer may see, with defaults filled in.
const sellable = (list) => (Array.isArray(list) ? list.filter((item) => isProduct(item) && isAvailable(item)).map(withDefaults) : []);

// Returns `value` when it is an integer >= 1, otherwise the fallback.
function positiveInt(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

const totalPagesOf = (total, size) => Math.max(1, Math.ceil(total / size));

const pageView = (items, page, totalPages) => ({
  items,
  page,
  totalPages,
  hasPrev: page > 1,
  hasNext: page < totalPages,
});

// ---------- products: an array, or a function returning the whole list ----------

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
      const totalPages = totalPagesOf(available.length, size);
      const current = Math.min(positiveInt(page, 1), totalPages);
      const start = (current - 1) * size;
      return pageView(available.slice(start, start + size), current, totalPages);
    },
  };
}

// ---------- catalog: the shop's own paged queries ----------

// adapter = {
//   getProduct(id)                         -> the product, or null (available or not)
//   listProducts({ page, limit, offset })  -> { items, total }: one page of the products customers
//                                             may order, and how many there are in all
// }
// Both may be async. A failing query rejects, and the bot answers with its fallback message.
export function createPagedCatalog(adapter) {
  async function fetchPage(page, size) {
    const result = await adapter.listProducts({ page, limit: size, offset: (page - 1) * size });
    const items = sellable(result?.items).slice(0, size);
    // Without a usable total, nothing past this page is offered.
    const total = Number.isSafeInteger(result?.total) && result.total >= 0 ? result.total : (page - 1) * size + items.length;
    return { items, total };
  }

  return {
    // The id as written on a button, or as the customer typed it (in lower case). Tried as given,
    // then in upper case, so P001-style ids match whichever way they were typed.
    async getProductById(id) {
      if (typeof id !== 'string' || id.trim() === '') return null;
      const wanted = id.trim();
      let product = await adapter.getProduct(wanted);
      if (!product && wanted !== wanted.toUpperCase()) product = await adapter.getProduct(wanted.toUpperCase());
      return isProduct(product) ? withDefaults(product) : null;
    },

    // Asks for one page only. A page past the end (an old Next button, a shrunk catalog) is asked
    // again as the last page.
    async getCatalogPage(page, pageSize = CATALOG_PAGE_SIZE) {
      const size = positiveInt(pageSize, CATALOG_PAGE_SIZE);
      let current = positiveInt(page, 1);
      let { items, total } = await fetchPage(current, size);
      const totalPages = totalPagesOf(total, size);
      if (current > totalPages) {
        current = totalPages;
        ({ items } = await fetchPage(current, size));
      }
      return pageView(items, current, totalPages);
    },
  };
}
