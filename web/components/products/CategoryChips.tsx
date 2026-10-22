'use client';

const sameCategory = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
        active
          ? 'border-brand-700 bg-brand-700 text-white'
          : 'border-line bg-[#fbfcfb] text-ink-soft hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700'
      }`}
    >
      {label}
    </button>
  );
}

// `active` is '' for All. Categories come from the shared catalog (useCatalog), so they appear once it loads.
export function CategoryChips({ categories, active, loading, onSelect }: {
  categories: string[];
  active: string;
  loading: boolean;
  onSelect: (category: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by category"
      className="soft-scroll -mx-5 -my-1 flex gap-2 overflow-x-auto px-5 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <Chip label="All" active={active === ''} onClick={() => onSelect('')} />
      {categories.map((category) => (
        <Chip
          key={category}
          label={category}
          active={sameCategory(category, active)}
          onClick={() => onSelect(category)}
        />
      ))}
      {categories.length === 0 && loading && (
        <div aria-hidden className="flex animate-pulse gap-2">
          {[64, 88, 56, 72, 60].map((width) => (
            <span key={width} className="h-[30px] shrink-0 rounded-full bg-line-soft" style={{ width }} />
          ))}
        </div>
      )}
    </div>
  );
}
