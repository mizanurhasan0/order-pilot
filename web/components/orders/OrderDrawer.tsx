'use client';

import type { ReactNode } from 'react';
import { CalendarClock, MapPin, MessageCircle, Phone, UserRound, type LucideIcon } from 'lucide-react';
import { useOrder } from '@/hooks/useOrder';
import { useUpdateOrderStatus } from '@/hooks/useUpdateOrderStatus';
import { formatDateTime, formatMoney, formatRelative, pluralize } from '@/lib/format';
import type { DashboardOrder, OrderStatus } from '@/lib/types';
import { isApiError } from '@/services';
import { Alert } from '@/components/ui/Alert';
import { Drawer } from '@/components/ui/Drawer';
import { ProductImage } from '@/components/ui/ProductImage';
import { StatusPill } from '@/components/ui/StatusPill';
import { CopyButton } from './CopyButton';
import { errorMessage } from './errors';
import { OrderStatusActions } from './OrderStatusActions';

const successMessage = (id: string, from: OrderStatus, to: OrderStatus) => {
  if (to === 'confirmed') return `${id} confirmed`;
  if (to === 'cancelled') return `${id} cancelled`;
  return from === 'cancelled' ? `${id} reopened as pending` : `${id} marked as pending`;
};

// Mount with `key={orderId}` so each order starts with fresh state.
export function OrderDrawer({ orderId, listCopy, onClose, onStatusChanged }: {
  orderId: string;
  listCopy: DashboardOrder | undefined; // shown instantly while the fresh copy loads
  onClose: () => void; // must be stable: Drawer re-runs its focus effect when it changes
  onStatusChanged: (order: DashboardOrder, message: string) => void;
}) {
  const { order, error: loadError, notFound, retry, applyOrder } = useOrder(orderId, listCopy ?? null);
  const { updateStatus, pending, error: actionError } = useUpdateOrderStatus();
  // A 404 from the update means the same as one from the load: the order is gone.
  const gone = notFound || isApiError(actionError, 'NOT_FOUND');

  const changeStatus = async (to: OrderStatus): Promise<boolean> => {
    if (!order) return false;
    const updated = await updateStatus(order.id, to);
    if (!updated) return false;
    applyOrder(updated);
    onStatusChanged(updated, successMessage(order.id, order.status, to));
    return true;
  };

  const footer = order && !gone ? (
    <div className="space-y-3">
      {actionError && (
        <Alert tone="error" title="Status not updated">
          {errorMessage(actionError)}
        </Alert>
      )}
      <OrderStatusActions orderId={order.id} status={order.status} saving={pending} onChange={changeStatus} />
    </div>
  ) : undefined;

  return (
    <Drawer open onClose={onClose} eyebrow="Order details" title={orderId} footer={footer}>
      {gone && (
        <Alert tone="warning" title="This order no longer exists.">
          The backend may have restarted.{order && ' The details below are the last copy this page loaded.'}
        </Alert>
      )}
      {loadError !== null && !gone && (
        <Alert
          tone={order ? 'warning' : 'error'}
          title={order ? 'Could not refresh this order' : 'Could not load this order'}
          action={<RetryButton onClick={retry} />}
        >
          {errorMessage(loadError)}
        </Alert>
      )}

      {order ? <OrderDetails order={order} /> : loadError === null && <DetailsSkeleton />}
    </Drawer>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-current/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/60"
    >
      Retry
    </button>
  );
}

function OrderDetails({ order }: { order: DashboardOrder }) {
  const { product } = order;
  const telHref = `tel:${order.phone.replace(/[^\d+]/g, '')}`;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={order.status} />
        <span className="text-xs text-muted">Placed {formatRelative(order.createdAt)}</span>
      </div>

      <Section title="Product">
        <div className="flex items-start gap-4">
          <ProductImage src={product?.imageUrl} alt={order.productName} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">{order.productName}</p>
            <p className="mt-1 text-xs text-muted">
              {order.productId}
              {product?.category && ` · ${product.category}`}
            </p>
            {product && !product.available && (
              <p className="mt-2 inline-block rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Currently unavailable
              </p>
            )}
          </div>
        </div>
        {product ? (
          product.description && <p className="mt-4 text-sm leading-6 text-ink-soft">{product.description}</p>
        ) : (
          <p className="mt-4 rounded-xl bg-canvas px-3 py-2.5 text-xs leading-5 text-muted">
            This product is not in the current catalog, so its photo and description cannot be shown.
          </p>
        )}
      </Section>

      <Section title="Pricing">
        <dl className="space-y-3 text-sm">
          <Row label="Quantity">{pluralize(order.quantity, 'pc', 'pcs')}</Row>
          <Row label="Unit price">{formatMoney(order.unitPrice, order.currency)}</Row>
          <div className="flex items-baseline justify-between border-t border-dashed border-line pt-3">
            <dt className="font-semibold text-ink">Subtotal</dt>
            <dd className="text-lg font-bold text-brand-700">{formatMoney(order.subtotal, order.currency)}</dd>
          </div>
        </dl>
      </Section>

      <Section title="Customer">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <UserRound size={19} aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Messenger customer</p>
            <p className="text-xs text-muted">The order bot does not collect names</p>
          </div>
        </div>
        <ul className="space-y-4">
          <Field icon={Phone} label="Phone number" copy={order.phone ? { value: order.phone, label: 'phone number' } : undefined}>
            {order.phone ? (
              <a href={telHref} className="font-medium text-ink underline-offset-2 hover:text-brand-700 hover:underline">
                {order.phone}
              </a>
            ) : (
              'Not provided'
            )}
          </Field>
          <Field icon={MapPin} label="Delivery address" copy={order.address ? { value: order.address, label: 'address' } : undefined}>
            <span className="leading-6">{order.address || 'Not provided'}</span>
          </Field>
          <Field
            icon={MessageCircle}
            label="Messenger PSID"
            copy={order.customerPsid ? { value: order.customerPsid, label: 'Messenger PSID' } : undefined}
          >
            <span className="break-all font-mono text-xs text-ink-soft">{order.customerPsid || 'Not provided'}</span>
          </Field>
        </ul>
      </Section>

      <Section title="Created">
        <div className="flex items-center gap-3 text-sm">
          <CalendarClock size={17} aria-hidden className="shrink-0 text-[#8fa099]" />
          <time dateTime={order.createdAt} className="font-medium text-ink">
            {formatDateTime(order.createdAt)}
          </time>
        </div>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line p-4">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-[.11em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  );
}

function Field({ icon: Icon, label, copy, children }: {
  icon: LucideIcon;
  label: string;
  copy?: { value: string; label: string };
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <Icon size={17} aria-hidden className="mt-0.5 shrink-0 text-[#8fa099]" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{label}</p>
        <div className="mt-0.5 text-sm text-ink">{children}</div>
      </div>
      {copy && <CopyButton value={copy.value} label={copy.label} />}
    </li>
  );
}

function DetailsSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Loading order…</span>
      {[0, 1, 2].map((index) => (
        <div key={index} aria-hidden className="space-y-3 rounded-2xl border border-line p-4">
          <div className="h-3 w-24 animate-pulse rounded bg-line-soft" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-line-soft" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-line-soft/70" />
        </div>
      ))}
    </div>
  );
}
