import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as texts from '../src/services/replyTexts.js';

// The expected strings below are written out by hand on purpose: they are the wording the
// shop owner approved, so a change to replyTexts.js must show up as a failing test.

test('WELCOME is the approved menu text', () => {
  assert.equal(
    texts.WELCOME,
    `স্বাগতম! 🛍️

Tangail Botiques-এ আপনাকে স্বাগতম।

আমাদের পণ্য দেখতে অথবা অর্ডার করতে নিচের অপশন নির্বাচন করুন।

1. 🛍️ View Products
2. 📦 My Order Information
3. 👨‍💼 Contact Support`,
  );
});

test('SUPPORT, FALLBACK and ATTACHMENT are the approved texts', () => {
  assert.equal(
    texts.SUPPORT,
    `👨‍💼 Contact Support

আমাদের টিম আপনার মেসেজের উত্তর দেবে।`,
  );
  assert.equal(
    texts.FALLBACK,
    `দুঃখিত, আপনার মেসেজটি বুঝতে পারিনি।

1. 🛍️ View Products
2. 📦 My Order Information
3. 👨‍💼 Contact Support

অনুগ্রহ করে 1, 2 অথবা 3 লিখুন।`,
  );
  assert.equal(
    texts.ATTACHMENT,
    `দুঃখিত, আমি এখন শুধু টেক্সট মেসেজ বুঝতে পারি।

অনুগ্রহ করে 1, 2 অথবা 3 লিখুন।`,
  );
});

test('orderStart asks for the quantity', () => {
  assert.equal(
    texts.orderStart({ id: 'P001', name: 'Premium Cotton Saree', price: 1250 }),
    `আপনি নির্বাচন করেছেন:

Premium Cotton Saree
Price: ৳1250

কয়টি পিস অর্ডার করবেন?
(1 থেকে 100)

বাতিল করতে cancel লিখুন।`,
  );
});

test('prompts for the quantity, phone and address steps', () => {
  assert.equal(texts.QUANTITY_INVALID, 'অনুগ্রহ করে 1 থেকে 100-এর মধ্যে একটি সংখ্যা লিখুন।');
  assert.equal(texts.ASK_PHONE, 'আপনার মোবাইল নম্বর দিন।\nযেমন: 017XXXXXXXX');
  assert.ok(texts.PHONE_INVALID.includes('017XXXXXXXX, +88017XXXXXXXX, 88017XXXXXXXX'));
  assert.equal(texts.ASK_ADDRESS, 'আপনার সম্পূর্ণ ডেলিভারি ঠিকানা দিন।');
  assert.ok(texts.ADDRESS_INVALID.includes('10 থেকে 200'));
  assert.equal(texts.CONFIRM_INVALID, 'অনুগ্রহ করে 1 (Confirm) অথবা 2 (Cancel) লিখুন।');
});

test('orderSummary is the approved summary text', () => {
  const summary = texts.orderSummary({
    name: 'Premium Cotton Saree',
    quantity: 2,
    unitPrice: 1250,
    subtotal: 2500,
    phone: '01712345678',
    address: 'House 12, Road 3, Tangail',
  });
  assert.equal(
    summary,
    `🛍️ আপনার অর্ডার:

Product: Premium Cotton Saree
Quantity: 2
Unit Price: ৳1250
Subtotal: ৳2500
Phone: 01712345678
Address: House 12, Road 3, Tangail

Delivery charge: Not calculated

অর্ডারটি নিশ্চিত করবেন?

1. Confirm
2. Cancel`,
  );
});

test('orderConfirmed is the approved confirmation text', () => {
  assert.equal(
    texts.orderConfirmed({ id: 'ORD-1001', subtotal: 2500 }),
    `✅ আপনার অর্ডার নিশ্চিত হয়েছে!

Order ID: ORD-1001
Total: ৳2500
Delivery charge: Not calculated

আমাদের টিম শিগগিরই আপনার সাথে যোগাযোগ করবে।

মেনু দেখতে menu লিখুন।`,
  );
});

