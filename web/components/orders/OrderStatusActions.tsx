'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ban, CheckCircle2, Loader2, RotateCcw, Undo2, type LucideIcon } from 'lucide-react';
import type { OrderStatus } from '@/lib/types';

type Action = {
  to: OrderStatus;
  label: string;
  icon: LucideIcon;
  variant: 'primary' | 'secondary' | 'danger';
};

const CONFIRM: Action = { to: 'confirmed', label: 'Confirm order', icon: CheckCircle2, variant: 'primary' };
const CANCEL: Action = { to: 'cancelled', label: 'Cancel order', icon: Ban, variant: 'danger' };
const MARK_PENDING: Action = { to: 'pending', label: 'Mark as pending', icon: Undo2, variant: 'secondary' };
const REOPEN: Action = { to: 'pending', label: 'Reopen as pending', icon: RotateCcw, variant: 'primary' };

const ACTIONS: Record<OrderStatus, Action[]> = {
  pending: [CONFIRM, CANCEL],
  confirmed: [MARK_PENDING, CANCEL],
  cancelled: [REOPEN],
};

const VARIANTS = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800',
  secondary: 'border border-line bg-surface text-ink-soft hover:bg-canvas',
  danger: 'border border-red-200 bg-surface text-red-700 hover:bg-red-50',
  dangerSolid: 'bg-red-600 text-white hover:bg-red-700',
} as const;

function ActionButton({ variant, action, busy, disabled, focusTarget, onClick, children }: {
  variant: keyof typeof VARIANTS;
  action?: OrderStatus;
  busy?: boolean;
  disabled: boolean;
  focusTarget?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  // aria-disabled instead of disabled keeps keyboard focus in place while saving.
  return (
    <button
      type="button"
      aria-disabled={disabled}
      data-action={action}
      data-focus-target={focusTarget || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${VARIANTS[variant]}`}
    >
      {busy && <Loader2 size={16} aria-hidden className="animate-spin" />}
      {children}
    </button>
  );
}

// Footer actions for the order drawer. Cancelling asks for an inline confirmation.
export function OrderStatusActions({ orderId, status, saving, onChange }: {
  orderId: string;
  status: OrderStatus;
  saving: OrderStatus | null;
  onChange: (to: OrderStatus) => Promise<boolean>;
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const busy = saving !== null;

  // When the buttons are swapped out (status changed, confirmation opened or
  // closed) the focused button disappears; move focus to the sensible next one.
  const view = `${status}:${confirmingCancel}`;
  const lastViewRef = useRef(view);
  useEffect(() => {
    const previous = lastViewRef.current;
    if (previous === view) return;
    lastViewRef.current = view;
    const container = containerRef.current;
    const active = document.activeElement;
    const focusLost = !active || active === document.body || container?.contains(active);
    if (!container || !focusLost) return;
    // "Keep order" returns focus to the cancel button; anything else goes to the first action.
    const selector = previous === `${status}:true` ? '[data-action="cancelled"]' : '[data-focus-target]';
    container.querySelector<HTMLElement>(selector)?.focus();
  }, [view, status]);

  const run = async (to: OrderStatus) => {
    const ok = await onChange(to);
    if (ok) setConfirmingCancel(false);
  };

  if (confirmingCancel && status !== 'cancelled') {
    return (
      <div ref={containerRef} className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-800">Cancel {orderId}?</p>
        <p className="mt-1 text-xs text-red-700/80">You can reopen it later if needed.</p>
        <div className="mt-3 flex gap-2">
          <ActionButton
            variant="dangerSolid"
            busy={saving === 'cancelled'}
            disabled={busy}
            onClick={() => run('cancelled')}
          >
            Yes, cancel
          </ActionButton>
          <ActionButton
            variant="secondary"
            disabled={busy}
            focusTarget
            onClick={() => setConfirmingCancel(false)}
          >
            Keep order
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex gap-2">
      {ACTIONS[status].map((action, index) => {
        const Icon = action.icon;
        const isCancel = action.to === 'cancelled';
        return (
          <ActionButton
            key={action.label}
            variant={action.variant}
            action={action.to}
            busy={saving === action.to}
            disabled={busy}
            focusTarget={index === 0}
            onClick={() => (isCancel ? setConfirmingCancel(true) : run(action.to))}
          >
            {saving !== action.to && <Icon size={16} aria-hidden />}
            {action.label}
          </ActionButton>
        );
      })}
    </div>
  );
}
