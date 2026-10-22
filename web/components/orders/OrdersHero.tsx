import type { ReactNode } from 'react';

// Page heading for /orders. `children` sits on the right (sync state, refresh).
export function OrdersHero({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      {children}
    </div>
  );
}
