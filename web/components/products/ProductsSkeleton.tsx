// Loading placeholders. No client hooks, so they also work as Suspense / loading.tsx fallbacks.

export const PRODUCT_GRID_CLASS = 'grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4';

const Bar = ({ className }: { className: string }) => <div className={`rounded-md bg-line-soft ${className}`} />;

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden className={`${PRODUCT_GRID_CLASS} animate-pulse`}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-2xl border border-line-soft bg-white p-2">
          <div className="aspect-square w-full rounded-xl bg-line-soft" />
          <div className="space-y-2.5 px-2 pb-1.5 pt-4">
            <Bar className="h-2.5 w-16" />
            <Bar className="h-3.5 w-11/12" />
            <Bar className="h-3.5 w-2/3" />
            <div className="flex items-center justify-between pt-2">
              <Bar className="h-4 w-20" />
              <Bar className="h-3 w-10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Mirrors the panel in ProductsView so the page does not jump when it hydrates.
export function ProductsPanelSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading products"
      className="panel-shadow overflow-hidden rounded-2xl border border-line bg-white"
    >
      <div className="animate-pulse border-b border-line-soft px-5 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Bar className="h-4 w-36" />
            <Bar className="h-3 w-56" />
          </div>
          <Bar className="h-7 w-24 rounded-lg" />
        </div>
        <div className="mt-5 h-[42px] rounded-xl border border-line bg-[#fbfcfb]" />
        <div className="mt-4 flex gap-2 overflow-hidden">
          {[48, 64, 88, 56, 72, 60].map((width) => (
            <div key={width} className="h-[30px] shrink-0 rounded-full bg-line-soft" style={{ width }} />
          ))}
        </div>
      </div>
      <div className="px-5 py-5 sm:px-6">
        <Bar className="mb-5 h-3 w-48 animate-pulse" />
        <ProductGridSkeleton />
      </div>
    </section>
  );
}
