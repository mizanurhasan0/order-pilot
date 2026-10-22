'use client';

import { useCallback, useRef, useState } from 'react';
import { useCatalog } from '@/hooks/useCatalog';
import { enrichOrder } from '@/lib/orders';
import type { DashboardOrder, OrderStatus } from '@/lib/types';
import { orderService } from '@/services';

const toError = (error: unknown) => (error instanceof Error ? error : new Error('Could not update this order.'));

// PATCH /api/orders/:id/status. One update at a time: a second call while one is
// saving is ignored. `updateStatus` resolves with the updated order joined with the
// catalog, or null when it failed (`error` says why).
export function useUpdateOrderStatus() {
  const { catalog } = useCatalog();
  const catalogIndex = catalog?.byId ?? null;
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const savingRef = useRef(false);

  const updateStatus = useCallback(
    async (id: string, status: OrderStatus): Promise<DashboardOrder | null> => {
      if (savingRef.current) return null;
      savingRef.current = true;
      setPending(status);
      setError(null);
      try {
        return enrichOrder(await orderService.updateStatus(id, status), catalogIndex);
      } catch (caught) {
        setError(toError(caught));
        return null;
      } finally {
        savingRef.current = false;
        setPending(null);
      }
    },
    [catalogIndex],
  );

  const reset = useCallback(() => setError(null), []);

  return {
    updateStatus,
    // The status being saved, so the matching button can show a spinner.
    pending,
    isSaving: pending !== null,
    error,
    reset,
  };
}
