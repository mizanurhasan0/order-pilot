'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Ref } from 'react';
import { MessageCircle, Package, X } from 'lucide-react';
import { NAV_ITEMS, isActivePath } from './nav';

export const SIDEBAR_ID = 'app-sidebar';

// Off-canvas below lg (toggled from the topbar), pinned beside the content from lg up.
export function Sidebar({ open, onClose, onNavigate, closeButtonRef }: {
  open: boolean;
  onClose: () => void;
  onNavigate: () => void; // a link to the current page does not change the pathname
  closeButtonRef?: Ref<HTMLButtonElement>;
}) {
  const pathname = usePathname();

  return (
    <aside
      id={SIDEBAR_ID}
      aria-label="Main navigation"
      className={[
        'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line bg-surface px-4 pb-6 pt-7',
        'transition-[translate,visibility] duration-200 ease-out',
        'lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 lg:shadow-none lg:visible',
        open ? 'visible translate-x-0 shadow-xl' : 'invisible -translate-x-full',
      ].join(' ')}
    >
      <div className="mb-10 flex items-center gap-3 px-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700 text-white">
          <Package size={22} strokeWidth={2.1} aria-hidden />
        </div>
        <div>
          <p className="text-[19px] font-extrabold leading-5 tracking-tight text-ink">OrderPilot</p>
          <p className="mt-1 text-[11px] font-medium tracking-wide text-subtle">MERCHANT DASHBOARD</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="ml-auto rounded-lg p-1.5 text-ink-soft hover:bg-brand-50 lg:hidden"
        >
          <X size={20} aria-hidden />
        </button>
      </div>

      <nav aria-label="Workspace">
        <p className="mb-3 px-4 text-[10px] font-bold uppercase tracking-[.16em] text-subtle">Workspace</p>
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                    active ? 'bg-brand-100 text-brand-700' : 'text-ink-soft hover:bg-canvas hover:text-ink'
                  }`}
                >
                  <Icon size={18} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto rounded-2xl border border-line-soft bg-canvas p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
            <MessageCircle size={16} aria-hidden />
          </span>
          Facebook Messenger
        </div>
        <p className="text-xs leading-5 text-muted">
          Orders collected by your Messenger bot appear here automatically.
        </p>
        <p className="mt-4 flex items-center gap-2 text-xs font-medium text-brand-600">
          <span aria-hidden className="h-2 w-2 rounded-full bg-brand-400" />
          Local dashboard
        </p>
      </div>
      <p className="mt-5 px-3 text-xs text-subtle">OrderPilot · Local MVP</p>
    </aside>
  );
}
