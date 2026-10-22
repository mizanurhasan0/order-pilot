'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { isOrderStatus, type OrderStatus } from '@/lib/types';

export const MAX_QUERY_LENGTH = 100;
const QUERY_DEBOUNCE_MS = 300;
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type OrdersUrlState = {
  status: OrderStatus | null;
  q: string;
  order: string | null;
};

type ParamsLike = Pick<URLSearchParams, 'get'>;

// Invalid values are dropped rather than rejected, so a mangled link still opens the page.
export function parseOrdersParams(params: ParamsLike): OrdersUrlState {
  const status = params.get('status');
  const order = params.get('order');
  return {
    status: isOrderStatus(status) ? status : null,
    q: (params.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
    order: order && ORDER_ID.test(order) ? order : null,
  };
}

export function buildOrdersQuery({ status, q, order }: OrdersUrlState): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());
  if (order) params.set('order', order);
  return params.toString();
}

const onlyQueryDiffers = (a: string, b: string) => {
  const left = parseOrdersParams(new URLSearchParams(a));
  const right = parseOrdersParams(new URLSearchParams(b));
  return left.status === right.status && left.order === right.order;
};

type SyncState = {
  values: OrdersUrlState;
  urlKey: string; // last URL query string this state has accounted for
  pending: string[]; // query strings we asked the router for that have not landed yet
};

// `?status=&q=&order=` mirrored into local state. Local state answers instantly;
// the URL follows via router.replace (search typing is debounced), and URL
// changes we did not make (sidebar link, back/forward, address bar) are adopted.
export function useOrdersUrlState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlKey = searchParams.toString();

  const [sync, setSync] = useState<SyncState>(() => ({
    values: parseOrdersParams(searchParams),
    urlKey,
    pending: [],
  }));

  if (urlKey !== sync.urlKey) {
    const index = sync.pending.indexOf(urlKey);
    setSync(
      index === -1
        ? { values: parseOrdersParams(searchParams), urlKey, pending: [] }
        : { ...sync, urlKey, pending: sync.pending.slice(index + 1) },
    );
  }

  const desiredKey = buildOrdersQuery(sync.values);
  const requestedKey = sync.pending.at(-1) ?? sync.urlKey;

  useEffect(() => {
    if (desiredKey === requestedKey) return;
    const delay = onlyQueryDiffers(desiredKey, requestedKey) ? QUERY_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => {
      setSync((previous) => ({ ...previous, pending: [...previous.pending, desiredKey] }));
      router.replace(desiredKey ? `${pathname}?${desiredKey}` : pathname, { scroll: false });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [desiredKey, requestedKey, pathname, router]);

  const update = useCallback((patch: Partial<OrdersUrlState>) => {
    setSync((previous) => ({ ...previous, values: { ...previous.values, ...patch } }));
  }, []);

  return { ...sync.values, update };
}
