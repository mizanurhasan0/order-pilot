'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCatalog } from '@/hooks/useCatalog';
import { enrichOrder, summarizeOrders } from '@/lib/orders';
import type { DashboardOrder, Order, OrdersSummary, OrderStatus } from '@/lib/types';
import { isCanceled, orderService } from '@/services';

const POLL_MS = 5_000;
const FRESH_MS = 4_000;

export type OrdersSnapshot = {
  orders: DashboardOrder[]; // orders with the selected status (every order when none), newest first
  allOrders: DashboardOrder[]; // every order, whatever the filter
  summary: OrdersSummary; // always covers every order, whatever the filter
  catalogAvailable: boolean; // false until the catalog loads: no photos or descriptions
  receivedAt: number;
};

type Fetched = { orders: Order[]; receivedAt: number };

// The in-memory backend restarts its id counter, so an id alone is not unique over time.
const identity = (order: Order) => `${order.id}@${order.createdAt}`;

// Polls every order (one consistent snapshot per request) and derives the rest in
// the browser: summary counts, the status filter and catalog details, so switching
// status needs no request. Requests never overlap, polling pauses while the tab is
// hidden, and the last good snapshot survives errors.
export function useOrders(status: OrderStatus | null) {
  const { catalog, error: catalogError, reload: reloadCatalog } = useCatalog();
  const catalogIndex = catalog?.byId ?? null;

  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());

  const loadRef = useRef<((force: boolean) => void) | null>(null);
  // Orders already shown, and when the first successful request started: only
  // orders created after that moment count as new arrivals worth highlighting.
  const seenRef = useRef<{ keys: Set<string>; since: number } | null>(null);
  const freshTimersRef = useRef(new Set<number>());

  const trackArrivals = useCallback((orders: Order[], startedAt: number) => {
    const seen = seenRef.current;
    if (!seen) {
      seenRef.current = { keys: new Set(orders.map(identity)), since: startedAt };
      return;
    }

    const arrived = orders
      .filter((order) => !seen.keys.has(identity(order)) && Date.parse(order.createdAt) >= seen.since)
      .map((order) => order.id);
    for (const order of orders) seen.keys.add(identity(order));
    if (arrived.length === 0) return;

    setFreshIds((previous) => new Set([...previous, ...arrived]));
    const timer = window.setTimeout(() => {
      freshTimersRef.current.delete(timer);
      setFreshIds((previous) => new Set([...previous].filter((id) => !arrived.includes(id))));
    }, FRESH_MS);
    freshTimersRef.current.add(timer);
  }, []);

  useEffect(() => {
    const timers = freshTimersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    let controller: AbortController | null = null;
    let pollTimer: number | undefined;
    let queued = false;

    const schedule = () => {
      window.clearTimeout(pollTimer);
      if (document.visibilityState === 'visible') pollTimer = window.setTimeout(() => void load(false), POLL_MS);
    };

    // `force` queues one more request when one is already running, so a manual
    // refresh or a status update is never answered with a response started before it.
    const load = async (force: boolean) => {
      if (controller) {
        queued ||= force;
        return;
      }
      window.clearTimeout(pollTimer);
      const current = new AbortController();
      controller = current;
      const startedAt = Date.now();

      try {
        const response = await orderService.list({}, current.signal);
        if (current.signal.aborted) return;
        trackArrivals(response.data, startedAt);
        setFetched({ orders: response.data, receivedAt: Date.now() });
        setError(null);
      } catch (caught) {
        if (!current.signal.aborted && !isCanceled(caught)) setError(caught);
      } finally {
        controller = null;
        if (!current.signal.aborted) {
          if (queued) {
            queued = false;
            void load(false);
          } else {
            setRefreshing(false);
            schedule();
          }
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load(false);
      else window.clearTimeout(pollTimer);
    };

    loadRef.current = (force) => void load(force);
    void load(false);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      loadRef.current = null;
      controller?.abort();
      window.clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [trackArrivals]);

  // Re-derived when the catalog arrives, so photos appear without waiting for a poll.
  const allOrders = useMemo(
    () => fetched?.orders.map((order) => enrichOrder(order, catalogIndex)) ?? null,
    [fetched, catalogIndex],
  );
  const summary = useMemo(() => (fetched ? summarizeOrders(fetched.orders) : null), [fetched]);
  const orders = useMemo(
    () => (allOrders && status ? allOrders.filter((order) => order.status === status) : allOrders),
    [allOrders, status],
  );

  const snapshot: OrdersSnapshot | null =
    fetched && allOrders && orders && summary
      ? { orders, allOrders, summary, catalogAvailable: catalogIndex !== null, receivedAt: fetched.receivedAt }
      : null;

  const refresh = useCallback(() => {
    setRefreshing(true);
    loadRef.current?.(true);
  }, []);

  // Patch one order in place (after a status change) until the next poll lands.
  // The summary is derived from the same list, so the counts follow immediately.
  const applyOrder = useCallback((order: Order) => {
    setFetched((previous) => previous && {
      ...previous,
      orders: previous.orders.map((item) => (item.id === order.id ? order : item)),
    });
  }, []);

  return { snapshot, error, refreshing, freshIds, refresh, applyOrder, catalogError, reloadCatalog };
}
