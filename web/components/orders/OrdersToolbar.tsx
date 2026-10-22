import { Search, X } from 'lucide-react';
import type { OrdersSummary, OrderStatus } from '@/lib/types';
import { MAX_QUERY_LENGTH } from '@/hooks/useOrdersUrlState';

const TABS: { value: OrderStatus | null; label: string; count: (summary: OrdersSummary) => number }[] = [
  { value: null, label: 'All', count: (summary) => summary.total },
  { value: 'pending', label: 'Pending', count: (summary) => summary.pending },
  { value: 'confirmed', label: 'Confirmed', count: (summary) => summary.confirmed },
  { value: 'cancelled', label: 'Cancelled', count: (summary) => summary.cancelled },
];

export function OrdersToolbar({ status, query, summary, onStatusChange, onQueryChange }: {
  status: OrderStatus | null;
  query: string;
  summary: OrdersSummary | null;
  onStatusChange: (status: OrderStatus | null) => void;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div
        role="group"
        aria-label="Filter by status"
        className="soft-scroll flex gap-1 overflow-x-auto rounded-xl bg-canvas p-1 ring-1 ring-inset ring-line"
      >
        {TABS.map((tab) => {
          const active = tab.value === status;
          return (
            <button
              key={tab.label}
              type="button"
              aria-pressed={active}
              onClick={() => onStatusChange(tab.value)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                active ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
              }`}
            >
              {tab.label}
              {summary && (
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[11px] tabular-nums ${
                    active ? 'bg-brand-100 text-brand-700' : 'bg-line-soft text-muted'
                  }`}
                >
                  {tab.count(summary)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="relative min-w-0 flex-1 lg:max-w-sm">
        <Search
          size={17}
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle"
        />
        <input
          type="search"
          value={query}
          maxLength={MAX_QUERY_LENGTH}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search order, product, phone or address"
          aria-label="Search orders"
          className="w-full rounded-xl border border-line bg-[#fbfcfb] py-2.5 pl-10 pr-9 text-sm text-ink transition placeholder:text-subtle focus:border-brand-400 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-line-soft hover:text-ink"
          >
            <X size={15} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
