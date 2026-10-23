// Postback / quick-reply payload strings shared by the Send API builders (which put them on
// buttons) and the conversation engine (which reads them back). Payloads are stable,
// absolute and idempotent: "CATALOG_PAGE:3" always means page 3, so a double tap cannot skip pages.

export const PAYLOAD_TYPES = Object.freeze({
  ORDER_PRODUCT: 'ORDER_PRODUCT', // ORDER_PRODUCT:P001
  CATALOG_PAGE: 'CATALOG_PAGE', // CATALOG_PAGE:2
  CONFIRM_ORDER: 'CONFIRM_ORDER', // CONFIRM_ORDER:<draftId>
  CANCEL_ORDER: 'CANCEL_ORDER',
  MENU: 'MENU',
  GET_STARTED: 'GET_STARTED', // Messenger's optional "Get Started" button
  MY_ORDERS: 'MY_ORDERS',
  SUPPORT: 'SUPPORT',
  QUANTITY: 'QUANTITY', // QUANTITY:2
  USE_SAVED_DETAILS: 'USE_SAVED_DETAILS', // reuse the phone and address of the last order
  NEW_DETAILS: 'NEW_DETAILS',
  USE_SAVED_PHONE: 'USE_SAVED_PHONE', // reuse only the phone of the last order
  USE_SAVED_ADDRESS: 'USE_SAVED_ADDRESS', // reuse only the address of the last order
});

export const orderProductPayload = (productId) => `${PAYLOAD_TYPES.ORDER_PRODUCT}:${productId}`;
export const catalogPagePayload = (page) => `${PAYLOAD_TYPES.CATALOG_PAGE}:${page}`;
export const confirmOrderPayload = (draftId) => `${PAYLOAD_TYPES.CONFIRM_ORDER}:${draftId}`;
export const quantityPayload = (quantity) => `${PAYLOAD_TYPES.QUANTITY}:${quantity}`;
export const CANCEL_ORDER_PAYLOAD = PAYLOAD_TYPES.CANCEL_ORDER;
export const MENU_PAYLOAD = PAYLOAD_TYPES.MENU;
export const MY_ORDERS_PAYLOAD = PAYLOAD_TYPES.MY_ORDERS;
export const SUPPORT_PAYLOAD = PAYLOAD_TYPES.SUPPORT;
export const USE_SAVED_DETAILS_PAYLOAD = PAYLOAD_TYPES.USE_SAVED_DETAILS;
export const NEW_DETAILS_PAYLOAD = PAYLOAD_TYPES.NEW_DETAILS;
export const USE_SAVED_PHONE_PAYLOAD = PAYLOAD_TYPES.USE_SAVED_PHONE;
export const USE_SAVED_ADDRESS_PAYLOAD = PAYLOAD_TYPES.USE_SAVED_ADDRESS;

const MAX_PAYLOAD_LENGTH = 200;

// "ORDER_PRODUCT:P001" -> { type: 'ORDER_PRODUCT', arg: 'P001' }; "MENU" -> { type: 'MENU', arg: null }.
// Returns null for anything that is not one of our payload types.
export function parsePayload(payload) {
  if (typeof payload !== 'string') return null;
  const value = payload.trim();
  if (value === '' || value.length > MAX_PAYLOAD_LENGTH) return null;

  const separator = value.indexOf(':');
  const type = separator === -1 ? value : value.slice(0, separator);
  const arg = separator === -1 ? null : value.slice(separator + 1);
  if (!Object.hasOwn(PAYLOAD_TYPES, type)) return null;
  return { type, arg };
}

// A product link for a Facebook post: https://m.me/<page>?ref=ORDER_PRODUCT:P001. Messenger hands
// the ref back when the customer opens the chat through the link. Anyone can edit a link, so only
// a product choice is read from a ref: the ORDER_PRODUCT payload for it, or null for anything else.
export function referralPayload(ref) {
  const parsed = parsePayload(ref);
  if (parsed?.type !== PAYLOAD_TYPES.ORDER_PRODUCT || !parsed.arg) return null;
  return orderProductPayload(parsed.arg);
}
