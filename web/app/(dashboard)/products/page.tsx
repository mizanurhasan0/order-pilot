import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProductsHero } from '@/components/products/ProductsHero';
import { ProductsPanelSkeleton } from '@/components/products/ProductsSkeleton';
import { ProductsView } from '@/components/products/ProductsView';

export const metadata: Metadata = {
  title: 'Products',
};

// ProductsView reads the URL with useSearchParams, so it needs a Suspense boundary
// for the static shell (hero + skeleton) to prerender.
export default function ProductsPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-14 pt-9 md:px-9 lg:px-11">
      {/* <ProductsHero /> */}
      <Suspense fallback={<ProductsPanelSkeleton />}>
        <ProductsView />
      </Suspense>
    </div>
  );
}
