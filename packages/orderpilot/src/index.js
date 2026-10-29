// orderpilot: a Messenger order bot for a Facebook Page. Install it in any Node.js app, give it
// the Page's details (options or environment variables) and your products, mount the webhook.
//
//   import { createOrderPilot } from 'orderpilot-messenger-bot';
//
//   const bot = createOrderPilot({ shopName: 'My Shop', products });
//   app.use('/webhook/facebook', bot.webhook);
//
// See README.md for every option.

export { createOrderPilot } from './orderPilot.js';
export { createCatalog, createPagedCatalog, CATALOG_PAGE_SIZE } from './catalog.js';
export { DEFAULT_GRAPH_API_VERSION, ENV_NAMES } from './config.js';
export { WEBHOOK_FIELDS } from './connect.js';
export { DEFAULT_LANGUAGE, LANGUAGES } from './services/language.js';
export {
  PAYLOAD_TYPES,
  CANCEL_ORDER_PAYLOAD,
  GET_STARTED_PAYLOAD,
  MENU_PAYLOAD,
  MY_ORDERS_PAYLOAD,
  NEW_DETAILS_PAYLOAD,
  SUPPORT_PAYLOAD,
  USE_SAVED_ADDRESS_PAYLOAD,
  USE_SAVED_DETAILS_PAYLOAD,
  USE_SAVED_PHONE_PAYLOAD,
  catalogPagePayload,
  confirmOrderPayload,
  languagePayload,
  orderProductPayload,
  quantityPayload,
} from './services/payloads.js';
export { quickRepliesFor } from './services/quickReplies.js';
export { textsFor } from './services/replyTexts.js';
export { ORDER_STATUSES, createOrderStore } from './store/orderStore.js';
export { createRedisOrderStore } from './store/redisOrderStore.js';
export { STEPS, conversationKey } from './store/sessionStore.js';

// The m.me link that opens Messenger with a product already chosen, for posts and websites:
// https://m.me/<page username>?ref=ORDER_PRODUCT:P001
export const productLink = (pageUsername, productId) =>
  `https://m.me/${encodeURIComponent(String(pageUsername).replace(/^@/, ''))}?ref=ORDER_PRODUCT:${encodeURIComponent(productId)}`;
