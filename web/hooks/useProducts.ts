'use client';

import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { isApiError, isCanceled, productService } from '@/services';
import type { ProductList } from '@/lib/types';

export const PRODUCTS_PAGE_SIZE = 12;

type ListQuery = { q: string; category: string; page: number };

type Loaded = { key: string; filterKey: string; response: ProductList };
type Failed = { key: string; error: Error };
type ListRequest = { key: string; filterKey: string; page: number; category: string };

type Handlers = {
  // The URL named a category the backend does not know (400 BAD_REQUEST).
  onUnknownCategory: (category: string) => void;
  // The page is past the end of the results; `lastPage` is the real last page.
  onPageOutOfRange: (lastPage: number) => void;
};

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error('Something went wrong while loading products.');

// Server-side paginated product list. Every request is keyed by its query, and stale
// requests are aborted, so an old response can never replace a newer one.
export function useProducts({ q, category, page }: ListQuery, handlers: Handlers) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);

  const filterKey = JSON.stringify([q, category.toLowerCase()]);
  const key = JSON.stringify([q, category.toLowerCase(), page, attempt]);

  const onSuccess = useEffectEvent((request: ListRequest, response: ProductList) => {
    const lastPage = Math.max(1, response.pagination.totalPages);
    if (request.page > lastPage) {
      handlers.onPageOutOfRange(lastPage);
      return;
    }
    setLoaded({ key: request.key, filterKey: request.filterKey, response });
  });

  const onFailure = useEffectEvent((request: ListRequest, error: Error) => {
    if (request.category && isApiError(error, 'BAD_REQUEST')) {
      handlers.onUnknownCategory(request.category);
      return;
    }
    setFailed({ key: request.key, error });
  });

  useEffect(() => {
    const request: ListRequest = { key, filterKey, page, category };
    const controller = new AbortController();
    productService
      .list({ page, limit: PRODUCTS_PAGE_SIZE, category, search: q }, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) onSuccess(request, response);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isCanceled(error)) return;
        onFailure(request, toError(error));
      });
    return () => controller.abort();
  }, [category, filterKey, key, page, q]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const current = loaded?.key === key ? loaded : null;
  const error = failed?.key === key ? failed.error : null;

  return {
    // Response for exactly the current query, or null while it is loading.
    current: current?.response ?? null,
    // Most recent successful response (possibly for an older query), kept on screen while refetching.
    latest: loaded?.response ?? null,
    // True when `latest` was loaded with the same search and category (only the page differs).
    latestMatchesFilters: loaded?.filterKey === filterKey,
    error,
    isLoading: !current && !error,
    retry,
  };
}
