import type { KeyboardEvent } from 'react';
import { formatDateTime, formatRelative } from '@/lib/format';

// Relative time with the full date on hover. `now` comes from the last poll so
// every row agrees and re-renders stay pure.
export function OrderTime({ createdAt, now, className = '' }: {
  createdAt: string;
  now?: number;
  className?: string;
}) {
  return (
    <time dateTime={createdAt} title={formatDateTime(createdAt)} className={`whitespace-nowrap text-[11px] text-subtle ${className}`}>
      {formatRelative(createdAt, now)}
    </time>
  );
}

export function NewBadge() {
  return (
    <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
      New
    </span>
  );
}

// Enter/Space activation for non-button elements that act like buttons (table rows, cards).
export function activateOnKey(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}
