'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

// Labelled copy button that shows "Copied" or "Copy failed" for a moment.
// `name` is what screen readers hear, for example "Product ID P001".
export function CopyTextButton({ value, label, name }: { value: string; label: string; name: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  const text = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;
  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
          state === 'copied'
            ? 'border-brand-200 bg-brand-50 text-brand-700'
            : state === 'failed'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-line text-ink-soft hover:bg-brand-50'
        }`}
      >
        {state === 'copied' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        {text}
      </button>
      <span role="status" className="sr-only">
        {state === 'copied' ? `${name} copied` : state === 'failed' ? `Could not copy ${name}` : ''}
      </span>
    </>
  );
}
