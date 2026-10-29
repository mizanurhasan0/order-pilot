import { normalizeText } from './normalizeText.js';

// Strict, whole-value checks for what a customer types while ordering. Every function
// returns a clean value or null: no partial matches, no decimals, no signs, nothing guessed.

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 100;
export const MIN_ADDRESS_LENGTH = 10;
export const MAX_ADDRESS_LENGTH = 200;

const MAX_PHONE_INPUT_LENGTH = 40;

// "5", "05", "৫" -> 5. Anything but 1-3 digits worth 1..100 -> null.
export function parseQuantity(text) {
  const value = normalizeText(text);
  if (!/^\d{1,3}$/.test(value)) return null;
  const quantity = Number(value);
  return quantity >= MIN_QUANTITY && quantity <= MAX_QUANTITY ? quantity : null;
}

// Bangladesh mobile numbers: 01XXXXXXXXX, +8801XXXXXXXXX or 8801XXXXXXXXX, where the digit
// after "01" is 3-9. Spaces, dashes, dots and parentheses inside the number are ignored.
// Always returns the local 11-digit form, so every order stores one format.
export function normalizeBdPhone(text) {
  const value = normalizeText(text);
  if (value.length > MAX_PHONE_INPUT_LENGTH) return null;
  const compact = value.replace(/[\s\-.()]/g, '');
  const match = /^(?:\+88|88)?(01[3-9]\d{8})$/.exec(compact);
  return match ? match[1] : null;
}

// Keeps the customer's own wording and case; only trims and collapses whitespace.
export function parseAddress(text) {
  if (typeof text !== 'string') return null;
  const address = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  const length = Array.from(address).length;
  return length >= MIN_ADDRESS_LENGTH && length <= MAX_ADDRESS_LENGTH ? address : null;
}
