import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrdersView } from '@/components/orders/OrdersView';
import { OrdersViewSkeleton } from '@/components/orders/OrdersSkeleton';

export const metadata: Metadata = {
  title: 'Orders',
};

// OrdersView reads the URL with useSearchParams, so it needs a Suspense boundary.
export default function OrdersPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-14 pt-9 md:px-9 lg:px-11">
      <Suspense fallback={<OrdersViewSkeleton />}>
        <OrdersView />
      </Suspense>
    </div>
  );
}
