'use client';

import { ProductImage } from '@/components/ui/ProductImage';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/lib/types';
import { AvailabilityBadge } from './AvailabilityBadge';

export function ProductCard({ product, onOpen }: { product: Product; onOpen: (product: Product) => void }) {
  const { available } = product;
  const price = formatMoney(product.price, product.currency);

  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      aria-haspopup="dialog"
      aria-label={`${product.name}, ${price}, ${available ? 'available' : 'unavailable'}`}
      className={`group flex h-full w-full flex-col rounded-2xl border p-2 text-left transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_14px_34px_rgba(25,40,30,0.07)] ${
        available ? 'border-line bg-white' : 'border-line-soft bg-[#fbfcfb]'
      }`}
    >
      <div className="relative">
        <div
          className={`[&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.03] ${
            available ? '' : 'opacity-60 grayscale-[70%]'
          }`}
        >
          <ProductImage src={product.imageUrl} alt={product.name} size="fill" />
        </div>
        <AvailabilityBadge available={available} className="absolute left-2.5 top-2.5" />
      </div>

      <div className="flex flex-1 flex-col px-2 pb-1.5 pt-3.5">
        <p
          className={`truncate text-[10px] font-bold uppercase tracking-[.14em] ${
            available ? 'text-brand-500' : 'text-subtle'
          }`}
        >
          {product.category}
        </p>
        <h3
          className={`mt-1.5 line-clamp-2 min-h-10 text-sm font-semibold leading-5 ${
            available ? 'text-ink' : 'text-ink-soft'
          }`}
        >
          {product.name}
        </h3>
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <span className={`text-base font-bold tracking-tight ${available ? 'text-brand-700' : 'text-muted'}`}>
            {price}
          </span>
          <span className="font-mono text-[11px] text-subtle">{product.id}</span>
        </div>
      </div>
    </button>
  );
}
