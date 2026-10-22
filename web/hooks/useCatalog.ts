'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { productService } from '@/services';
import { categoriesOf, indexCatalog, type CatalogIndex } from '@/lib/orders';
import type { Product } from '@/lib/types';

// The full product catalog as one shared store: every screen and hook that calls
// useCatalog() sees the same state, so a catalog that loads (or recovers) anywhere
// updates order photos, drawers and category chips everywhere at once.

export type Catalog = {
  products: Product[];
  byId: CatalogIndex;
  categories: string[];
};

type CatalogState = { catalog: Catalog | null; error: Error | null };

const TTL_MS = 5 * 60_000; // the backend catalog is static
const RETRY_AFTER_MS = 15_000; // retry a failed load on its own, e.g. when Express starts later

const EMPTY: CatalogState = { catalog: null, error: null };
let state: CatalogState = EMPTY;
let loadedAt = 0;
let inFlight = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function setState(next: CatalogState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function clearRetry() {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function load(force = false) {
  if (inFlight) return;
  if (!force && state.catalog && Date.now() - loadedAt < TTL_MS) return;
  clearRetry();
  inFlight = true;
  productService
    .listAll()
    .then((products) => {
      loadedAt = Date.now();
      setState({ catalog: { products, byId: indexCatalog(products), categories: categoriesOf(products) }, error: null });
    })
    .catch((reason: unknown) => {
      // A stale catalog stays usable; only the error is added.
      setState({ catalog: state.catalog, error: reason instanceof Error ? reason : new Error('Could not load the catalog.') });
      if (listeners.size > 0) retryTimer = setTimeout(() => load(true), RETRY_AFTER_MS);
    })
    .finally(() => {
      inFlight = false;
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearRetry();
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export function useCatalog() {
  const { catalog, error } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const reload = useCallback(() => load(true), []);
  return { catalog, error, isLoading: catalog === null && error === null, reload };
}
