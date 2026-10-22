import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';

// Sidebar + sticky topbar around every dashboard page. Pages render their own
// content container and hero heading.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
