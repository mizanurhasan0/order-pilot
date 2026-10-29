// Keeps only the last 4 characters of a Page-Scoped ID (PSID) so logs never carry a full identifier.
export function maskId(id) {
  const value = typeof id === 'number' ? String(id) : id;
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.length > 8 ? `…${value.slice(-4)}` : '…';
}
