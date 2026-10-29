import { createCatalog } from './catalog.js';
import { createSettings, describeSetting } from './config.js';
import { connectPage } from './connect.js';
import { createAutoReplyService } from './services/autoReplyService.js';
import { createConversationService } from './services/conversationService.js';
import { createDedupeCache } from './services/dedupeCache.js';
import { createMessengerClient } from './services/messengerService.js';
import { createRedisDedupeCache } from './services/redisDedupeCache.js';
import { createOrderStore } from './store/orderStore.js';
import { createPreferenceStore } from './store/preferenceStore.js';
import { createRedisOrderStore } from './store/redisOrderStore.js';
import { createRedisPreferenceStore } from './store/redisPreferenceStore.js';
import { createRedisSessionStore } from './store/redisSessionStore.js';
import { createSessionStore } from './store/sessionStore.js';
import { createWebhook } from './webhook.js';

// createOrderPilot(): one Messenger order bot for one Facebook Page.
//
// Storage: a Redis client (`redis`) keeps orders, conversations, languages and the duplicate
// filter in Redis, which serverless hosting needs. Without one they live in this process's
// memory and are lost on restart. A shop can also pass its own `orders`, `sessions`,
// `preferences` or `dedupe` store; the methods each needs are checked here.

const STORE_METHODS = {
  orders: ['create', 'get', 'listByCustomer', 'findByIdempotencyKey'],
  sessions: ['get', 'update', 'reset'],
  preferences: ['getLanguage', 'setLanguage'],
  dedupe: ['markIfNew'],
  redis: ['get', 'set', 'del', 'incr', 'mget', 'zadd', 'zrange', 'zcard'],
};

function checkStore(name, store) {
  if (store === undefined || store === null) return;
  const missing = STORE_METHODS[name].filter((method) => typeof store[method] !== 'function');
  if (missing.length > 0) throw new TypeError(`${name} is missing: ${missing.join(', ')}`);
}

export function createOrderPilot(options = {}) {
  if (options === null || typeof options !== 'object') throw new TypeError('createOrderPilot() takes an options object');
  for (const name of Object.keys(STORE_METHODS)) checkStore(name, options[name]);
  for (const name of ['onOrder', 'waitUntil']) {
    if (options[name] !== undefined && typeof options[name] !== 'function') throw new TypeError(`${name} must be a function`);
  }

  const settings = createSettings(options);
  const redis = options.redis ?? null;
  const prefix = typeof options.redisPrefix === 'string' && options.redisPrefix !== '' ? options.redisPrefix : 'orderpilot:';

  const orders = options.orders ?? (redis ? createRedisOrderStore({ redis, prefix }) : createOrderStore());
  const sessions = options.sessions ?? (redis ? createRedisSessionStore({ redis, prefix }) : createSessionStore({ autoPurge: true }));
  const preferences = options.preferences ?? (redis ? createRedisPreferenceStore({ redis, prefix }) : createPreferenceStore());
  const dedupe = options.dedupe ?? (redis ? createRedisDedupeCache({ redis, prefix }) : createDedupeCache());
  const catalog = createCatalog(options.products ?? []);

  const messenger = createMessengerClient({ getConfig: settings.sendApi });
  const conversation = createConversationService({ sessions, orders, preferences, catalog, shopName: settings.shopName });
  const { processEntries } = createAutoReplyService({
    conversation,
    sessions,
    preferences,
    orders,
    dedupe,
    messenger,
    settings,
    onOrder: options.onOrder,
  });
  const webhook = createWebhook({ settings, processEntries, waitUntil: options.waitUntil });

  return Object.freeze({
    // Express / Connect / node:http handler for the webhook URL.
    webhook: webhook.node,
    // Request -> Response handler (Next.js route handlers, Hono, Bun, Deno, Workers).
    fetchHandler: webhook.fetchHandler,
    // The framework-free core, for anything else.
    handleWebhook: webhook.handleWebhook,
    // Answers already verified webhook entries (the webhook calls it).
    processEntries,
    // Links the Page to the bot through the Graph API (see connect.js).
    connect: (connectOptions) => connectPage(settings, connectOptions),
    // Names of the settings that are missing or malformed, e.g. ['pageAccessToken (PAGE_ACCESS_TOKEN)'].
    // The Page token and ID count only while replies are on (autoReply).
    checkConfig: () => settings.invalid().map(describeSetting),
    // Where orders are kept: 'redis', 'memory' or 'custom' (the shop's own store).
    storage: options.orders ? 'custom' : redis ? 'redis' : 'memory',
    orders,
    sessions,
    preferences,
    catalog,
    messenger,
    // Stops the memory session store's cleanup timer (it never keeps the process alive anyway).
    close() {
      sessions.stop?.();
    },
  });
}
