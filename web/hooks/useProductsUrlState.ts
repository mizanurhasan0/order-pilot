'use client';

import { startTransition, useCallback, useEffect, useMemo, useOptimistic, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PRODUCTS_MAX_SEARCH_LENGTH } from '@/lib/types';

// The products screen keeps its state in the URL: ?q=&category=&page=&product=
export type ProductsUrlState = {
  q: string;
  category: string;
  page: number;
  product: string | null;
};

export type ProductsUrlPatch = {
  q?: string | null;
  category?: string | null;
  page?: number | null;
  product?: string | null;
};

export const normalizeSearch = (value: string) => value.trim().slice(0, PRODUCTS_MAX_SEARCH_LENGTH);

// Only plain positive integers are valid pages; anything else falls back to 1.
export function parsePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function parseQuery(query: string): ProductsUrlState {
  const params = new URLSearchParams(query);
  return {
    q: normalizeSearch(params.get('q') ?? ''),
    category: (params.get('category') ?? '').trim(),
    page: parsePage(params.get('page')),
    product: params.get('product')?.trim() || null,
  };
}

function applyPatch(query: string, patch: ProductsUrlPatch): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    const isDefault = value === null || value === undefined || value === '' || (key === 'page' && value === 1);
    if (isDefault) params.delete(key);
    else params.set(key, String(value));
  }
  return params.toString();
}

export function useProductsUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const urlQuery = useSearchParams().toString();

  // router.replace resolves asynchronously, so an optimistic copy of the query string
  // lets chips, pages and the drawer react on click instead of after the navigation.
  const [query, setQuery] = useOptimistic(urlQuery);
  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);

  const state = useMemo(() => parseQuery(query), [query]);

  // Stable identity: reads the latest query from a ref so two quick updates compose.
  const update = useCallback(
    (patch: ProductsUrlPatch) => {
      const next = applyPatch(latestQuery.current, patch);
      if (next === latestQuery.current) return;
      latestQuery.current = next;
      startTransition(() => {
        setQuery(next);
        router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
      });
    },
    [pathname, router, setQuery],
  );

  return [state, update] as const;
}
