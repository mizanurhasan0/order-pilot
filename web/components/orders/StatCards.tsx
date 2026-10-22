import { CheckCircle2, Clock3, ShoppingBag, Wallet, type LucideIcon } from 'lucide-react';
import type { OrdersSummary } from '@/lib/types';
import { formatMoney } from '@/lib/format';

const count = (value: number) => value.toLocaleString('en-BD');

const CARDS: {
  label: string;
  note: string;
  icon: LucideIcon;
  chip: string;
  value: (summary: OrdersSummary) => string;
}[] = [
  {
    label: 'Total orders',
    note: 'Every order received',
    icon: ShoppingBag,
    chip: 'bg-brand-100 text-brand-600',
    value: (summary) => count(summary.total),
  },
  {
    label: 'Pending',
    note: 'Waiting for your confirmation',
    icon: Clock3,
    chip: 'bg-[#fff6e6] text-[#bd8639]',
    value: (summary) => count(summary.pending),
  },
  {
    label: 'Confirmed',
    note: 'Ready to fulfil',
    icon: CheckCircle2,
    chip: 'bg-[#eef3fa] text-[#4e729c]',
    value: (summary) => count(summary.confirmed),
  },
  {
    label: 'Confirmed value',
    note: 'Sum of confirmed orders',
    icon: Wallet,
    chip: 'bg-[#f4effb] text-[#8b66ae]',
    value: (summary) => formatMoney(summary.confirmedValue, summary.currency),
  },
];

// Pass `null` while the first snapshot loads to get skeletons.
export function StatCards({ summary }: { summary: OrdersSummary | null }) {
  return (
    <dl className="mb-9 grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-5">
      {CARDS.map(({ label, note, icon: Icon, chip, value }) => (
        <div key={label} className="panel-shadow rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <dt>
            <span className={`mb-6 flex h-10 w-10 items-center justify-center rounded-xl ${chip}`}>
              <Icon size={19} aria-hidden />
            </span>
            <span className="text-xs font-medium text-muted">{label}</span>
          </dt>
          <dd className="mt-1.5">
            {summary ? (
              <span className="block break-words text-2xl font-bold tracking-tight text-ink tabular-nums sm:text-[29px]">
                {value(summary)}
              </span>
            ) : (
              <>
                <span aria-hidden className="block h-8 w-20 animate-pulse rounded-lg bg-line-soft sm:h-9" />
                <span className="sr-only">Loading</span>
              </>
            )}
            <span className="mt-2 block text-[11px] text-subtle">{note}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
