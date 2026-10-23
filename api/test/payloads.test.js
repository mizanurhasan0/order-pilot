import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderProductPayload, referralPayload } from '../src/services/payloads.js';

test('referralPayload reads the product of an m.me product link', () => {
  assert.equal(referralPayload('ORDER_PRODUCT:P001'), orderProductPayload('P001'));
  assert.equal(referralPayload(' ORDER_PRODUCT:P042 '), orderProductPayload('P042'));
});

test('referralPayload ignores every ref that is not a product choice', () => {
  const refs = [
    undefined,
    null,
    42,
    {},
    '',
    'summer_sale',
    'order_product:P001',
    'ORDER_PRODUCT',
    'ORDER_PRODUCT:',
    'MENU',
    'GET_STARTED',
    'CANCEL_ORDER',
    'CONFIRM_ORDER:abc123',
    'QUANTITY:2',
    `ORDER_PRODUCT:${'P'.repeat(300)}`,
  ];
  for (const ref of refs) assert.equal(referralPayload(ref), null, JSON.stringify(ref));
});
