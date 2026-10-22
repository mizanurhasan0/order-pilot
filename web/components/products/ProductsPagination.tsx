'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function PageButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink-soft transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-45 disabled:hover:border-line disabled:hover:bg-white disabled:hover:text-ink-soft sm:px-3.5"
    >
      {children}
    </button>
  );
}

// `totalPages` is null when it is not known yet for the current filters.
export function ProductsPagination({ page, totalPages, onPageChange }: {
  page: number;
  totalPages: number | null;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav aria-label="Product pages" className="flex items-center justify-between gap-3">
      <PageButton disabled={totalPages === null || page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft size={16} aria-hidden />
        Prev<span className="sr-only">ious page</span>
      </PageButton>
      <p className="text-xs text-muted">
        Page <span className="font-semibold text-ink-soft">{page}</span>
        {totalPages !== null && (
          <>
            {' '}
            of <span className="font-semibold text-ink-soft">{totalPages}</span>
          </>
        )}
      </p>
      <PageButton disabled={totalPages === null || page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next<span className="sr-only"> page</span>
        <ChevronRight size={16} aria-hidden />
      </PageButton>
    </nav>
  );
}
