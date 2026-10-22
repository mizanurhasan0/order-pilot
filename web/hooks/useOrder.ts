'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCatalog } from '@/hooks/useCatalog';
import { enrichOrder } from '@/lib/orders';
import type { DashboardOrder, Order } from '@/lib/types';
import { isApiError, isCanceled, orderService } from '@/services';

type Result =
  | { key: string; status: 'ready'; order: Order }
  | { key: string; status: 'error'; error: Error };

const toError = (error: unknown) => (error instanceof Error ? error : new Error('Could not load this order.'));

// One order by id (GET /api/orders/:id), joined with the catalog. `initialOrder`
// (the list's copy) shows instantly and is replaced by the fresh copy once it
// arrives. Results are keyed by id and attempt, and stale requests are aborted.
export function useOrder(orderId: string, initialOrder: DashboardOrder | null = null) {
  const { catalog } = useCatalog();
  const catalogIndex = catalog?.byId ?? null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const key = JSON.stringify([orderId, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    orderService
      .getById(orderId, controller.signal)
      .then((order) => {
        if (!controller.signal.aborted) setResult({ key, status: 'ready', order });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isCanceled(error)) return;
        setResult({ key, status: 'error', error: toError(error) });
      });
    return () => controller.abort();
  }, [orderId, key]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  // Replace the fresh copy, e.g. with the order a status update returned.
  const applyOrder = useCallback((order: Order) => setResult({ key, status: 'ready', order }), [key]);

  const current = result !== null && result.key === key ? result : null;
  const fresh = current?.status === 'ready' ? current.order : null;
  const error = current?.status === 'error' ? current.error : null;
  const freshOrder = useMemo(() => fresh && enrichOrder(fresh, catalogIndex), [fresh, catalogIndex]);

  return {
    // Fresh copy, else `initialOrder` while loading, after a failed refresh, or
    // when the order is gone (the last copy this page saw).
    order: freshOrder ?? initialOrder,
    // The last fetch failed (the order may still show `initialOrder`).
    error,
    // The backend has no order with this id (it may have restarted).
    notFound: isApiError(error, 'NOT_FOUND'),
    isLoading: current === null,
    retry,
    applyOrder,
  };
}
