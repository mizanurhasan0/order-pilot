'use client';

import { useEffect } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';

// Shared error boundary for every dashboard page. The shell (sidebar, topbar)
// stays usable because this renders inside the (dashboard) layout.
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && 'digest' in error ? String(error.digest) : null;

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-14 pt-9 md:px-9 lg:px-11">
      <div className="panel-shadow mx-auto flex max-w-lg flex-col items-center rounded-2xl border border-line bg-surface px-6 py-14 text-center">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <TriangleAlert size={26} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="text-lg font-bold text-ink">Something went wrong</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
          This page hit an unexpected error. Try again, and if it keeps happening, reload the page.
        </p>
        {digest && <p className="mt-3 font-mono text-[11px] text-subtle">Reference: {digest}</p>}
        <button
          type="button"
          onClick={() => retry()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
        >
          <RotateCcw size={16} aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
