// Checks for this backend's own environment variables: the auto-reply switch, the admin key and
// the Redis storage. The bot's settings (Page token, Page ID, App Secret, Verify Token) are checked
// by the orderpilot package itself, through bot.checkConfig().
//
// Everything is read from process.env at call time, so tests and .env changes behave predictably.
// Only variable names are ever returned, never values.

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const isUnset = (value) => value === '' || value.startsWith('replace_with');

// Auto-reply is opt-in: only the literal value "true" (any case) turns it on.
export function isAutoReplyEnabled(env = process.env) {
  return clean(env.ENABLE_AUTO_REPLY).toLowerCase() === 'true';
}

// Anything but true, false or unset is a typo that must not silently switch replies on or off.
export function invalidAutoReplyVars(env = process.env) {
  const flag = clean(env.ENABLE_AUTO_REPLY).toLowerCase();
  return ['', 'true', 'false'].includes(flag) ? [] : ['ENABLE_AUTO_REPLY'];
}

// The admin key protects /api/orders. Reject missing, placeholder and short (< 16 characters) keys.
export function invalidAdminVars(env = process.env) {
  const key = clean(env.ADMIN_API_KEY);
  return isUnset(key) || key.length < 16 ? ['ADMIN_API_KEY'] : [];
}

// Upstash Redis REST credentials, or null when storage stays in memory. Vercel's Upstash
// integration creates the KV_REST_API_* names; a database made at upstash.com shows UPSTASH_*.
export function getRedisConfig(env = process.env) {
  const url = clean(env.UPSTASH_REDIS_REST_URL) || clean(env.KV_REST_API_URL);
  const token = clean(env.UPSTASH_REDIS_REST_TOKEN) || clean(env.KV_REST_API_TOKEN);
  return url === '' && token === '' ? null : { url, token };
}

// Serverless instances do not share memory and are recycled at any time, so on Vercel
// (VERCEL=1) orders and sessions must go to Redis. Elsewhere Redis is optional.
export function invalidStorageVars(env = process.env) {
  const redis = getRedisConfig(env);
  if (redis === null) return clean(env.VERCEL) === '' ? [] : ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];

  const invalid = [];
  if (!/^https:\/\/[^\s/?#@]+\/?$/i.test(redis.url)) invalid.push('UPSTASH_REDIS_REST_URL');
  if (isUnset(redis.token)) invalid.push('UPSTASH_REDIS_REST_TOKEN');
  return invalid;
}

// Every problem with this backend's own variables (PORT is checked by server.js).
export function invalidConfigVars(env = process.env) {
  return [...invalidAutoReplyVars(env), ...invalidAdminVars(env), ...invalidStorageVars(env)];
}
