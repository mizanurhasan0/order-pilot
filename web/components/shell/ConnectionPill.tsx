'use client';

import { useHealth } from '@/hooks/useHealth';
import { formatTime } from '@/lib/format';
import { describeConnection, type ConnectionTone } from './connection';

const TONES: Record<ConnectionTone, { pill: string; dot: string }> = {
  ok: { pill: 'border-brand-200/70 bg-brand-50 text-brand-700', dot: 'bg-brand-400' },
  down: { pill: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' },
  neutral: { pill: 'border-line bg-canvas text-muted', dot: 'animate-pulse bg-subtle' },
};

export function ConnectionPill() {
  const state = useHealth();
  const { tone, label, detail } = describeConnection(state);
  const style = TONES[tone];
  const checkedAt = state.kind === 'ready' ? ` Checked ${formatTime(state.health.checkedAt)}.` : '';

  return (
    <div
      role="status"
      aria-live="polite"
      title={`${detail}${checkedAt}`}
      className={`flex items-center gap-2 rounded-full border px-2.5 py-2 text-xs font-medium sm:px-3 sm:py-1.5 ${style.pill}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      <span className="sr-only">Backend connection: </span>
      <span className="sr-only sm:not-sr-only">{label}</span>
    </div>
  );
}
