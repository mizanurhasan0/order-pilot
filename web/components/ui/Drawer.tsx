'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

// Right-hand side panel used for order and product details.
// Closes on Escape and backdrop click, locks page scroll, and returns focus on close.
export function Drawer({ open, onClose, eyebrow, title, children, footer }: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  // Held in a ref so an inline onClose from the parent doesn't re-run the effect
  // (which would bounce focus and scroll lock on every parent render).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[#17251c]/35 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : eyebrow}
        className="soft-scroll flex h-full w-full max-w-[470px] animate-slide-in flex-col overflow-y-auto bg-surface shadow-2xl outline-none"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-white/95 px-6 py-5 backdrop-blur">
          <div className="min-w-0">
            {eyebrow && <p className="text-xs font-medium text-muted">{eyebrow}</p>}
            <h2 className="mt-0.5 truncate text-xl font-bold tracking-tight text-ink">{title}</h2>
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded-xl border border-line p-2 text-ink-soft hover:bg-brand-50">
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="flex-1 space-y-6 p-6">{children}</div>
        {footer && <footer className="sticky bottom-0 border-t border-line bg-white px-6 py-4">{footer}</footer>}
      </section>
    </div>
  );
}
