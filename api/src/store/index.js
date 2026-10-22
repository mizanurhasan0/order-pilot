// The stores the app uses: Upstash Redis when it is configured (required on Vercel), otherwise
// the in-memory stores, which lose everything on restart. Callers await every store method,
// so both kinds behave the same to them.

import { Redis } from '@upstash/redis';
import { getRedisConfig, invalidStorageVars } from '../config.js';
import { createDedupeCache } from '../services/dedupeCache.js';
import { createRedisDedupeCache } from '../services/redisDedupeCache.js';
import { orderStore as memoryOrderStore } from './orderStore.js';
import { createRedisOrderStore } from './redisOrderStore.js';
import { createRedisSessionStore } from './redisSessionStore.js';
import { sessionStore as memorySessionStore } from './sessionStore.js';

// Never Redis under `node --test` (it sets NODE_TEST_CONTEXT): production credentials exported
// in a shell must not let the test suite write to the real database. Invalid settings also fall
// back to memory here; startup validation reports them and refuses to serve.
const useRedis = !process.env.NODE_TEST_CONTEXT && invalidStorageVars().length === 0 && getRedisConfig() !== null;

const redis = useRedis
  ? new Redis({ ...getRedisConfig(), automaticDeserialization: false, enableTelemetry: false })
  : null;

export const storageMode = redis ? 'redis' : 'memory';
export const orderStore = redis ? createRedisOrderStore({ redis }) : memoryOrderStore;
export const sessionStore = redis ? createRedisSessionStore({ redis }) : memorySessionStore;
export const dedupeCache = redis ? createRedisDedupeCache({ redis }) : createDedupeCache();
