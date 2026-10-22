'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const timer = timerRef;
    return () => window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // clipboard blocked by the browser; nothing useful to show
    }
    setCopied(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1_600);
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        title={copied ? 'Copied' : `Copy ${label}`}
        className="shrink-0 self-center rounded-lg p-2 text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700"
      >
        {copied ? <Check size={16} aria-hidden className="text-brand-600" /> : <Copy size={16} aria-hidden />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </>
  );
}
