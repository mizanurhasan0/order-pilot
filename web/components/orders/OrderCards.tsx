import { ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { ProductImage } from '@/components/ui/ProductImage';
import { STATUS_LABELS, StatusPill } from '@/components/ui/StatusPill';
import { NewBadge, OrderTime, activateOnKey } from './OrderMeta';
import type { OrderListProps } from './OrdersTable';

// Stacked list below xl.
export function OrderCards({ orders, freshIds, now, onSelect }: OrderListProps) {
  return (
    <ul className="divide-y divide-line-soft">
      {orders.map((order) => {
        const fresh = freshIds.has(order.id);
        const open = () => onSelect(order.id);
        return (
          <li key={order.id}>
            <div
              role="button"
              tabIndex={0}
              aria-label={`${order.id}, ${order.productName}, ${STATUS_LABELS[order.status]}`}
              onClick={open}
              onKeyDown={(event) => activateOnKey(event, open)}
              className={`flex cursor-pointer items-start gap-3 px-5 py-4 transition-colors duration-700 hover:bg-[#f8fbf8] focus-visible:-outline-offset-2! ${
                fresh ? 'bg-brand-50' : ''
              }`}
            >
              <ProductImage src={order.product?.imageUrl} alt="" />

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{order.id}</span>
                    {fresh && <NewBadge />}
                  </div>
                  <StatusPill status={order.status} />
                </div>
                <p className="mt-1 truncate text-sm text-ink-soft">{order.productName}</p>
                <div className="mt-1.5 flex items-end justify-between gap-3">
                  <div className="min-w-0 text-xs text-muted">
                    <p>
                      {order.quantity} × {formatMoney(order.unitPrice, order.currency)}
                    </p>
                    <p className="mt-0.5 truncate">{order.phone || 'Phone not provided'}</p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-ink">
                    {formatMoney(order.subtotal, order.currency)}
                  </p>
                </div>
                <OrderTime createdAt={order.createdAt} now={now} className="mt-1.5 block" />
              </div>

              <ChevronRight size={17} aria-hidden className="mt-1 shrink-0 text-subtle" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
