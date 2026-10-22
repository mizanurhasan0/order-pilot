'use client';

import { useCallback, useMemo } from 'react';
import { CloudOff, Inbox, RefreshCw, SearchX } from 'lucide-react';
import { useOrders } from '@/hooks/useOrders';
import { useOrdersUrlState } from '@/hooks/useOrdersUrlState';
import type { DashboardOrder, OrderStatus } from '@/lib/types';
import { formatTime, pluralize } from '@/lib/format';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { STATUS_LABELS } from '@/components/ui/StatusPill';
import { describeOrdersError } from './errors';
import { OrderCards } from './OrderCards';
import { OrderDrawer } from './OrderDrawer';
import { OrdersHero } from './OrdersHero';
import { OrdersListSkeleton } from './OrdersSkeleton';
import { OrdersTable } from './OrdersTable';
import { OrdersToolbar } from './OrdersToolbar';
import { matchesQuery } from './search';
import { StatCards } from './StatCards';
import { Toast, useToast } from './Toast';

export function OrdersView() {
  const { status, q, order: selectedId, update } = useOrdersUrlState();
  const { snapshot, error, refreshing, freshIds, refresh, applyOrder, catalogError, reloadCatalog } = useOrders(status);
  const { toast, showToast, dismissToast } = useToast();

  const summary = snapshot?.summary ?? null;
  // useOrders already narrowed the list to the selected status; the search runs here.
  const source = snapshot?.orders ?? null;
  const visible = useMemo(() => source?.filter((order) => matchesQuery(order, q)) ?? null, [source, q]);
  // From every order, so the drawer keeps its copy when the order leaves the current filter.
  const selectedOrder = selectedId ? snapshot?.allOrders.find((order) => order.id === selectedId) : undefined;

  const selectOrder = useCallback((id: string) => update({ order: id }), [update]);
  const closeOrder = useCallback(() => update({ order: null }), [update]);
  const setStatus = useCallback((next: OrderStatus | null) => update({ status: next }), [update]);
  const setQuery = useCallback((next: string) => update({ q: next }), [update]);
  const clearFilters = useCallback(() => update({ status: null, q: '' }), [update]);

  const handleStatusChanged = useCallback(
    (order: DashboardOrder, message: string) => {
      applyOrder(order);
      refresh(); // a poll already in flight may predate the change
      showToast(message);
    },
    [applyOrder, refresh, showToast],
  );

  return (
    <>
      <OrdersHero>
        <SyncStatus
          receivedAt={snapshot?.receivedAt ?? null}
          failing={error !== null}
          refreshing={refreshing}
          onRefresh={refresh}
        />
      </OrdersHero>

      {error !== null && <LoadErrorAlert error={error} stale={snapshot !== null} onRetry={refresh} />}
      {snapshot && !snapshot.catalogAvailable && catalogError !== null && (
        <div className="mb-6">
          <Alert
            tone="info"
            title="Product catalog unavailable"
            action={
              <button
                type="button"
                onClick={reloadCatalog}
                className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
              >
                Retry
              </button>
            }
          >
            Product photos and descriptions are hidden until the catalog can be reached.
          </Alert>
        </div>
      )}

      <StatCards summary={summary} />

      <section aria-labelledby="orders-list-heading" className="panel-shadow overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="border-b border-line-soft px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 id="orders-list-heading" className="text-[17px] font-bold tracking-tight text-ink">
                Recent orders
              </h3>
              <p className="mt-1 text-xs text-muted">Select an order to see details and update its status</p>
            </div>
            {visible && (
              <span className="rounded-lg bg-line-soft px-3 py-1.5 text-xs font-semibold text-ink-soft">
                {pluralize(visible.length, 'order')}
              </span>
            )}
          </div>
          <OrdersToolbar
            status={status}
            query={q}
            summary={summary}
            onStatusChange={setStatus}
            onQueryChange={setQuery}
          />
        </div>

        <OrdersListBody
          visible={visible}
          totalOrders={summary?.total ?? 0}
          status={status}
          query={q}
          failed={error !== null}
          freshIds={freshIds}
          now={snapshot?.receivedAt}
          onSelect={selectOrder}
          onRetry={refresh}
          onClearFilters={clearFilters}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-5 py-4 sm:px-6">
          <span className="text-xs text-muted">
            {summary && visible ? `Showing ${visible.length} of ${pluralize(summary.total, 'order')}` : 'Loading orders…'}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            Auto-refresh every 5s
          </span>
        </div>
      </section>

      <p className="mt-5 text-center text-xs text-subtle">
        Orders live in the Express backend&apos;s memory and are lost when it restarts.
      </p>

      {selectedId && (
        <OrderDrawer
          key={selectedId}
          orderId={selectedId}
          listCopy={selectedOrder}
          onClose={closeOrder}
          onStatusChanged={handleStatusChanged}
        />
      )}
      <Toast toast={toast} onDismiss={dismissToast} />
    </>
  );
}

