import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as texts from '../src/services/replyTexts.js';

// The expected strings below are written out by hand on purpose: they are the wording the
// shop owner approved, so a change to replyTexts.js must show up as a failing test.

const MENU_OPTIONS = `1. 🛍️ পণ্য দেখুন
2. 📦 আমার অর্ডারের তথ্য
3. 👨‍💼 সহায়তা`;

test('WELCOME is the approved menu text', () => {
  assert.equal(
    texts.WELCOME,
    `স্বাগতম! 🛍️

Tangail Botiques-এ আপনাকে স্বাগতম।

আমাদের পণ্য দেখতে অথবা অর্ডার করতে নিচের অপশন নির্বাচন করুন।

${MENU_OPTIONS}`,
  );
});

test('SUPPORT, FALLBACK and ATTACHMENT are the approved texts', () => {
  assert.equal(
    texts.SUPPORT,
    `👨‍💼 সহায়তা

আমাদের টিম শিগগিরই আপনার মেসেজের উত্তর দেবে।`,
  );
  assert.equal(
    texts.FALLBACK,
    `দুঃখিত, আপনার মেসেজটি বুঝতে পারিনি।

${MENU_OPTIONS}

নিচের বাটনে চাপুন, অথবা 1, 2 বা 3 লিখুন।`,
  );
  assert.equal(
    texts.ATTACHMENT,
    `দুঃখিত, আমি এখন শুধু টেক্সট মেসেজ বুঝতে পারি।

নিচের বাটনে চাপুন, অথবা 1, 2 বা 3 লিখুন।`,
  );
});

test('orderStart asks for the quantity', () => {
  assert.equal(
    texts.orderStart({ id: 'P001', name: 'Premium Cotton Saree', price: 1250 }),
    `আপনি নির্বাচন করেছেন:

Premium Cotton Saree
দাম: ৳1250

কয়টি পিস অর্ডার করবেন?
নিচের বাটনে চাপুন, অথবা 1 থেকে 100 লিখুন।

বাতিল করতে ❌ বাতিল চাপুন, অথবা "বাতিল" লিখুন।`,
  );
});

