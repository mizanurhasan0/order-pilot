import type { OrderStatus } from '@/lib/types';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

const STYLES: Record<OrderStatus, { pill: string; dot: string }> = {
  pending: { pill: 'bg-amber-50 text-amber-700 ring-amber-200/70', dot: 'bg-amber-400' },
  confirmed: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70', dot: 'bg-emerald-500' },
  cancelled: { pill: 'bg-red-50 text-red-700 ring-red-200/70', dot: 'bg-red-500' },
};

export function StatusPill({ status }: { status: OrderStatus }) {
  const style = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${style.pill}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}
