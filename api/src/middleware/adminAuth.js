import { safeEqual } from '../utils/safeEqual.js';

// Protects the admin API. Callers must send the secret in the X-Admin-Key header.
// The key is read from process.env at request time and is never logged or echoed.
export function requireAdminKey(req, res, next) {
  const serverKey = (process.env.ADMIN_API_KEY ?? '').trim();
  const provided = req.headers['x-admin-key'];

  // A blank server key must never let anyone in; a repeated header (array) is rejected.
  const allowed = serverKey !== '' && typeof provided === 'string' && safeEqual(provided, serverKey);
  if (!allowed) {
    // Same answer for every failure so it does not reveal which part was wrong.
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
}
