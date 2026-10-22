'use client';

import { usePathname } from 'next/navigation';
import type { Ref } from 'react';
import { Menu } from 'lucide-react';
import { ConnectionPill } from './ConnectionPill';
import { findNavItem } from './nav';
import { SIDEBAR_ID } from './Sidebar';

export function Topbar({ menuOpen, onOpenMenu, menuButtonRef }: {
  menuOpen: boolean;
  onOpenMenu: () => void;
  menuButtonRef?: Ref<HTMLButtonElement>;
}) {
  const pathname = usePathname();
  const item = findNavItem(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between gap-4 border-b border-line bg-white/95 px-5 backdrop-blur md:px-9 lg:px-11">
      <div className="flex min-w-0 items-center gap-3">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          aria-controls={SIDEBAR_ID}
          className="-ml-2 rounded-lg p-2 text-ink-soft hover:bg-brand-50 lg:hidden"
        >
          <Menu size={21} aria-hidden />
        </button>
        <div className="min-w-0">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-[11px] font-medium text-subtle">
              <li>Workspace</li>
              {item && (
                <>
                  <li aria-hidden>/</li>
                  <li aria-current="page" className="text-muted">{item.label}</li>
                </>
              )}
            </ol>
          </nav>
          <h1 className="mt-0.5 truncate text-lg font-bold tracking-tight text-ink">
            {item?.title ?? 'Dashboard'}
          </h1>
        </div>
      </div>
      <ConnectionPill />
    </header>
  );
}
