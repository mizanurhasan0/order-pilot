'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { PRODUCTS_MAX_SEARCH_LENGTH } from '@/lib/types';
import { normalizeSearch } from '@/hooks/useProductsUrlState';

const DEBOUNCE_MS = 300;

// `value` is the committed search (from the URL); typing is debounced before onSearch.
export function ProductSearch({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [input, setInput] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Adopt outside changes (Clear filters, a sidebar link) without fighting the user's
  // typing: a trailing space the user is still typing is not stripped.
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (normalizeSearch(input) !== value) setInput(value);
  }

  useEffect(() => {
    const next = normalizeSearch(input);
    if (next === value) return;
    const timer = setTimeout(() => onSearch(next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, value, onSearch]);

  const clear = () => {
    setInput('');
    onSearch('');
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSearch(normalizeSearch(input));
    } else if (event.key === 'Escape' && input) {
      event.preventDefault();
      clear();
    }
  };

  return (
    <div role="search" className="relative">
      <Search
        size={17}
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#97a69b]"
      />
      <input
        ref={inputRef}
        type="search"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={PRODUCTS_MAX_SEARCH_LENGTH}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search products"
        placeholder="Search by name, description or category..."
        className="w-full rounded-xl border border-line bg-[#fbfcfb] py-2.5 pl-10 pr-10 text-sm text-ink outline-none! transition placeholder:text-subtle focus:border-[#79b999] focus:bg-white focus:ring-2 focus:ring-[#d8f1df] [&::-webkit-search-cancel-button]:appearance-none"
      />
      {input && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-brand-50 hover:text-ink-soft"
        >
          <X size={15} aria-hidden />
        </button>
      )}
    </div>
  );
}
