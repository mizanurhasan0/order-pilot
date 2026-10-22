'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Check, CircleCheck, Copy, EyeOff, LoaderCircle, PackageX, RefreshCw } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProductImage } from '@/components/ui/ProductImage';
import { useProduct } from '@/hooks/useProduct';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/lib/types';
import { AvailabilityBadge } from './AvailabilityBadge';

// Render with key={productId}: state resets per product. Shows `initialProduct` (the card's
// copy) instantly, then replaces it with a fresh GET /api/products/:id.
export function ProductDrawer({ productId, initialProduct, onClose }: {
  productId: string | null;
  initialProduct: Product | null;
  onClose: () => void;
}) {
  const { product, error, notFound, isLoading, retry } = useProduct(productId, initialProduct);

  const retryButton = (
    <button
      type="button"
      onClick={retry}
      className="inline-flex items-center gap-1.5 rounded-lg border border-current/20 bg-white/70 px-2.5 py-1.5 text-xs font-semibold hover:bg-white"
    >
      <RefreshCw size={13} aria-hidden />
      Retry
    </button>
  );

  let body: ReactNode;
  if (notFound) {
    body = (
      <EmptyState
        icon={PackageX}
        title="This product is no longer in the catalog."
        description={`Nothing was found for ID ${productId}. It may have been removed from the backend catalog.`}
        action={
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Back to products
          </button>
        }
      />
    );
  } else if (product) {
    body = (
      <>
        {error && (
          <Alert tone="warning" title="Couldn't refresh this product" action={retryButton}>
            {error.message} Showing the details from the product list.
          </Alert>
        )}
        <ProductDetails product={product} refreshing={isLoading} />
      </>
    );
  } else if (error) {
    body = (
      <Alert tone="error" title="Couldn't load this product" action={retryButton}>
        {error.message}
      </Alert>
    );
  } else {
    body = <DetailsSkeleton />;
  }

  return (
    <Drawer
      open={productId !== null}
      onClose={onClose}
      eyebrow="Product details"
      title={product?.id ?? productId ?? ''}
      footer={product ? <DrawerFooter productId={product.id} onClose={onClose} /> : undefined}
    >
      {body}
    </Drawer>
  );
}

function ProductDetails({ product, refreshing }: { product: Product; refreshing: boolean }) {
  return (
    <>
      <div className="relative rounded-2xl border border-line p-2">
        <div className={product.available ? '' : 'opacity-70 grayscale-[60%]'}>
          <ProductImage src={product.imageUrl} alt={product.name} size="fill" />
        </div>
        <AvailabilityBadge available={product.available} className="absolute left-4 top-4" />
        {refreshing && (
          <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-muted ring-1 ring-inset ring-line backdrop-blur">
            <LoaderCircle size={12} className="animate-spin" aria-hidden />
            Refreshing
          </span>
        )}
      </div>

      <div>
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-brand-500">
          {product.category}
          <span aria-hidden className="text-subtle">•</span>
          <span className="font-mono font-medium normal-case tracking-normal text-muted">{product.id}</span>
        </p>
        <h3 className="mt-2 text-xl font-bold leading-7 tracking-tight text-ink">{product.name}</h3>
        <p className="mt-2 text-2xl font-bold tracking-tight text-brand-700">
          {formatMoney(product.price, product.currency)}
        </p>
      </div>

      <AvailabilityNote available={product.available} />

      <Section title="Description">
        <p className="text-sm leading-6 text-ink-soft">{product.description || 'No description provided.'}</p>
      </Section>

      <Section title="Product information">
        <dl className="space-y-3 text-sm">
          <Row label="Product ID">
            <span className="font-mono">{product.id}</span>
          </Row>
          <Row label="Category">{product.category}</Row>
          <Row label="Price">{formatMoney(product.price, product.currency)}</Row>
          <Row label="Currency">{product.currency}</Row>
        </dl>
      </Section>
    </>
  );
}

function AvailabilityNote({ available }: { available: boolean }) {
  const Icon = available ? CircleCheck : EyeOff;
  return (
    <div
      className={`flex gap-3 rounded-2xl border p-4 ${
        available ? 'border-brand-200 bg-brand-50' : 'border-line bg-canvas'
      }`}
    >
      <Icon size={18} aria-hidden className={`mt-0.5 shrink-0 ${available ? 'text-brand-500' : 'text-muted'}`} />
      <div>
        <p className={`text-sm font-semibold ${available ? 'text-brand-800' : 'text-ink'}`}>
          {available ? 'Available to order' : 'Unavailable'}
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-soft">
          {available
            ? 'Shown in the Messenger catalog, so customers can order it from the bot.'
            : 'Hidden from the Messenger catalog. Customers will not see it in the bot until it is available again.'}
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-[.11em] text-muted">{title}</h4>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

function DrawerFooter({ productId, onClose }: { productId: string; onClose: () => void }) {
  return (
    <div className="flex gap-3">
      <CopyIdButton id={productId} />
      <button
        type="button"
        onClick={onClose}
        className="flex-1 rounded-xl bg-brand-700 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-800"
      >
        Back to products
      </button>
    </div>
  );
}

function CopyIdButton({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy product ID';
  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
          state === 'copied'
            ? 'border-brand-200 bg-brand-50 text-brand-700'
            : state === 'failed'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-line text-ink-soft hover:bg-brand-50'
        }`}
      >
        {state === 'copied' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        {label}
      </button>
      <span role="status" className="sr-only">
        {state === 'copied' ? `Product ID ${id} copied` : state === 'failed' ? 'Could not copy the product ID' : ''}
      </span>
    </>
  );
}

function DetailsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading product" className="animate-pulse space-y-6">
      <div className="rounded-2xl border border-line p-2">
        <div className="aspect-square w-full rounded-xl bg-line-soft" />
      </div>
      <div className="space-y-3">
        <div className="h-3 w-24 rounded-md bg-line-soft" />
        <div className="h-5 w-4/5 rounded-md bg-line-soft" />
        <div className="h-6 w-28 rounded-md bg-line-soft" />
      </div>
      <div className="h-20 rounded-2xl bg-line-soft" />
      <div className="h-28 rounded-2xl bg-line-soft" />
    </div>
  );
}
