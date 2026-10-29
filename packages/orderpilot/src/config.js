// The bot's settings. A value passed to createOrderPilot() wins; when it is left out, the
// environment variable is read at call time, so a changed .env applies without a restart and a
// bot can be created before the environment is loaded.
//
// Names (never values) are what callers may log; values are never logged here.

export const DEFAULT_GRAPH_API_VERSION = 'v26.0';

// Option name -> environment variable read when the option is left out.
export const ENV_NAMES = Object.freeze({
  pageAccessToken: 'PAGE_ACCESS_TOKEN',
  pageId: 'FACEBOOK_PAGE_ID',
  appSecret: 'META_APP_SECRET',
  verifyToken: 'META_VERIFY_TOKEN',
  graphApiVersion: 'META_GRAPH_API_VERSION',
  appId: 'FACEBOOK_APP_ID',
  webhookUrl: 'WEBHOOK_URL',
  shopName: 'SHOP_NAME',
});

const GRAPH_VERSION_FORMAT = /^v\d+\.\d+$/;
const NUMERIC_ID = /^\d+$/;

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const isUnset = (value) => value === '' || value.startsWith('replace_with');

// "pageAccessToken (PAGE_ACCESS_TOKEN)": what a log line or an error says about a setting.
export const describeSetting = (name) => (ENV_NAMES[name] ? `${name} (${ENV_NAMES[name]})` : name);

export function createSettings(options = {}, env = process.env) {
  const value = (name) => {
    const given = options[name];
    if (given !== undefined && given !== null) return clean(String(given));
    return clean(env[ENV_NAMES[name]]);
  };

  // A boolean option may also be a function, read at call time.
  const flag = (given, fallback) => {
    if (typeof given === 'function') return given() === true;
    if (typeof given === 'boolean') return given;
    return fallback();
  };

  // Names of the Send API settings that are missing or malformed.
  function invalidSendApi() {
    const invalid = [];
    if (isUnset(value('pageAccessToken'))) invalid.push('pageAccessToken');
    if (!NUMERIC_ID.test(value('pageId'))) invalid.push('pageId');
    // An unset version falls back to DEFAULT_GRAPH_API_VERSION; a malformed one is an error.
    const version = value('graphApiVersion');
    if (version !== '' && !GRAPH_VERSION_FORMAT.test(version)) invalid.push('graphApiVersion');
    return invalid;
  }

  // Replies are on unless the autoReply option says otherwise.
  const autoReply = () => flag(options.autoReply, () => true);

  return {
    // What the webhook needs, plus the Page settings while replies are on, by option name.
    invalid() {
      const secrets = ['appSecret', 'verifyToken'].filter((name) => isUnset(value(name)));
      return autoReply() ? [...secrets, ...invalidSendApi()] : secrets;
    },

    invalidSendApi,

    // Trimmed Send API settings, or null while any of them is missing or malformed.
    sendApi() {
      if (invalidSendApi().length > 0) return null;
      return {
        accessToken: value('pageAccessToken'),
        pageId: value('pageId'),
        version: value('graphApiVersion') || DEFAULT_GRAPH_API_VERSION,
      };
    },

    pageId: () => value('pageId'),
    graphApiVersion: () => {
      const version = value('graphApiVersion');
      return GRAPH_VERSION_FORMAT.test(version) ? version : DEFAULT_GRAPH_API_VERSION;
    },
    // null while unset, so callers can never compare against a blank secret.
    appSecret: () => (isUnset(value('appSecret')) ? null : value('appSecret')),
    verifyToken: () => (isUnset(value('verifyToken')) ? null : value('verifyToken')),
    appId: () => (NUMERIC_ID.test(value('appId')) ? value('appId') : null),
    webhookUrl: () => value('webhookUrl') || null,
    shopName: () => value('shopName'),

    autoReply,
    // The customer's Facebook language picks Bangla or English unless this is off. DETECT_LANGUAGE=false
    // turns it off when the option is left out.
    detectLanguage: () => flag(options.detectLanguage, () => clean(env.DETECT_LANGUAGE).toLowerCase() !== 'false'),
  };
}
