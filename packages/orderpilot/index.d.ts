// Types for the orderpilot package. The runtime is plain JavaScript in src/.

import type { IncomingMessage, ServerResponse } from 'node:http';

export type Language = 'bn' | 'en';
export type OrderStatus = 'pending' | 'confirmed' | 'cancelled';

export interface Product {
  /** What customers type and product links carry, e.g. "P001". Case-insensitive. */
  id: string;
  name: string;
  /** Whole currency units, a positive integer (৳1250 is 1250). */
  price: number;
  /** A public https:// image. */
  imageUrl?: string;
  description?: string;
  category?: string;
  /** Default "BDT". */
  currency?: string;
  /** false hides the product. Default true. */
  available?: boolean;
}

export interface Order {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  currency: string;
  customerPsid: string;
  phone: string;
  address: string;
  status: OrderStatus;
  /** ISO 8601. */
  createdAt: string;
}

export type NewOrder = Omit<Order, 'id' | 'subtotal' | 'status' | 'createdAt'>;

type MaybePromise<T> = T | Promise<T>;

/** What the bot needs from an order store. The built-in stores also have list() and updateStatus(). */
export interface OrderStoreAdapter {
  create(data: NewOrder, options?: { idempotencyKey?: string }): MaybePromise<{ order: Order; created: boolean }>;
  get(id: string): MaybePromise<Order | null>;
  listByCustomer(customerPsid: string, options?: { limit?: number }): MaybePromise<Order[]>;
  findByIdempotencyKey(key: string): MaybePromise<Order | null>;
}

export interface OrderStore extends OrderStoreAdapter {
  list(options?: { status?: OrderStatus }): MaybePromise<Order[]>;
  updateStatus(id: string, status: OrderStatus): MaybePromise<Order | null>;
  size(): MaybePromise<number>;
}

export interface Session {
  step: string;
  productId: string | null;
  page: number;
  quantity: number | null;
  phone: string | null;
  address: string | null;
  draftId: string | null;
  expired: boolean;
  updatedAt: number | null;
}

export interface SessionStoreAdapter {
  get(key: string): MaybePromise<Session>;
  update(key: string, patch: Partial<Session>): MaybePromise<Session>;
  reset(key: string): MaybePromise<Session>;
}

export interface PreferenceStoreAdapter {
  getLanguage(key: string): MaybePromise<Language | null>;
  setLanguage(key: string, language: Language): MaybePromise<Language>;
}

export interface DedupeAdapter {
  /** true the first time a key is seen, false while it is remembered. */
  markIfNew(key: string): MaybePromise<boolean>;
}

