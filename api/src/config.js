// Environment helpers for the Messenger auto-reply feature.
// Everything is read from process.env at call time, so tests and .env changes behave predictably.

export const DEFAULT_GRAPH_API_VERSION = 'v26.0';

const GRAPH_VERSION_FORMAT = /^v\d+\.\d+$/;
const PAGE_ID_FORMAT = /^\d+$/;

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Auto-reply is opt-in: only the literal value "true" (any case) turns it on.
export function isAutoReplyEnabled(env = process.env) {
  return clean(env.ENABLE_AUTO_REPLY).toLowerCase() === 'true';
}

// The bot reads a new customer's Facebook language (locale) once to pick Bangla or English.
// On unless DETECT_LANGUAGE is "false" (any case); without it every customer starts in Bangla.
export function isLanguageDetectionEnabled(env = process.env) {
  return clean(env.DETECT_LANGUAGE).toLowerCase() !== 'false';
}

// Names (never values) of the Send API variables that are missing or malformed.
export function invalidSendApiVars(env = process.env) {
  const invalid = [];
  const token = clean(env.PAGE_ACCESS_TOKEN);
  if (token === '' || token.startsWith('replace_with')) invalid.push('PAGE_ACCESS_TOKEN');
  if (!PAGE_ID_FORMAT.test(clean(env.FACEBOOK_PAGE_ID))) invalid.push('FACEBOOK_PAGE_ID');
  // An unset version falls back to DEFAULT_GRAPH_API_VERSION; a malformed one is an error.
  const version = clean(env.META_GRAPH_API_VERSION);
  if (version !== '' && !GRAPH_VERSION_FORMAT.test(version)) invalid.push('META_GRAPH_API_VERSION');
  return invalid;
}

// Startup validation: the Send API variables only matter when auto-reply is switched on.
export function invalidAutoReplyVars(env = process.env) {
  const flag = clean(env.ENABLE_AUTO_REPLY).toLowerCase();
  if (flag !== '' && flag !== 'true' && flag !== 'false') return ['ENABLE_AUTO_REPLY'];
  return flag === 'true' ? invalidSendApiVars(env) : [];
}

// The admin key protects /api/orders. Reject missing, placeholder and short (< 16 characters) keys.
export function invalidAdminVars(env = process.env) {
  const key = clean(env.ADMIN_API_KEY);
  return key === '' || key.startsWith('replace_with') || key.length < 16 ? ['ADMIN_API_KEY'] : [];
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
  if (redis.token === '' || redis.token.startsWith('replace_with')) invalid.push('UPSTASH_REDIS_REST_TOKEN');
  return invalid;
}

// Every variable problem except PORT, which only matters when server.js listens itself.
export function invalidConfigVars(env = process.env) {
  const isUnset = (name) => {
    const value = clean(env[name]);
    return value === '' || value.startsWith('replace_with');
  };
  return [
    ...['META_VERIFY_TOKEN', 'META_APP_SECRET'].filter(isUnset),
    ...invalidAutoReplyVars(env),
    ...invalidAdminVars(env),
    ...invalidStorageVars(env),
  ];
}

// Trimmed Send API settings. Call only after the variables have been validated.
export function getSendApiConfig(env = process.env) {
  return {
    accessToken: clean(env.PAGE_ACCESS_TOKEN),
    pageId: clean(env.FACEBOOK_PAGE_ID),
    version: clean(env.META_GRAPH_API_VERSION) || DEFAULT_GRAPH_API_VERSION,
  };
}
