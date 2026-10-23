// Product links for Facebook posts. Opening https://m.me/<page>?ref=ORDER_PRODUCT:P001 starts the
// order for that product in Messenger (the bot reads the ref in api/src/services/payloads.js).
// Pure functions, safe on server and client.

import { formatMoney } from './format';
import type { Product } from './types';

// Facebook usernames are letters, digits and periods. A numeric Page ID passes too.
const PAGE_USERNAME_FORMAT = /^[A-Za-z0-9.]{1,50}$/;

// The Page username from NEXT_PUBLIC_FACEBOOK_PAGE_USERNAME, or null when it is missing or not a
// username. NEXT_PUBLIC_ values are inlined at build time, so a change needs a restart or redeploy.
export function getFacebookPageUsername(): string | null {
  const raw = (process.env.NEXT_PUBLIC_FACEBOOK_PAGE_USERNAME ?? '').trim().replace(/^@/, '');
  return PAGE_USERNAME_FORMAT.test(raw) ? raw : null;
}

export const messengerProductLink = (pageUsername: string, productId: string) =>
  `https://m.me/${pageUsername}?ref=ORDER_PRODUCT:${encodeURIComponent(productId)}`;

// Facebook's share dialog. It takes a URL only: the post text has to be pasted by hand.
export const facebookShareUrl = (link: string) =>
  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;

// Ready-to-paste post text, in Bangla like the bot's replies.
export function productPostText(product: Product, link: string): string {
  const lines = [`🛍️ ${product.name}`, `💰 দাম: ${formatMoney(product.price, product.currency)}`];
  if (product.description) lines.push('', product.description);
  lines.push('', '👉 অর্ডার করতে ক্লিক করুন, Messenger-এ খুলবে:', link);
  return lines.join('\n');
}
