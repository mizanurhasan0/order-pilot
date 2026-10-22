import { Boxes, ReceiptText, type LucideIcon } from 'lucide-react';

export type NavItem = {
  href: string;
  label: string; // sidebar + breadcrumb
  title: string; // topbar heading
  icon: LucideIcon;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/orders', label: 'Orders', title: 'Order management', icon: ReceiptText },
  { href: '/products', label: 'Products', title: 'Product catalog', icon: Boxes },
];

export const isActivePath = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export const findNavItem = (pathname: string) =>
  NAV_ITEMS.find((item) => isActivePath(pathname, item.href)) ?? null;
