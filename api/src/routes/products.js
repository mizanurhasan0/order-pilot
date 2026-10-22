import express from 'express';
import { CATEGORIES } from '../data/products.js';
import { getProductById, listProducts } from '../services/productService.js';

const router = express.Router();

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_SEARCH_LENGTH = 100;

function badRequest(res, message, extra = {}) {
  return res.status(400).json({ success: false, message, ...extra });
}

// Strict whole-number parsing: only plain digits are accepted, so '1.5', '1e2',
// '+1', ' 1' and '' are all rejected. Returns null when the value is invalid.
function parseWholeNumber(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

// Returns { query } with the cleaned values, or { error, extra? } for a 400.
// Repeated query parameters arrive as arrays and are rejected as well.
function parseListQuery(query) {
  let page = 1;
  if (query.page !== undefined) {
    page = parseWholeNumber(query.page);
    if (page === null || page < 1) return { error: 'page must be an integer of 1 or more' };
  }

  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    limit = parseWholeNumber(query.limit);
    if (limit === null || limit < 1 || limit > MAX_LIMIT) {
      return { error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
    }
  }

  let category;
  if (query.category !== undefined) {
    if (typeof query.category !== 'string') return { error: 'category must be a single value' };
    const wanted = query.category.trim().toLowerCase();
    if (wanted !== '') {
      category = CATEGORIES.find((name) => name.toLowerCase() === wanted);
      if (!category) {
        return { error: 'Unknown category', extra: { categories: [...CATEGORIES] } };
      }
    }
  }

  let search;
  if (query.search !== undefined) {
    if (typeof query.search !== 'string') return { error: 'search must be a single value' };
    search = query.search.trim();
    if (search.length > MAX_SEARCH_LENGTH) {
      return { error: `search must be at most ${MAX_SEARCH_LENGTH} characters` };
    }
  }

  return { query: { page, limit, category, search } };
}

// GET /api/products?page=1&limit=10&category=Saree&search=cotton
router.get('/', (req, res) => {
  const { query, error, extra } = parseListQuery(req.query);
  if (error) return badRequest(res, error, extra);

  const { data, pagination } = listProducts(query);
  return res.json({ success: true, data, pagination });
});

// GET /api/products/P001 (the id is case-insensitive)
router.get('/:id', (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  return res.json({ success: true, data: product });
});

export default router;
