import crypto from 'node:crypto';

// Constant-time string comparison. crypto.timingSafeEqual throws when the two
// buffers differ in length, so both inputs are hashed first: SHA-256 digests
// are always 32 bytes, which also keeps the length of the real secret hidden.
export function safeEqual(a, b) {
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}
