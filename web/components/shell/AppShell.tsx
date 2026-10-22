'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPathname, setMenuPathname] = useState(pathname);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close the mobile menu on route change. Adjusting state during render avoids
  // a frame where the new page shows under the open menu.
  if (menuPathname !== pathname) {
    setMenuPathname(pathname);
    setMenuOpen(false);
  }

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const dismissMenu = useCallback(() => setMenuOpen(false), []);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen, closeMenu]);

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <Sidebar open={menuOpen} onClose={closeMenu} onNavigate={dismissMenu} closeButtonRef={closeButtonRef} />
      {menuOpen && (
        <div
          aria-hidden
          onClick={closeMenu}
          className="fixed inset-0 z-30 bg-[#17251c]/30 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <div className="min-w-0 flex-1">
        <Topbar menuOpen={menuOpen} onOpenMenu={openMenu} menuButtonRef={menuButtonRef} />
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
