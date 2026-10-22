// Pure helpers that turn raw backend orders into what the dashboard shows.
import type { DashboardOrder, Order, OrdersSummary, Product } from './types';

// Upper-cased id → product, matching the backend's case-insensitive ids.
export type CatalogIndex = ReadonlyMap<string, Product>;

export const indexCatalog = (products: readonly Product[]): CatalogIndex =>
  new Map(products.map((product) => [product.id.toUpperCase(), product]));

export function enrichOrder(order: Order, catalog: CatalogIndex | null): DashboardOrder {
  const product = catalog?.get(order.productId.toUpperCase());
  return {
    ...order,
    product: product
      ? { imageUrl: product.imageUrl, description: product.description, category: product.category, available: product.available }
      : null,
  };
}

export function summarizeOrders(orders: readonly Order[]): OrdersSummary {
  const summary: OrdersSummary = {
    total: orders.length,
    pending: 0,
    confirmed: 0,
    cancelled: 0,
    confirmedValue: 0,
    currency: orders[0]?.currency ?? 'BDT',
  };
  for (const order of orders) {
    summary[order.status] += 1;
    if (order.status === 'confirmed') summary.confirmedValue += order.subtotal;
  }
  return summary;
}

// Unique categories in first-seen order (the catalog interleaves them on purpose).
export const categoriesOf = (products: readonly Product[]) => [...new Set(products.map((product) => product.category))];
