import { ChevronRight } from 'lucide-react';
import type { DashboardOrder } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { ProductImage } from '@/components/ui/ProductImage';
import { StatusPill } from '@/components/ui/StatusPill';
import { NewBadge, OrderTime, activateOnKey } from './OrderMeta';

export type OrderListProps = {
  orders: DashboardOrder[];
  freshIds: ReadonlySet<string>;
  now?: number;
  onSelect: (id: string) => void;
};

const HEAD_CELL = 'py-4 font-bold';

// Wide list (xl and up): below that the sidebar leaves too little room for six columns.
export function OrdersTable({ orders, freshIds, now, onSelect }: OrderListProps) {
  return (
    <div className="soft-scroll relative overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <caption className="sr-only">Orders. Select a row to see its details.</caption>
        <thead>
          <tr className="border-b border-line-soft bg-[#fcfdfc] text-[10px] uppercase tracking-[.12em] text-subtle">
            <th scope="col" className={`${HEAD_CELL} pl-6 pr-4`}>Order</th>
            <th scope="col" className={`${HEAD_CELL} px-4`}>Product</th>
            <th scope="col" className={`${HEAD_CELL} px-4`}>Customer</th>
            <th scope="col" className={`${HEAD_CELL} px-4`}>Amount</th>
            <th scope="col" className={`${HEAD_CELL} px-4`}>Status</th>
            <th scope="col" className={`${HEAD_CELL} pl-2 pr-6`}>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              fresh={freshIds.has(order.id)}
              now={now}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderRow({ order, fresh, now, onSelect }: {
  order: DashboardOrder;
  fresh: boolean;
  now?: number;
  onSelect: (id: string) => void;
}) {
  const open = () => onSelect(order.id);

  return (
    <tr
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => activateOnKey(event, open)}
      className={`group cursor-pointer border-b border-line-soft transition-colors duration-700 last:border-b-0 hover:bg-[#f8fbf8] focus-visible:bg-[#f8fbf8] focus-visible:-outline-offset-2! ${
        fresh ? 'bg-brand-50' : ''
      }`}
    >
      <td className="whitespace-nowrap py-4 pl-6 pr-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{order.id}</span>
          {fresh && <NewBadge />}
        </div>
        <OrderTime createdAt={order.createdAt} now={now} className="mt-1 block" />
      </td>

      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <ProductImage src={order.product?.imageUrl} alt="" />
          <div className="min-w-0">
            <p className="max-w-[220px] truncate text-sm font-semibold text-ink">{order.productName}</p>
            <p className="mt-1 text-xs text-muted">
              {order.quantity} × {formatMoney(order.unitPrice, order.currency)}
            </p>
          </div>
        </div>
      </td>

      {/* The bot collects phone and address, not names, so the phone leads. */}
      <td className="px-4 py-4">
        <p className="whitespace-nowrap text-sm font-medium text-ink-soft">{order.phone || 'Phone not provided'}</p>
        <p className="mt-1 max-w-[200px] truncate text-xs text-muted" title={order.address}>{order.address}</p>
      </td>

      <td className="whitespace-nowrap px-4 py-4 text-sm font-bold text-ink">
        {formatMoney(order.subtotal, order.currency)}
      </td>

      <td className="whitespace-nowrap px-4 py-4">
        <StatusPill status={order.status} />
      </td>

      <td className="py-4 pl-2 pr-6 text-right">
        <span
          aria-hidden
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors group-hover:border-brand-200 group-hover:bg-white group-hover:text-brand-600"
        >
          <ChevronRight size={17} />
        </span>
      </td>
    </tr>
  );
}