test('prompts for the quantity, phone and address steps', () => {
  assert.equal(texts.QUANTITY_INVALID, 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 থেকে 100-এর মধ্যে একটি সংখ্যা লিখুন।');
  assert.equal(
    texts.askPhone(null),
    '📱 আপনার মোবাইল নম্বর দিন।\nনিচে আপনার নম্বরের বাটন থাকলে চাপুন, অথবা লিখুন। যেমন: 017XXXXXXXX',
  );
  assert.ok(texts.PHONE_INVALID.includes('017XXXXXXXX, +88017XXXXXXXX, 88017XXXXXXXX'));
  assert.equal(texts.askAddress(null), '🏠 আপনার সম্পূর্ণ ডেলিভারি ঠিকানা লিখুন।\nযেমন: বাসা 12, রোড 3, টাঙ্গাইল সদর, টাঙ্গাইল');
  assert.ok(texts.ADDRESS_INVALID.includes('10 থেকে 200'));
  assert.equal(texts.CONFIRM_INVALID, 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 (নিশ্চিত) / 2 (বাতিল) লিখুন।');
});

test('the phone and address questions mention the previous number and address', () => {
  assert.equal(
    texts.askPhone('01712345678'),
    `📱 আপনার মোবাইল নম্বর দিন।
আগের নম্বরটি (01712345678) দিতে নিচের 📱 বাটনে চাপুন।
নিচে আপনার নম্বরের বাটন থাকলে চাপুন, অথবা লিখুন। যেমন: 017XXXXXXXX`,
  );
  assert.equal(
    texts.askAddress('House 12, Road 3, Tangail Sadar'),
    `🏠 আপনার সম্পূর্ণ ডেলিভারি ঠিকানা লিখুন।
যেমন: বাসা 12, রোড 3, টাঙ্গাইল সদর, টাঙ্গাইল

আগের ঠিকানা: House 12, Road 3, Tangail Sadar
একই ঠিকানায় নিতে নিচের 🏠 আগের ঠিকানা বাটনে চাপুন।`,
  );
  assert.equal(texts.savedPhoneButton('01712345678'), '📱 01712345678');
  assert.ok(Array.from(texts.savedPhoneButton('01712345678')).length <= 20);
});

test('a resumed question starts with the order-in-progress note', () => {
  assert.equal(
    texts.ORDER_IN_PROGRESS,
    '⏳ আপনার অর্ডারটি এখনো চলছে। নিচের প্রশ্নের উত্তর দিন, অথবা নতুন করে শুরু করতে ❌ বাতিল চাপুন।',
  );
  assert.equal(texts.ATTACHMENT_IN_ORDER, `দুঃখিত, ছবি বা স্টিকার বুঝতে পারি না।\n${texts.ORDER_IN_PROGRESS}`);
  assert.equal(texts.resumed('note', 'question'), 'note\n\nquestion');
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

পণ্য: Premium Cotton Saree
পরিমাণ: 2
একক দাম: ৳1250
মোট দাম: ৳2500
মোবাইল: 01712345678
ঠিকানা: House 12, Road 3, Tangail

ডেলিভারি চার্জ: এখনো যোগ করা হয়নি

অর্ডারটি নিশ্চিত করবেন?

1. ✅ নিশ্চিত করুন
2. ❌ বাতিল করুন`,
  );
});

test('orderConfirmed is the approved confirmation text', () => {
  assert.equal(
    texts.orderConfirmed({ id: 'ORD-1001', subtotal: 2500 }),
    `✅ আপনার অর্ডার নিশ্চিত হয়েছে!

অর্ডার আইডি: ORD-1001
মোট: ৳2500
ডেলিভারি চার্জ: এখনো যোগ করা হয়নি

আমাদের টিম শিগগিরই আপনার সাথে যোগাযোগ করবে।

মেনু দেখতে "মেনু" লিখুন।`,
  );
});

test('orderDuplicate shows the order id when it is known', () => {
  assert.equal(
    texts.orderDuplicate({ id: 'ORD-1001' }),
    'এই অর্ডারটি ইতিমধ্যে নিশ্চিত করা হয়েছে।\nঅর্ডার আইডি: ORD-1001',
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
  const text = texts.orderInfo([
    order,
    { ...order, id: 'ORD-1001', status: 'confirmed' },
    { ...order, id: 'ORD-1000', status: 'cancelled' },
  ]);
  assert.equal(
    text,
    `📦 আপনার সাম্প্রতিক অর্ডার:

ORD-1002 – Classic Cotton Panjabi × 3 – ৳4950 – অপেক্ষমাণ
ORD-1001 – Classic Cotton Panjabi × 3 – ৳4950 – নিশ্চিত
ORD-1000 – Classic Cotton Panjabi × 3 – ৳4950 – বাতিল`,
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
🛒 অর্ডার করতে নিচে পণ্যের কোডে চাপ দিন (কোডটি ছবির নিচে নামের শুরুতে আছে)।
পৃষ্ঠা বদলাতে "পরের" বা "আগের" লিখুন, মেনুর জন্য "মেনু"।`,
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
পৃষ্ঠা বদলাতে "পরের" বা "আগের" লিখুন, মেনুর জন্য "মেনু"।`,
  );
});

test('every text mentions how to continue (a number, মেনু, পরের or আগের)', () => {
  const edge = [texts.CATALOG_EDGE_FIRST, texts.CATALOG_EDGE_LAST, texts.PRODUCT_NOT_FOUND, texts.CONFIRM_STALE];
  for (const text of edge) {
    assert.ok(/মেনু|পরের|আগের|\b1\b/.test(text), text);
  }
  assert.ok(texts.CATALOG_EDGE_FIRST.includes('"পরের"'));
  assert.ok(texts.CATALOG_EDGE_LAST.includes('"আগের"'));
});

test('savedDetails offers the last phone and address with the two choices', () => {
  assert.equal(
    texts.savedDetails({ phone: '01712345678', address: 'House 12, Road 3, Tangail Sadar' }),
    `আগের অর্ডারের তথ্য:

মোবাইল: 01712345678
ঠিকানা: House 12, Road 3, Tangail Sadar

এই নম্বর আর ঠিকানায় ডেলিভারি দেব?

1. ✅ হ্যাঁ, এই তথ্য
2. ✏️ নতুন তথ্য দেব

শুধু নম্বর বা শুধু ঠিকানা বদলাতে চাইলেও 2 বেছে নিন, পরের ধাপে আগেরটি রাখার বাটন পাবেন।`,
  );
  assert.equal(texts.SAVED_DETAILS_INVALID, 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 (এই তথ্য) / 2 (নতুন তথ্য) লিখুন।');
  assert.equal(texts.BUTTON_STALE, 'এই বাটনটি আর কাজ করছে না।\n\nনিচের মেনু থেকে আবার শুরু করুন।');
});

test('customer texts carry no leftover English labels', () => {
  const sample = [
    texts.WELCOME,
    texts.SUPPORT,
    texts.orderStart({ name: 'X', price: 1 }),
    texts.savedDetails({ phone: '01712345678', address: 'Somewhere 12345' }),
    texts.orderSummary({ name: 'X', quantity: 1, unitPrice: 1, subtotal: 1, phone: 'p', address: 'a' }),
    texts.orderConfirmed({ id: 'ORD-1', subtotal: 1 }),
    texts.CONFIRM_INVALID,
    ...Object.values(texts.BUTTONS),
  ].join('\n');
  for (const word of ['Price', 'Phone', 'Address', 'Quantity', 'Subtotal', 'Confirm', 'Cancel', 'Order ID', 'Menu', 'Support']) {
    assert.ok(!sample.includes(word), word);
  }
});

test('every quick-reply label fits Messenger’s 20 characters, so none is cut', () => {
  assert.ok(Object.isFrozen(texts.BUTTONS));
  for (const label of Object.values(texts.BUTTONS)) {
    assert.ok(Array.from(label).length <= 20, label);
  }
});

test('formatPrice writes the taka sign without separators', () => {
  assert.equal(texts.formatPrice(1250), '৳1250');
  assert.equal(texts.formatPrice(420), '৳420');
});

// --- English ---------------------------------------------------------------------------------

const en = texts.textsFor('en');

test('textsFor gives the Bangla set by default and for unknown languages', () => {
  assert.equal(texts.textsFor('bn').WELCOME, texts.WELCOME);
  assert.equal(texts.textsFor(undefined), texts.textsFor('bn'));
  assert.equal(texts.textsFor('fr'), texts.textsFor('bn'));
});

test('both languages have exactly the same texts and buttons', () => {
  const bn = texts.textsFor('bn');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(bn).sort());
  assert.deepEqual(Object.keys(en.BUTTONS).sort(), Object.keys(bn.BUTTONS).sort());
  for (const label of Object.values(en.BUTTONS)) assert.ok(Array.from(label).length <= 20, label);
  assert.equal(bn.BUTTONS.otherLanguage, '🌐 English');
  assert.equal(en.BUTTONS.otherLanguage, '🌐 বাংলা');
});

test('the English welcome, summary and confirmation are the approved texts', () => {
  assert.equal(
    en.WELCOME,
    `Welcome! 🛍️

Welcome to Tangail Botiques.

Choose an option below to see our products or place an order.

1. 🛍️ View Products
2. 📦 My Orders
3. 👨‍💼 Support`,
  );
  assert.equal(
    en.orderSummary({
      name: 'Premium Cotton Saree',
      quantity: 2,
      unitPrice: 1250,
      subtotal: 2500,
      phone: '01712345678',
      address: 'House 12, Road 3, Tangail',
    }),
    `🛍️ Your order:

Product: Premium Cotton Saree
Quantity: 2
Unit price: ৳1250
Total: ৳2500
Mobile: 01712345678
Address: House 12, Road 3, Tangail

Delivery charge: not added yet

Shall we confirm this order?

1. ✅ Confirm
2. ❌ Cancel`,
  );
  assert.equal(
    en.orderConfirmed({ id: 'ORD-1001', subtotal: 2500 }),
    `✅ Your order is confirmed!

Order ID: ORD-1001
Total: ৳2500
Delivery charge: not added yet

Our team will contact you soon.

Type "menu" to see the menu.`,
  );
  assert.equal(en.LANGUAGE_CHANGED, '✅ Language changed to English.');
  assert.equal(texts.LANGUAGE_CHANGED, '✅ ভাষা বাংলা করা হয়েছে।');
});

test('the English set has no Bangla left in it, apart from the button back to Bangla', () => {
  const product = { id: 'P001', name: 'Saree', price: 1 };
  const order = { id: 'ORD-1', productName: 'Saree', quantity: 1, subtotal: 1, status: 'pending' };
  const sample = [
    ...Object.values(en).filter((value) => typeof value === 'string'),
    ...Object.entries(en.BUTTONS).filter(([name]) => name !== 'otherLanguage').map(([, label]) => label),
    en.catalogNav({ page: 1, totalPages: 2 }),
    en.catalogFallback([product], 1, 2),
    en.orderStart(product),
    en.askPhone('01712345678'),
    en.askAddress('House 12, Road 3'),
    en.savedDetails({ phone: '01712345678', address: 'House 12, Road 3' }),
    en.orderSummary({ name: 'Saree', quantity: 1, unitPrice: 1, subtotal: 1, phone: 'p', address: 'a' }),
    en.orderConfirmed(order),
    en.orderDuplicate(order),
    en.orderInfo([order]),
    en.orderInfo([]),
  ].join('\n');
  // The Bangla Unicode block, without the taka sign ৳ (U+09F3) that prices use in both languages.
  assert.ok(!/[ঀ-৲৴-৿]/.test(sample), 'Bangla characters in the English texts');
});
