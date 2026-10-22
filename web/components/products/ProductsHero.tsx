import { MessageCircle } from 'lucide-react';

// Static page heading, rendered on the server outside the Suspense boundary.
export function ProductsHero() {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-full bg-brand-400" />
          <span className="text-[11px] font-bold uppercase tracking-[.17em] text-brand-500">Catalog</span>
        </div>
        <h2 className="text-[28px] font-bold tracking-[-.04em] text-ink sm:text-[34px]">
          Products<span className="text-muted">.</span>
        </h2>
        <p className="mt-1.5 text-sm text-muted">Everything your Messenger bot can sell, with live availability.</p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs text-muted">
        <MessageCircle size={13} aria-hidden />
        Read-only view of the bot&apos;s catalog
      </div>
    </div>
  );
}
