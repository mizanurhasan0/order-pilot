'use client';

import { useCallback, useEffect, useState } from 'react';
import { isApiError, isCanceled, productService } from '@/services';
import type { Product } from '@/lib/types';

type Result =
  | { key: string; status: 'ready'; product: Product }
  | { key: string; status: 'error'; error: Error };

const toError = (error: unknown) => (error instanceof Error ? error : new Error('Could not load this product.'));

// One product by id (GET /api/products/:id). `initialProduct` (e.g. the card's copy) is
// shown instantly and replaced by the fresh copy once it arrives. Results are keyed by
// id and attempt, and stale requests are aborted.
export function useProduct(productId: string | null, initialProduct: Product | null = null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const key = productId === null ? null : JSON.stringify([productId, attempt]);

  useEffect(() => {
    if (productId === null || key === null) return;
    const controller = new AbortController();
    productService
      .getById(productId, controller.signal)
      .then((product) => {
        if (!controller.signal.aborted) setResult({ key, status: 'ready', product });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isCanceled(error)) return;
        setResult({ key, status: 'error', error: toError(error) });
      });
    return () => controller.abort();
  }, [productId, key]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const current = result !== null && result.key === key ? result : null;
  const error = current?.status === 'error' ? current.error : null;
  const notFound = isApiError(error, 'NOT_FOUND');

  return {
    // Fresh copy, else `initialProduct` while loading or after a failed refresh; null when not found.
    product: notFound ? null : current?.status === 'ready' ? current.product : initialProduct,
    // The last fetch failed (the product may still show `initialProduct`).
    error,
    // The backend has no product with this id.
    notFound,
    isLoading: productId !== null && current === null,
    retry,
  };
}
