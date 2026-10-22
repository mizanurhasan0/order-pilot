// Display formatting shared by every screen. Pure functions, safe on server and client.

const LOCALE = 'en-BD';

export function formatMoney(amount: number, currency = 'BDT'): string {
  if (currency.toUpperCase() === 'BDT') return `৳${Math.round(amount).toLocaleString(LOCALE)}`;
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString(LOCALE)} ${currency}`;
  }
}

const toDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  return date
    ? date.toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Date unknown';
}

export function formatTime(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : toDate(value);
  return date ? date.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' }) : '—';
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

// "just now", "5 minutes ago", "yesterday". Falls back to the full date after a week.
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  const date = toDate(value);
  if (!date) return 'Date unknown';
  const seconds = Math.round((date.getTime() - now) / 1000);
  if (Math.abs(seconds) < 45) return 'just now';
  if (Math.abs(seconds) >= 7 * 86_400) return formatDateTime(value);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return RELATIVE.format(Math.round(seconds / 60), 'minute');
}

export const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count.toLocaleString(LOCALE)} ${count === 1 ? singular : plural}`;
