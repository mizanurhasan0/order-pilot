'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle, PackageSearch, RefreshCw, X } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCatalog } from '@/hooks/useCatalog';
import { useProducts } from '@/hooks/useProducts';
import { useProductsUrlState } from '@/hooks/useProductsUrlState';
import { pluralize } from '@/lib/format';
import type { Product, ProductList } from '@/lib/types';
import { isApiError } from '@/services';
import { CategoryChips } from './CategoryChips';
import { ProductCard } from './ProductCard';
import { ProductDrawer } from './ProductDrawer';
import { ProductSearch } from './ProductSearch';
import { ProductsPagination } from './ProductsPagination';
import { PRODUCT_GRID_CLASS, ProductGridSkeleton } from './ProductsSkeleton';
import { ShareProductDrawer } from './ShareProductDrawer';

const sameId = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

// Errors that mean the Express backend is down rather than a bad request.
const isBackendDown = (error: Error) => isApiError(error, 'BACKEND_UNREACHABLE') || isApiError(error, 'TIMEOUT');

export function ProductsView() {
  const [query, updateQuery] = useProductsUrlState();
  const { q, category, page, product: productId } = query;
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [sharing, setSharing] = useState<Product | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const { catalog, error: catalogError, isLoading: catalogLoading, reload: reloadCatalog } = useCatalog();
  const list = useProducts(
    { q, category, page },
    {
      onUnknownCategory: (name) => {
        setNotice(`“${name}” is not a catalog category, so all products are shown instead.`);
        updateQuery({ category: null, page: null });
      },
      onPageOutOfRange: (lastPage) => updateQuery({ page: lastPage }),
    },
  );

  // While a new page or filter loads, the previous results stay on screen (dimmed).
  const shown = list.current ?? (list.isLoading ? list.latest : null);
  const products = shown?.data ?? [];
  const refreshing = list.isLoading && shown !== null;
  const categories = catalog?.categories ?? [];
  const pagination = list.current?.pagination ?? (list.latestMatchesFilters ? list.latest?.pagination : null) ?? null;
  const hasFilters = q !== '' || category !== '';
  const activeCategory = categories.find((name) => name.toLowerCase() === category.toLowerCase()) ?? category;

  const search = useCallback((value: string) => updateQuery({ q: value, page: null }), [updateQuery]);
  const closeDrawer = useCallback(() => updateQuery({ product: null }), [updateQuery]);

  // The chips come from the shared catalog, so a failed catalog load retries with the list.
  const retry = () => {
    list.retry();
    if (catalogError) reloadCatalog();
  };

  const selectCategory = (value: string) => {
    setNotice(null);
    updateQuery({ category: value, page: null });
  };

  const clearFilters = () => {
    setNotice(null);
    updateQuery({ q: null, category: null, page: null });
  };

  const goToPage = (next: number) => {
    updateQuery({ page: next });
    const panel = panelRef.current;
    // Only scroll when the top of the results is hidden (e.g. paging from the bottom).
    if (panel && panel.getBoundingClientRect().top < 96) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  };

  const openProduct = (product: Product) => {
    setSelected(product);
    updateQuery({ product: product.id });
  };

  // The card's copy shows instantly; a deep link (?product=) not on this page is fetched by the drawer.
  const initialProduct = productId
    ? ([selected, ...products].find((item) => item !== null && sameId(item.id, productId)) ?? null)
    : null;

  let content: ReactNode;
  if (list.error) {
    content = (
      <Alert tone="error" title="Couldn't load products" action={<RetryButton onClick={retry} />}>
        <p>{list.error.message}</p>
        {isBackendDown(list.error) && (
          <p className="mt-1">
            Start the Express backend (<code className="font-mono">cd api && pnpm dev</code>) or check BACKEND_API_URL.
          </p>
        )}
      </Alert>
    );
  } else if (!shown) {
    content = (
      <>
        <div aria-hidden className="mb-5 h-4 w-52 animate-pulse rounded-md bg-line-soft" />
        <ProductGridSkeleton />
      </>
    );
  } else if (products.length === 0) {
    content = (
      <div aria-busy={refreshing} className={`transition-opacity duration-200 ${refreshing ? 'opacity-55' : ''}`}>
        <NoResults q={q} category={activeCategory} onClear={hasFilters ? clearFilters : undefined} />
      </div>
    );
  } else {
    content = (
      <>
        <ResultsMeta response={shown} q={q} category={activeCategory} refreshing={refreshing} />
        <div
          aria-busy={refreshing}
          className={`${PRODUCT_GRID_CLASS} transition-opacity duration-200 ${refreshing ? 'opacity-55' : ''}`}
        >
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onOpen={openProduct} onShare={setSharing} />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <section
        ref={panelRef}
        aria-labelledby="products-panel-title"
        className="panel-shadow scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-white"
      >
        <div className="border-b border-line-soft px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 id="products-panel-title" className="text-[17px] font-bold tracking-tight text-ink">
                Product catalog
              </h3>
              <p className="mt-1 text-xs text-muted">Search, filter by category, and click a product to see its details.</p>
            </div>
            <CountBadge
              total={shown?.pagination.total ?? null}
              filtered={hasFilters}
              refreshing={refreshing}
              failed={list.error !== null}
            />
          </div>
          <div className="mt-5 space-y-4">
            <ProductSearch value={q} onSearch={search} />
            <CategoryChips
              categories={categories}
              active={activeCategory}
              loading={catalogLoading}
              onSelect={selectCategory}
            />
          </div>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <p role="status" aria-live="polite" className="sr-only">
            {announce(list.current, list.error, page)}
          </p>
          {notice && (
            <div className="mb-5">
              <Alert tone="info" title="Category not found" action={<DismissButton onClick={() => setNotice(null)} />}>
                {notice}
              </Alert>
            </div>
          )}
          {content}
        </div>

        {!list.error && products.length > 0 && (
          <div className="border-t border-line-soft px-5 py-4 sm:px-6">
            <ProductsPagination page={page} totalPages={pagination?.totalPages ?? null} onPageChange={goToPage} />
          </div>
        )}
      </section>

      <ProductDrawer
        key={productId ?? 'closed'}
        productId={productId}
        initialProduct={initialProduct}
        onClose={closeDrawer}
      />

      <ShareProductDrawer key={`share-${sharing?.id ?? 'closed'}`}product={sharing} onClose={() => setSharing(null)} />
    </>
  );
}

function announce(current: ProductList | null, error: Error | null, page: number): string {
  if (error || !current) return '';
  const { total, totalPages } = current.pagination;
  if (total === 0) return 'No products match your filters.';
  return `${pluralize(total, 'product')} found. Page ${page} of ${totalPages}.`;
}

function CountBadge({ total, filtered, refreshing, failed }: {
  total: number | null;
  filtered: boolean;
  refreshing: boolean;
  failed: boolean;
}) {
  if (failed) return null;
  if (total === null) return <span aria-hidden className="h-7 w-24 animate-pulse rounded-lg bg-line-soft" />;
  return (
    <span
      className={`rounded-lg bg-line-soft px-3 py-1.5 text-xs font-semibold text-ink-soft transition-opacity ${
        refreshing ? 'opacity-55' : ''
      }`}
    >
      {filtered ? pluralize(total, 'match', 'matches') : pluralize(total, 'product')}
    </span>
  );
}

function ResultsMeta({ response, q, category, refreshing }: {
  response: ProductList;
  q: string;
  category: string;
  refreshing: boolean;
}) {
  const { page, limit, total } = response.pagination;
  const count = response.data.length;
  const from = (page - 1) * limit + 1;
  const to = from + count - 1;
  const available = response.data.filter((product) => product.available).length;

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted">
      <p className={`min-w-0 break-words transition-opacity ${refreshing ? 'opacity-55' : ''}`}>
        Showing{' '}
        <strong className="font-semibold text-ink-soft">
          {from}–{to}
        </strong>{' '}
        of <strong className="font-semibold text-ink-soft">{pluralize(total, 'product')}</strong>
        {category && (
          <>
            {' '}
            in <strong className="font-semibold text-ink-soft">{category}</strong>
          </>
        )}
        {q && (
          <>
            {' '}
            matching <strong className="font-semibold text-ink-soft">“{q}”</strong>
          </>
        )}
      </p>
      {refreshing ? (
        <span className="inline-flex items-center gap-1.5">
          <LoaderCircle size={13} className="animate-spin text-brand-500" aria-hidden />
          Updating…
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${available ? 'bg-brand-400' : 'bg-subtle'}`} />
          {available} of {count} available on this page
        </span>
      )}
    </div>
  );
}

function NoResults({ q, category, onClear }: { q: string; category: string; onClear?: () => void }) {
  if (!onClear) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="No products in the catalog yet"
        description="Products added to the backend catalog will appear here."
      />
    );
  }

  const where = category ? `in ${category}` : 'in the catalog';
  const description = q
    ? `Nothing ${where} matches “${q}”. Try a different word or category.`
    : `There are no products ${where} right now.`;

  return (
    <EmptyState
      icon={PackageSearch}
      title="No products match your filters"
      description={description}
      action={
        <button
          type="button"
          onClick={onClear}
          className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          Clear filters
        </button>
      }
    />
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
    >
      <RefreshCw size={13} aria-hidden />
      Retry
    </button>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      className="rounded-lg p-1 text-sky-700 hover:bg-sky-100"
    >
      <X size={16} aria-hidden />
    </button>
  );
}
