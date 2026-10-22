'use client';

import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';

const SIZES = {
  sm: { box: 'h-11 w-11 rounded-xl sm:h-12 sm:w-12', icon: 20 },
  md: { box: 'h-16 w-16 rounded-2xl', icon: 24 },
  lg: { box: 'h-20 w-20 rounded-2xl sm:h-24 sm:w-24', icon: 28 },
  fill: { box: 'aspect-square w-full rounded-xl', icon: 32 },
} as const;

// Catalog images are arbitrary public HTTPS URLs edited by the merchant, so a plain
// <img> with a graceful fallback is used instead of next/image remote patterns.
export function ProductImage({ src, alt, size = 'sm' }: { src: string | null | undefined; alt: string; size?: keyof typeof SIZES }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const { box, icon } = SIZES[size];
  const usable = src && /^https:\/\/\S+$/i.test(src) && failedSrc !== src ? src : null;

  return (
    <div className={`relative shrink-0 overflow-hidden bg-[#f1f4f1] ${box}`}>
      {usable ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={alt} src={usable} loading="lazy" onError={() => setFailedSrc(usable)} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[#93a79a]">
          <ShoppingBag size={icon} strokeWidth={1.65} aria-hidden />
        </div>
      )}
    </div>
  );
}
