const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';
const EDGE_NOISE = /^[\s!.?,;:।'"~]+|[\s!.?,;:।'"~]+$/gu;

// Lower-cases, collapses whitespace, turns Bangla digits into ASCII digits and strips
// punctuation around the message, so "  Hi! " and "১" match their keywords.
export function normalizeText(text) {
  const value = text === undefined || text === null ? '' : String(text);
  return value
    .normalize('NFC')
    .replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)))
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(EDGE_NOISE, '');
}
