import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Page not found',
};

// Unmatched URLs render outside the dashboard shell, so keep this self-contained.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="panel-shadow flex w-full max-w-md flex-col items-center rounded-2xl border border-line bg-surface px-6 py-14 text-center">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Compass size={26} strokeWidth={1.75} aria-hidden />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-[.17em] text-brand-500">404</p>
        <h1 className="mt-2 text-xl font-bold tracking-tight text-ink">Page not found</h1>
        <p className="mt-2 max-w-xs text-sm leading-6 text-muted">
          This page does not exist. Your orders and products are one click away.
        </p>
        <Link
          href="/orders"
          className="mt-6 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
        >
          Go to orders
        </Link>
      </div>
    </main>
  );
}