/** The @upstash/redis commands the Redis stores use. */
export interface RedisClient {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options?: { nx?: boolean; xx?: boolean; px?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  mget(...keys: string[]): Promise<unknown[]>;
  zadd(key: string, member: { score: number; member: string }): Promise<unknown>;
  zrange(key: string, start: number, stop: number, options?: { rev?: boolean }): Promise<unknown[]>;
  zcard(key: string): Promise<number>;
}

export interface OrderPilotOptions {
  /** PAGE_ACCESS_TOKEN when left out. */
  pageAccessToken?: string;
  /** FACEBOOK_PAGE_ID when left out. */
  pageId?: string | number;
  /** META_APP_SECRET when left out. */
  appSecret?: string;
  /** META_VERIFY_TOKEN when left out. */
  verifyToken?: string;
  /** META_GRAPH_API_VERSION when left out; default v26.0. */
  graphApiVersion?: string;
  /** FACEBOOK_APP_ID when left out. Only connect() uses it. */
  appId?: string | number;
  /** WEBHOOK_URL when left out. The public https:// webhook URL, for connect(). */
  webhookUrl?: string;
  /** SHOP_NAME when left out. */
  shopName?: string;
  /** DETECT_LANGUAGE (on unless "false") when left out. */
  detectLanguage?: boolean | (() => boolean);
  /** Default true. */
  autoReply?: boolean | (() => boolean);
  /** The whole product list, or a function returning it. For a large catalog use `catalog` instead. */
  products?: Product[] | (() => MaybePromise<Product[]>);
  /** Paged queries over your own database: the bot asks for one page or one product at a time. */
  catalog?: CatalogAdapter;
  onOrder?: (order: Order) => unknown;
  redis?: RedisClient | null;
  /** Default "orderpilot:". */
  redisPrefix?: string;
  orders?: OrderStoreAdapter;
  sessions?: SessionStoreAdapter;
  preferences?: PreferenceStoreAdapter;
  dedupe?: DedupeAdapter;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export interface ConnectStep {
  step: 'app_webhook' | 'page_subscription' | 'get_started';
  ok: boolean;
  skipped?: boolean;
  missing?: string[];
  reason?: string;
  hint?: string | null;
  code?: number | null;
}

/** A large catalog in your own database. Both methods may be async. */
export interface CatalogAdapter {
  /** One product, available or not, or null. Gets the id as given, then in upper case. */
  getProduct(id: string): MaybePromise<Product | null>;
  /** One page of the products customers may order, and how many there are in all. */
  listProducts(query: { page: number; limit: number; offset: number }): MaybePromise<{ items: Product[]; total: number }>;
}

export interface Catalog {
  getProductById(id: string): Promise<Product | null>;
  getCatalogPage(
    page: number,
    pageSize?: number,
  ): Promise<{ items: Product[]; page: number; totalPages: number; hasPrev: boolean; hasNext: boolean }>;
}

export interface OrderPilot {
  /** Express / Connect / node:http handler. Mount it before any JSON body parser. */
  webhook(req: IncomingMessage, res: ServerResponse, next?: (error?: unknown) => void): Promise<void>;
  /** Request -> Response handler (Next.js route handlers, Hono, Bun, Deno, Workers). */
  fetchHandler(request: Request, context?: { waitUntil?: (promise: Promise<unknown>) => void }): Promise<Response>;
  /** The framework-free core. */
  handleWebhook(request: {
    method: string;
    query?: URLSearchParams | string;
    headers?: Headers | Record<string, string | string[] | undefined>;
    body?: Buffer;
  }): { status: number; body: string; work?: Promise<void> };
  /** Answers already verified webhook entries. */
  processEntries(entries: unknown[]): Promise<void>;
  connect(options?: { getStarted?: boolean }): Promise<{ ok: boolean; steps: ConnectStep[] }>;
  /** Missing or malformed settings, e.g. ["pageAccessToken (PAGE_ACCESS_TOKEN)"]. The Page token and ID count only while autoReply is on. */
  checkConfig(): string[];
  storage: 'memory' | 'redis' | 'custom';
  orders: OrderStore;
  sessions: SessionStoreAdapter;
  preferences: PreferenceStoreAdapter;
  catalog: Catalog;
  close(): void;
}

export function createOrderPilot(options?: OrderPilotOptions): OrderPilot;
export function createCatalog(products?: OrderPilotOptions['products']): Catalog;
export function createPagedCatalog(adapter: CatalogAdapter): Catalog;
export function createOrderStore(): OrderStore;
export function createRedisOrderStore(options: { redis: RedisClient; prefix?: string }): OrderStore;
export function productLink(pageUsername: string, productId: string): string;
export function conversationKey(pageId: string, psid: string): string;
/** Every customer-facing text of a language, with the shop's name in the welcome. */
export function textsFor(language: Language | string, shopName?: string): Record<string, any>;
/** The quick-reply buttons of a language. */
export function quickRepliesFor(language: Language | string): Record<string, any>;

export const ORDER_STATUSES: readonly OrderStatus[];
export const STEPS: Readonly<Record<string, string>>;
export const LANGUAGES: readonly Language[];
export const DEFAULT_LANGUAGE: Language;
export const DEFAULT_GRAPH_API_VERSION: string;
export const ENV_NAMES: Readonly<Record<string, string>>;
export const CATALOG_PAGE_SIZE: number;
export const WEBHOOK_FIELDS: readonly string[];

export const PAYLOAD_TYPES: Readonly<Record<string, string>>;
export const CANCEL_ORDER_PAYLOAD: string;
export const GET_STARTED_PAYLOAD: string;
export const MENU_PAYLOAD: string;
export const MY_ORDERS_PAYLOAD: string;
export const NEW_DETAILS_PAYLOAD: string;
export const SUPPORT_PAYLOAD: string;
export const USE_SAVED_ADDRESS_PAYLOAD: string;
export const USE_SAVED_DETAILS_PAYLOAD: string;
export const USE_SAVED_PHONE_PAYLOAD: string;
export function catalogPagePayload(page: number): string;
export function confirmOrderPayload(draftId: string): string;
export function languagePayload(language: Language): string;
export function orderProductPayload(productId: string): string;
export function quantityPayload(quantity: number): string;
