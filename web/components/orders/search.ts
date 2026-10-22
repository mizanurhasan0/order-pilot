import type { DashboardOrder } from '@/lib/types';

const PHONE_LIKE = /^[\d\s()+-]+$/;
const digitsOf = (value: string) => value.replace(/\D/g, '');

// Every word must match one of: order id, product name/id, phone, address.
// Phone-like queries also match ignoring spaces and dashes ("017 1234" finds "01712345678").
export function matchesQuery(order: DashboardOrder, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [order.id, order.productName, order.productId, order.phone, order.address]
    .join(' ')
    .toLowerCase();
  if (needle.split(/\s+/).every((term) => haystack.includes(term))) return true;

  const digits = digitsOf(needle);
  return PHONE_LIKE.test(needle) && digits.length > 0 && digitsOf(order.phone).includes(digits);
}
