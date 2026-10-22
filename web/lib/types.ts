// Shared types for the Express backend (../api) and the dashboard UI.
//
// Backend shapes mirror api/src/store/orderStore.js and api/src/data/products.js.
// If the backend changes a field, change it here first and let the compiler point
// at every place that needs an update.

// ---------------------------------------------------------------------------
// Backend domain
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);

// GET /api/orders, GET /api/orders/:id, PATCH /api/orders/:id/status (admin key required)
export type Order = {
  id: string; // "ORD-1001"
  productId: string; // "P001"
  productName: string;
  quantity: number;
  unitPrice: number; // whole currency units
  subtotal: number; // unitPrice * quantity
  currency: string; // "BDT"
  customerPsid: string; // Messenger page-scoped id
  phone: string;
  address: string;
  status: OrderStatus;
  createdAt: string; // ISO 8601
};

// GET /api/products, GET /api/products/:id (public)
export type Product = {
  id: string; // "P001"
  name: string;
  description: string;
  category: string;
  price: number;
  currency: string;
  imageUrl: string; // public HTTPS URL
  available: boolean;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Backend validation limits (api/src/routes/products.js).
export const PRODUCTS_MAX_LIMIT = 50;
export const PRODUCTS_DEFAULT_LIMIT = 10;
export const PRODUCTS_MAX_SEARCH_LENGTH = 100;

export type ProductQuery = {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
};

// Express list payloads, without the { success } envelope (services/http.ts unwraps it).
export type OrderList = { data: Order[]; count: number };
export type ProductList = { data: Product[]; pagination: Pagination };

// ---------------------------------------------------------------------------
// Dashboard view models (computed in the browser)
// ---------------------------------------------------------------------------

// An order joined with live catalog details. `product` is null when the product
// is no longer in the catalog or the catalog has not loaded.
export type DashboardOrder = Order & {
  product: Pick<Product, 'imageUrl' | 'description' | 'category' | 'available'> | null;
};

export type OrdersSummary = {
  total: number;
  pending: number;
  confirmed: number;
  cancelled: number;
  confirmedValue: number; // sum of confirmed subtotals
  currency: string;
};

export type HealthStatus = {
  latencyMs: number;
  checkedAt: string; // ISO 8601
};
