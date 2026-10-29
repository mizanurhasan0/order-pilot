// This shop's Messenger order bot: the orderpilot package (../packages/orderpilot) with our
// products and name, and storage in Upstash Redis when it is configured (required on Vercel), else
// in memory (bot.storage says which). The Page settings come from the environment (PAGE_ACCESS_TOKEN,
// FACEBOOK_PAGE_ID, META_APP_SECRET, META_VERIFY_TOKEN, ...), read on every request.
import './loadEnv.js';
import { Redis } from '@upstash/redis';
import { waitUntil } from '@vercel/functions';
import { createOrderPilot } from 'orderpilot-messenger-bot';
import { getRedisConfig, invalidStorageVars, isAutoReplyEnabled } from './config.js';
import { products } from './data/products.js';

export const SHOP_NAME = 'Tangail Botiques';

// Never Redis under `node --test` (it sets NODE_TEST_CONTEXT): production credentials exported
// in a shell must not let the test suite write to the real database. Invalid settings also fall
// back to memory here; startup validation reports them and refuses to serve.
const useRedis = !process.env.NODE_TEST_CONTEXT && invalidStorageVars().length === 0 && getRedisConfig() !== null;

const redis = useRedis
  ? new Redis({ ...getRedisConfig(), automaticDeserialization: false, enableTelemetry: false })
  : null;

export const bot = createOrderPilot({
  shopName: SHOP_NAME,
  products,
  redis,
  // Replies only with ENABLE_AUTO_REPLY=true, read on every delivery; otherwise receive and log.
  autoReply: () => isAutoReplyEnabled(),
  // On Vercel this keeps the function alive until the replies are sent; elsewhere it does nothing.
  waitUntil,
});
