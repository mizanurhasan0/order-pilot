// Express product routes (public).
import { PRODUCTS_MAX_LIMIT, type Product, type ProductList, type ProductQuery } from '@/lib/types';
import { request } from './http';

// Drops empty values so the backend sees exactly what was asked for.
const cleanQuery = ({ page, limit, category, search }: ProductQuery) => ({
  page,
  limit,
  category: category?.trim() || undefined,
  search: search?.trim() || undefined,
});

const MAX_PAGES = 20;

export const productService = {
  // GET /api/products?page&limit&category&search
  list: (query: ProductQuery = {}, signal?: AbortSignal) =>
    request<ProductList>({ method: 'GET', url: '/api/products', params: cleanQuery(query), signal }),

  // GET /api/products/:id (case-insensitive)
  getById: async (id: string, signal?: AbortSignal): Promise<Product> =>
    (await request<{ data: Product }>({ method: 'GET', url: `/api/products/${encodeURIComponent(id)}`, signal })).data,

  // The whole catalog, paged at the backend's maximum limit of 50.
  async listAll(signal?: AbortSignal): Promise<Product[]> {
    const products: Product[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, pagination } = await productService.list({ page, limit: PRODUCTS_MAX_LIMIT }, signal);
      products.push(...data);
      if (page >= pagination.totalPages) break;
    }
    return products;
  },
};
