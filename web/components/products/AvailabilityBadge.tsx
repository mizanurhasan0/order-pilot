export function AvailabilityBadge({ available, className = '' }: { available: boolean; className?: string }) {
  const tone = available
    ? { pill: 'text-brand-700 ring-brand-200', dot: 'bg-brand-400' }
    : { pill: 'text-ink-soft ring-line', dot: 'bg-subtle' };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset backdrop-blur ${tone.pill} ${className}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {available ? 'Available' : 'Unavailable'}
    </span>
  );
}