function SyncStatus({ receivedAt, failing, refreshing, onRefresh }: {
  receivedAt: number | null;
  failing: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  let label = 'Syncing…';
  if (receivedAt !== null) label = `Updated ${formatTime(new Date(receivedAt))}`;
  else if (failing) label = 'Not synced yet';

  return (
    <div className="flex items-center gap-2">
      <p
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted"
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${failing ? 'bg-amber-400' : 'bg-brand-400'}`} />
        {label}
      </p>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh orders"
        title="Refresh orders"
        className="rounded-xl border border-line bg-surface p-2.5 text-ink-soft transition-colors hover:bg-brand-50"
      >
        <RefreshCw size={16} aria-hidden className={refreshing ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

function LoadErrorAlert({ error, stale, onRetry }: { error: unknown; stale: boolean; onRetry: () => void }) {
  const { title, detail } = describeOrdersError(error);
  return (
    <div className="mb-6">
      <Alert
        tone="error"
        title={title}
        action={
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            Retry
          </button>
        }
      >
        {detail}
        {stale && ' Showing the last orders that loaded.'}
      </Alert>
    </div>
  );
}

function OrdersListBody({
  visible,
  totalOrders,
  status,
  query,
  failed,
  freshIds,
  now,
  onSelect,
  onRetry,
  onClearFilters,
}: {
  visible: DashboardOrder[] | null;
  totalOrders: number;
  status: OrderStatus | null;
  query: string;
  failed: boolean;
  freshIds: ReadonlySet<string>;
  now?: number;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onClearFilters: () => void;
}) {
  if (visible === null) {
    if (!failed) return <OrdersListSkeleton />;
    return (
      <EmptyState
        icon={CloudOff}
        title="Orders could not be loaded"
        description="Check the message above, then try again."
        action={<SecondaryButton onClick={onRetry}>Retry</SecondaryButton>}
      />
    );
  }

  if (totalOrders === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No orders yet"
        description="When a customer completes an order through your Messenger bot, it appears here automatically."
      />
    );
  }

  if (visible.length === 0) {
    const statusLabel = status ? STATUS_LABELS[status].toLowerCase() : null;
    let description = 'Try a different search or status.';
    if (query.trim()) {
      description = `Nothing matches “${query.trim()}”${statusLabel ? ` among ${statusLabel} orders` : ''}.`;
    } else if (statusLabel) {
      description = `There are no ${statusLabel} orders right now.`;
    }
    return (
      <EmptyState
        icon={SearchX}
        title="No matching orders"
        description={description}
        action={<SecondaryButton onClick={onClearFilters}>Clear filters</SecondaryButton>}
      />
    );
  }

  return (
    <>
      <div className="hidden xl:block">
        <OrdersTable orders={visible} freshIds={freshIds} now={now} onSelect={onSelect} />
      </div>
      <div className="xl:hidden">
        <OrderCards orders={visible} freshIds={freshIds} now={now} onSelect={onSelect} />
      </div>
    </>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-brand-50"
    >
      {children}
    </button>
  );
}
