import { OrdersHero } from './OrdersHero';
import { StatCards } from './StatCards';

const ROW_WIDTHS = ['w-2/5', 'w-1/3', 'w-1/2', 'w-1/4', 'w-2/5'];

// Placeholder rows while the first snapshot for a filter loads.
export function OrdersListSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading orders…</span>
      <ul aria-hidden className="divide-y divide-line-soft">
        {ROW_WIDTHS.map((width, index) => (
          <li key={index} className="flex items-center gap-4 px-5 py-4 sm:px-6">
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-line-soft sm:h-12 sm:w-12" />
            <div className="flex-1 space-y-2">
              <div className={`h-3.5 animate-pulse rounded bg-line-soft ${width}`} />
              <div className="h-3 w-1/3 animate-pulse rounded bg-line-soft/70" />
            </div>
            <div className="hidden h-6 w-20 animate-pulse rounded-full bg-line-soft xl:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Whole-page placeholder for the Suspense fallback and loading.tsx.
export function OrdersViewSkeleton() {
  return (
    <>
      <OrdersHero />
      <StatCards summary={null} />
      <div className="panel-shadow overflow-hidden rounded-2xl border border-line bg-surface">
        <div aria-hidden className="space-y-5 border-b border-line-soft px-5 py-5 sm:px-6">
          <div className="h-4 w-32 animate-pulse rounded bg-line-soft" />
          <div className="h-10 w-full animate-pulse rounded-xl bg-line-soft/70" />
        </div>
        <OrdersListSkeleton />
      </div>
    </>
  );
}
