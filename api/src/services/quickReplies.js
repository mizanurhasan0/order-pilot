import {
  CANCEL_ORDER_PAYLOAD,
  MENU_PAYLOAD,
  MY_ORDERS_PAYLOAD,
  NEW_DETAILS_PAYLOAD,
  SUPPORT_PAYLOAD,
  USE_SAVED_ADDRESS_PAYLOAD,
  USE_SAVED_DETAILS_PAYLOAD,
  USE_SAVED_PHONE_PAYLOAD,
  catalogPagePayload,
  quantityPayload,
} from './payloads.js';
import { BUTTONS, savedPhoneButton } from './replyTexts.js';

// The quick-reply buttons under the bot's text replies, so every step of the order can be
// answered with a tap. A tap arrives as an ordinary message carrying the payload (no postback
// subscription needed); typing still works everywhere. Messenger shows them under the latest
// message only, so an old set disappears once the conversation moves on.
//
// Item = { title, payload } | { type: 'user_phone_number' } (Messenger fills in the phone
// number from the customer's Facebook profile, and hides the button when there is none).

const cancel = { title: BUTTONS.cancel, payload: CANCEL_ORDER_PAYLOAD };

export const MENU = Object.freeze([
  { title: BUTTONS.products, payload: catalogPagePayload(1) },
  { title: BUTTONS.myOrders, payload: MY_ORDERS_PAYLOAD },
  { title: BUTTONS.support, payload: SUPPORT_PAYLOAD },
]);

export const AFTER_ORDER = Object.freeze([
  { title: BUTTONS.shopMore, payload: catalogPagePayload(1) },
  { title: BUTTONS.myOrders, payload: MY_ORDERS_PAYLOAD },
  { title: BUTTONS.menu, payload: MENU_PAYLOAD },
]);

export const QUANTITY = Object.freeze([
  ...[1, 2, 3, 4, 5].map((quantity) => ({ title: String(quantity), payload: quantityPayload(quantity) })),
  cancel,
]);

export const SAVED_DETAILS = Object.freeze([
  { title: BUTTONS.useSaved, payload: USE_SAVED_DETAILS_PAYLOAD },
  { title: BUTTONS.newDetails, payload: NEW_DETAILS_PAYLOAD },
  cancel,
]);

// The phone and address questions offer the values of the customer's last order, when there
// are any, so a returning customer can keep one and change the other.
export const phone = (previousPhone) =>
  Object.freeze([
    { type: 'user_phone_number' },
    ...(previousPhone ? [{ title: savedPhoneButton(previousPhone), payload: USE_SAVED_PHONE_PAYLOAD }] : []),
    cancel,
  ]);

export const address = (previousAddress) =>
  Object.freeze([...(previousAddress ? [{ title: BUTTONS.savedAddress, payload: USE_SAVED_ADDRESS_PAYLOAD }] : []), cancel]);
