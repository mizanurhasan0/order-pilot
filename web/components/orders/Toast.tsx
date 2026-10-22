'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

type ToastMessage = { id: number; text: string };

const DURATION_MS = 3_000;

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const dismissToast = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const showToast = useCallback((text: string) => {
    window.clearTimeout(timerRef.current);
    setToast((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
    timerRef.current = window.setTimeout(() => setToast(null), DURATION_MS);
  }, []);

  useEffect(() => {
    const timer = timerRef;
    return () => window.clearTimeout(timer.current);
  }, []);

  return { toast, showToast, dismissToast };
}

// The live region stays mounted so screen readers announce each new message.
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex justify-center sm:inset-x-auto sm:bottom-6 sm:left-6"
    >
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex animate-fade-up items-center gap-3 rounded-xl bg-ink py-3 pl-4 pr-2 text-sm font-medium text-white shadow-lg"
        >
          <CheckCircle2 size={17} aria-hidden className="shrink-0 text-brand-400" />
          <span>{toast.text}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X size={15} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