test('orderDuplicate shows the order id when it is known', () => {
  assert.equal(
    texts.orderDuplicate({ id: 'ORD-1001' }),
    'এই অর্ডারটি ইতিমধ্যে নিশ্চিত করা হয়েছে।\nOrder ID: ORD-1001',
  );
  assert.equal(texts.orderDuplicate(), 'এই অর্ডারটি ইতিমধ্যে নিশ্চিত করা হয়েছে।');
});

test('ORDER_CANCELLED and SESSION_EXPIRED end with the welcome menu', () => {
  assert.equal(texts.ORDER_CANCELLED, `❌ অর্ডার বাতিল করা হয়েছে।\n\n${texts.WELCOME}`);
  assert.ok(texts.SESSION_EXPIRED.endsWith(`\n\n${texts.WELCOME}`));
  assert.ok(texts.ORDER_PRODUCT_UNAVAILABLE.endsWith(`\n\n${texts.WELCOME}`));
});

test('orderInfo lists orders without phone or address, or says there are none', () => {
  const order = {
    id: 'ORD-1002',
    productName: 'Classic Cotton Panjabi',
    quantity: 3,
    subtotal: 4950,
    status: 'pending',
    phone: '01712345678',
    address: 'House 12, Road 3, Tangail',
  };
  const text = texts.orderInfo([order, { ...order, id: 'ORD-1001', status: 'confirmed' }]);
  assert.equal(
    text,
    `📦 আপনার সাম্প্রতিক অর্ডার:

ORD-1002 – Classic Cotton Panjabi × 3 – ৳4950 – pending
ORD-1001 – Classic Cotton Panjabi × 3 – ৳4950 – confirmed`,
  );
  assert.ok(!text.includes('01712345678'));
  assert.ok(!text.includes('Tangail'));

  const none = `আপনার কোনো অর্ডার পাওয়া যায়নি।

পণ্য দেখতে 1 লিখুন।`;
  assert.equal(texts.orderInfo([]), none);
  assert.equal(texts.orderInfo(undefined), none);
});

test('catalogNav and catalogFallback follow the approved wording', () => {
  assert.equal(
    texts.catalogNav({ page: 2, totalPages: 10 }),
    `🛍️ পণ্য তালিকা – পৃষ্ঠা 2/10
অর্ডার করতে পণ্যের নিচের "Order Now" বাটনে চাপ দিন।
next / previous / menu / cancel লিখেও যেতে পারেন।`,
  );

  const products = [
    { id: 'P006', name: 'Formal Full Sleeve Shirt', price: 1150 },
    { id: 'P007', name: 'Soft Georgette Hijab', price: 420 },
  ];
  assert.equal(
    texts.catalogFallback(products, 2, 10),
    `🛍️ পণ্য তালিকা – পৃষ্ঠা 2/10

P006 – Formal Full Sleeve Shirt – ৳1150
P007 – Soft Georgette Hijab – ৳420

অর্ডার করতে পণ্যের কোড লিখুন (যেমন: P001)।
next / previous / menu / cancel লিখেও যেতে পারেন।`,
  );
});

test('every text mentions how to continue (a number, menu, next or previous)', () => {
  const edge = [texts.CATALOG_EDGE_FIRST, texts.CATALOG_EDGE_LAST, texts.PRODUCT_NOT_FOUND, texts.CONFIRM_STALE];
  for (const text of edge) {
    assert.ok(/menu|next|previous|\b1\b/.test(text), text);
  }
  assert.ok(texts.CATALOG_EDGE_FIRST.includes('next'));
  assert.ok(texts.CATALOG_EDGE_LAST.includes('previous'));
});

test('formatPrice writes the taka sign without separators', () => {
  assert.equal(texts.formatPrice(1250), '৳1250');
  assert.equal(texts.formatPrice(420), '৳420');
});
