// Every customer-facing string of the order flow lives here, so wording can be reviewed
// and changed in one place. The conversation engine only picks which text to send.
//
// The bot speaks Bangla (the default) or English (services/language.js); textsFor(language)
// returns one complete set. Both sets have exactly the same keys. Product names, prices and
// order ids are shown as they are stored. The named exports below are the Bangla set.

import { DEFAULT_LANGUAGE } from './language.js';

const lines = (list) => list.join('\n');

export const formatPrice = (amount) => `৳${amount}`;

// The button that reuses the number of the customer's last order (the same in both languages).
export const savedPhoneButton = (phone) => `📱 ${phone}`;

// A note on top, then the question it repeats.
export const resumed = (note, question) => lines([note, '', question]);

function bangla() {
  // Quick-reply labels (Messenger cuts them at 20 characters).
  const BUTTONS = Object.freeze({
    products: '🛍️ পণ্য দেখুন',
    myOrders: '📦 আমার অর্ডার',
    support: '👨‍💼 সহায়তা',
    shopMore: '🛍️ আরও কিনুন',
    menu: '🏠 মেনু',
    cancel: '❌ বাতিল',
    useSaved: '✅ হ্যাঁ, এই তথ্য',
    newDetails: '✏️ নতুন তথ্য দেব',
    savedAddress: '🏠 আগের ঠিকানা',
    otherLanguage: '🌐 English', // switches to the other language
  });

  const MENU_OPTIONS = lines(['1. 🛍️ পণ্য দেখুন', '2. 📦 আমার অর্ডারের তথ্য', '3. 👨‍💼 সহায়তা']);
  const MENU_PROMPT = 'নিচের বাটনে চাপুন, অথবা 1, 2 বা 3 লিখুন।';
  const CANCEL_HINT = 'বাতিল করতে ❌ বাতিল চাপুন, অথবা "বাতিল" লিখুন।';
  const CATALOG_HINT = 'পৃষ্ঠা বদলাতে "পরের" বা "আগের" লিখুন, মেনুর জন্য "মেনু"।';
  const DELIVERY_CHARGE = 'ডেলিভারি চার্জ: এখনো যোগ করা হয়নি';
  const ORDER_STATUS = { pending: 'অপেক্ষমাণ', confirmed: 'নিশ্চিত', cancelled: 'বাতিল' };
  const catalogHeader = (page, totalPages) => `🛍️ পণ্য তালিকা – পৃষ্ঠা ${page}/${totalPages}`;

  const WELCOME = lines([
    'স্বাগতম! 🛍️',
    '',
    'Tangail Botiques-এ আপনাকে স্বাগতম।',
    '',
    'আমাদের পণ্য দেখতে অথবা অর্ডার করতে নিচের অপশন নির্বাচন করুন।',
    '',
    MENU_OPTIONS,
  ]);
  const ORDER_IN_PROGRESS =
    '⏳ আপনার অর্ডারটি এখনো চলছে। নিচের প্রশ্নের উত্তর দিন, অথবা নতুন করে শুরু করতে ❌ বাতিল চাপুন।';
  const LANGUAGE_CHANGED = '✅ ভাষা বাংলা করা হয়েছে।';

  return Object.freeze({
    BUTTONS,
    WELCOME,
    SUPPORT: lines(['👨‍💼 সহায়তা', '', 'আমাদের টিম শিগগিরই আপনার মেসেজের উত্তর দেবে।']),
    FALLBACK: lines(['দুঃখিত, আপনার মেসেজটি বুঝতে পারিনি।', '', MENU_OPTIONS, '', MENU_PROMPT]),
    // Photos, stickers, likes and other non-text messages outside an order.
    ATTACHMENT: lines(['দুঃখিত, আমি এখন শুধু টেক্সট মেসেজ বুঝতে পারি।', '', MENU_PROMPT]),
    SESSION_EXPIRED: lines([
      '⏳ আপনার আগের সেশনের সময় শেষ হয়ে গেছে।',
      '',
      'অনুগ্রহ করে নতুন করে শুরু করুন।',
      '',
      WELCOME,
    ]),

    // In the middle of an order, anything that is not an answer keeps the order and repeats the
    // current question under one of these lines. Only Cancel starts over.
    ORDER_IN_PROGRESS,
    ATTACHMENT_IN_ORDER: lines(['দুঃখিত, ছবি বা স্টিকার বুঝতে পারি না।', ORDER_IN_PROGRESS]),
    LANGUAGE_CHANGED,
    LANGUAGE_CHANGED_IN_ORDER: lines([LANGUAGE_CHANGED, ORDER_IN_PROGRESS]),

    // The short message sent after the product cards (the quick-reply buttons ride on it).
    catalogNav: ({ page, totalPages }) =>
      lines([
        catalogHeader(page, totalPages),
        '🛒 অর্ডার করতে নিচে পণ্যের কোডে চাপ দিন (কোডটি ছবির নিচে নামের শুরুতে আছে)।',
        CATALOG_HINT,
      ]),
    // Plain-text version of the page, used when Messenger rejects the card template.
    catalogFallback: (products, page, totalPages) =>
      lines([
        catalogHeader(page, totalPages),
        '',
        ...products.map((product) => `${product.id} – ${product.name} – ${formatPrice(product.price)}`),
        '',
        'অর্ডার করতে পণ্যের কোড লিখুন (যেমন: P001)।',
        CATALOG_HINT,
      ]),
    CATALOG_EDGE_FIRST: lines(['এটিই প্রথম পৃষ্ঠা।', 'পরের পৃষ্ঠায় যেতে "পরের" লিখুন, অথবা "মেনু" লিখুন।']),
    CATALOG_EDGE_LAST: lines(['এটিই শেষ পৃষ্ঠা।', 'আগের পৃষ্ঠায় যেতে "আগের" লিখুন, অথবা "মেনু" লিখুন।']),
    CATALOG_EMPTY: lines(['দুঃখিত, এই মুহূর্তে কোনো পণ্য পাওয়া যাচ্ছে না।', '', 'মেনু দেখতে "মেনু" লিখুন।']),
    PRODUCT_NOT_FOUND: lines([
      'দুঃখিত, এই পণ্যটি পাওয়া যায়নি অথবা এখন স্টকে নেই।',
      '',
      'পণ্য তালিকা দেখতে 1 লিখুন, অথবা "মেনু" লিখুন।',
    ]),

    orderStart: (product) =>
      lines([
        'আপনি নির্বাচন করেছেন:',
        '',
        product.name,
        `দাম: ${formatPrice(product.price)}`,
        '',
        'কয়টি পিস অর্ডার করবেন?',
        'নিচের বাটনে চাপুন, অথবা 1 থেকে 100 লিখুন।',
        '',
        CANCEL_HINT,
      ]),
    QUANTITY_INVALID: 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 থেকে 100-এর মধ্যে একটি সংখ্যা লিখুন।',
    // `previousPhone`: the number of the customer's last order, offered as a button.
    askPhone: (previousPhone) =>
      lines([
        '📱 আপনার মোবাইল নম্বর দিন।',
        ...(previousPhone ? [`আগের নম্বরটি (${previousPhone}) দিতে নিচের 📱 বাটনে চাপুন।`] : []),
        'নিচে আপনার নম্বরের বাটন থাকলে চাপুন, অথবা লিখুন। যেমন: 017XXXXXXXX',
      ]),
    // A returning customer: the phone and address of their last order, offered for this one.
    savedDetails: ({ phone, address }) =>
      lines([
        'আগের অর্ডারের তথ্য:',
        '',
        `মোবাইল: ${phone}`,
        `ঠিকানা: ${address}`,
        '',
        'এই নম্বর আর ঠিকানায় ডেলিভারি দেব?',
        '',
        '1. ✅ হ্যাঁ, এই তথ্য',
        '2. ✏️ নতুন তথ্য দেব',
        '',
        'শুধু নম্বর বা শুধু ঠিকানা বদলাতে চাইলেও 2 বেছে নিন, পরের ধাপে আগেরটি রাখার বাটন পাবেন।',
      ]),
    SAVED_DETAILS_INVALID: 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 (এই তথ্য) / 2 (নতুন তথ্য) লিখুন।',
    PHONE_INVALID: lines([
      'দুঃখিত, মোবাইল নম্বরটি সঠিক মনে হচ্ছে না।',
      '',
      'অনুগ্রহ করে এই ধরনের একটি নম্বর দিন:',
      '017XXXXXXXX, +88017XXXXXXXX, 88017XXXXXXXX',
    ]),
    // `previousAddress`: the address of the customer's last order, offered as a button.
    askAddress: (previousAddress) =>
      lines([
        '🏠 আপনার সম্পূর্ণ ডেলিভারি ঠিকানা লিখুন।',
        'যেমন: বাসা 12, রোড 3, টাঙ্গাইল সদর, টাঙ্গাইল',
        ...(previousAddress
          ? ['', `আগের ঠিকানা: ${previousAddress}`, 'একই ঠিকানায় নিতে নিচের 🏠 আগের ঠিকানা বাটনে চাপুন।']
          : []),
      ]),
    ADDRESS_INVALID: lines([
      'দুঃখিত, ঠিকানাটি সঠিক মনে হচ্ছে না।',
      '',
      'অনুগ্রহ করে 10 থেকে 200 অক্ষরের মধ্যে সম্পূর্ণ ঠিকানা লিখুন।',
    ]),
    orderSummary: ({ name, product, quantity, unitPrice, subtotal, phone, address }) =>
      lines([
        '🛍️ আপনার অর্ডার:',
        '',
        `পণ্য: ${name ?? product?.name}`,
        `পরিমাণ: ${quantity}`,
        `একক দাম: ${formatPrice(unitPrice)}`,
        `মোট দাম: ${formatPrice(subtotal)}`,
        `মোবাইল: ${phone}`,
        `ঠিকানা: ${address}`,
        '',
        DELIVERY_CHARGE,
        '',
        'অর্ডারটি নিশ্চিত করবেন?',
        '',
        '1. ✅ নিশ্চিত করুন',
        '2. ❌ বাতিল করুন',
      ]),
    CONFIRM_INVALID: 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 (নিশ্চিত) / 2 (বাতিল) লিখুন।',
    CONFIRM_STALE: lines(['এই কনফার্মেশনটি আর বৈধ নয়।', '', 'নতুন করে শুরু করতে "মেনু" লিখুন।']),
    // An old quick reply tapped while no order is in progress.
    BUTTON_STALE: lines(['এই বাটনটি আর কাজ করছে না।', '', 'নিচের মেনু থেকে আবার শুরু করুন।']),

    orderConfirmed: (order) =>
      lines([
        '✅ আপনার অর্ডার নিশ্চিত হয়েছে!',
        '',
        `অর্ডার আইডি: ${order.id}`,
        `মোট: ${formatPrice(order.subtotal)}`,
        DELIVERY_CHARGE,
        '',
        'আমাদের টিম শিগগিরই আপনার সাথে যোগাযোগ করবে।',
        '',
        'মেনু দেখতে "মেনু" লিখুন।',
      ]),
    orderDuplicate: (order) =>
      lines(['এই অর্ডারটি ইতিমধ্যে নিশ্চিত করা হয়েছে।', ...(order?.id ? [`অর্ডার আইডি: ${order.id}`] : [])]),
    ORDER_CANCELLED: lines(['❌ অর্ডার বাতিল করা হয়েছে।', '', WELCOME]),
    // The product was removed or sold out between choosing it and confirming.
    ORDER_PRODUCT_UNAVAILABLE: lines([
      '❌ দুঃখিত, পণ্যটি এখন আর পাওয়া যাচ্ছে না, তাই অর্ডারটি বাতিল করা হয়েছে।',
      '',
      WELCOME,
    ]),
    // Deliberately has no phone number or address: only the customer's own order summary lines.
    orderInfo: (orders) => {
      if (!orders || orders.length === 0) {
        return lines(['আপনার কোনো অর্ডার পাওয়া যায়নি।', '', 'পণ্য দেখতে 1 লিখুন।']);
      }
      return lines([
        '📦 আপনার সাম্প্রতিক অর্ডার:',
        '',
        ...orders.map(
          (order) =>
            `${order.id} – ${order.productName} × ${order.quantity} – ${formatPrice(order.subtotal)} – ${ORDER_STATUS[order.status] ?? order.status}`,
        ),
      ]);
    },
  });
}

function english() {
  const BUTTONS = Object.freeze({
    products: '🛍️ View Products',
    myOrders: '📦 My Orders',
    support: '👨‍💼 Support',
    shopMore: '🛍️ Shop More',
    menu: '🏠 Menu',
    cancel: '❌ Cancel',
    useSaved: '✅ Yes, use these',
    newDetails: '✏️ New details',
    savedAddress: '🏠 Previous address',
    otherLanguage: '🌐 বাংলা',
  });

  const MENU_OPTIONS = lines(['1. 🛍️ View Products', '2. 📦 My Orders', '3. 👨‍💼 Support']);
  const MENU_PROMPT = 'Tap a button below, or type 1, 2 or 3.';
  const CANCEL_HINT = 'To cancel, tap ❌ Cancel or type "cancel".';
  const CATALOG_HINT = 'Type "next" or "previous" to change pages, or "menu" for the menu.';
  const DELIVERY_CHARGE = 'Delivery charge: not added yet';
  const catalogHeader = (page, totalPages) => `🛍️ Products – page ${page}/${totalPages}`;

  const WELCOME = lines([
    'Welcome! 🛍️',
    '',
    'Welcome to Tangail Botiques.',
    '',
    'Choose an option below to see our products or place an order.',
    '',
    MENU_OPTIONS,
  ]);
  const ORDER_IN_PROGRESS = '⏳ Your order is still in progress. Answer the question below, or tap ❌ Cancel to start over.';
  const LANGUAGE_CHANGED = '✅ Language changed to English.';

  return Object.freeze({
    BUTTONS,
    WELCOME,
    SUPPORT: lines(['👨‍💼 Support', '', 'Our team will reply to your message soon.']),
    FALLBACK: lines(['Sorry, I did not understand your message.', '', MENU_OPTIONS, '', MENU_PROMPT]),
    ATTACHMENT: lines(['Sorry, I can only read text messages for now.', '', MENU_PROMPT]),
    SESSION_EXPIRED: lines(['⏳ Your previous session has timed out.', '', 'Please start again.', '', WELCOME]),

    ORDER_IN_PROGRESS,
    ATTACHMENT_IN_ORDER: lines(["Sorry, I can't read photos or stickers.", ORDER_IN_PROGRESS]),
    LANGUAGE_CHANGED,
    LANGUAGE_CHANGED_IN_ORDER: lines([LANGUAGE_CHANGED, ORDER_IN_PROGRESS]),

    catalogNav: ({ page, totalPages }) =>
      lines([
        catalogHeader(page, totalPages),
        '🛒 To order, tap a product code below (the code starts the name under each photo).',
        CATALOG_HINT,
      ]),
    catalogFallback: (products, page, totalPages) =>
      lines([
        catalogHeader(page, totalPages),
        '',
        ...products.map((product) => `${product.id} – ${product.name} – ${formatPrice(product.price)}`),
        '',
        'To order, type a product code (for example: P001).',
        CATALOG_HINT,
      ]),
    CATALOG_EDGE_FIRST: lines(['This is the first page.', 'Type "next" for the next page, or "menu".']),
    CATALOG_EDGE_LAST: lines(['This is the last page.', 'Type "previous" for the previous page, or "menu".']),
    CATALOG_EMPTY: lines(['Sorry, no products are available right now.', '', 'Type "menu" to see the menu.']),
    PRODUCT_NOT_FOUND: lines([
      'Sorry, this product was not found or is out of stock.',
      '',
      'Type 1 to see the products, or "menu".',
    ]),

    orderStart: (product) =>
      lines([
        'You selected:',
        '',
        product.name,
        `Price: ${formatPrice(product.price)}`,
        '',
        'How many pieces would you like?',
        'Tap a button below, or type a number from 1 to 100.',
        '',
        CANCEL_HINT,
      ]),
    QUANTITY_INVALID: 'Please tap a button below, or type a number from 1 to 100.',
    askPhone: (previousPhone) =>
      lines([
        '📱 Please send your mobile number.',
        ...(previousPhone ? [`To use your previous number (${previousPhone}), tap the 📱 button below.`] : []),
        'Tap your number button below if you see one, or type it. For example: 017XXXXXXXX',
      ]),
    savedDetails: ({ phone, address }) =>
      lines([
        'Details from your last order:',
        '',
        `Mobile: ${phone}`,
        `Address: ${address}`,
        '',
        'Shall we deliver to this number and address?',
        '',
        '1. ✅ Yes, use these',
        '2. ✏️ New details',
        '',
        'To change only the number or only the address, choose 2 as well: the next steps offer a button to keep the old one.',
      ]),
    SAVED_DETAILS_INVALID: 'Please tap a button below, or type 1 (use these) / 2 (new details).',
    PHONE_INVALID: lines([
      'Sorry, that mobile number does not look right.',
      '',
      'Please send a number like:',
      '017XXXXXXXX, +88017XXXXXXXX, 88017XXXXXXXX',
    ]),
    askAddress: (previousAddress) =>
      lines([
        '🏠 Please type your full delivery address.',
        'For example: House 12, Road 3, Tangail Sadar, Tangail',
        ...(previousAddress
          ? ['', `Previous address: ${previousAddress}`, 'To use the same address, tap 🏠 Previous address below.']
          : []),
      ]),
    ADDRESS_INVALID: lines([
      'Sorry, that address does not look right.',
      '',
      'Please type your full address in 10 to 200 characters.',
    ]),
    orderSummary: ({ name, product, quantity, unitPrice, subtotal, phone, address }) =>
      lines([
        '🛍️ Your order:',
        '',
        `Product: ${name ?? product?.name}`,
        `Quantity: ${quantity}`,
        `Unit price: ${formatPrice(unitPrice)}`,
        `Total: ${formatPrice(subtotal)}`,
        `Mobile: ${phone}`,
        `Address: ${address}`,
        '',
        DELIVERY_CHARGE,
        '',
        'Shall we confirm this order?',
        '',
        '1. ✅ Confirm',
        '2. ❌ Cancel',
      ]),
    CONFIRM_INVALID: 'Please tap a button below, or type 1 (confirm) / 2 (cancel).',
    CONFIRM_STALE: lines(['This confirmation is no longer valid.', '', 'Type "menu" to start again.']),
    BUTTON_STALE: lines(['This button no longer works.', '', 'Please start again from the menu below.']),

    orderConfirmed: (order) =>
      lines([
        '✅ Your order is confirmed!',
        '',
        `Order ID: ${order.id}`,
        `Total: ${formatPrice(order.subtotal)}`,
        DELIVERY_CHARGE,
        '',
        'Our team will contact you soon.',
        '',
        'Type "menu" to see the menu.',
      ]),
    orderDuplicate: (order) =>
      lines(['This order has already been confirmed.', ...(order?.id ? [`Order ID: ${order.id}`] : [])]),
    ORDER_CANCELLED: lines(['❌ Your order has been cancelled.', '', WELCOME]),
    ORDER_PRODUCT_UNAVAILABLE: lines([
      '❌ Sorry, the product is no longer available, so the order was cancelled.',
      '',
      WELCOME,
    ]),
    orderInfo: (orders) => {
      if (!orders || orders.length === 0) {
        return lines(['You have no orders yet.', '', 'Type 1 to see the products.']);
      }
      return lines([
        '📦 Your recent orders:',
        '',
        ...orders.map(
          (order) =>
            `${order.id} – ${order.productName} × ${order.quantity} – ${formatPrice(order.subtotal)} – ${order.status}`,
        ),
      ]);
    },
  });
}

const TEXTS = Object.freeze({ bn: bangla(), en: english() });

// The complete text set of a language; anything unknown gets the default (Bangla).
export const textsFor = (language) => TEXTS[language] ?? TEXTS[DEFAULT_LANGUAGE];

export const {
  BUTTONS,
  WELCOME,
  SUPPORT,
  FALLBACK,
  ATTACHMENT,
  SESSION_EXPIRED,
  ORDER_IN_PROGRESS,
  ATTACHMENT_IN_ORDER,
  LANGUAGE_CHANGED,
  LANGUAGE_CHANGED_IN_ORDER,
  catalogNav,
  catalogFallback,
  CATALOG_EDGE_FIRST,
  CATALOG_EDGE_LAST,
  CATALOG_EMPTY,
  PRODUCT_NOT_FOUND,
  orderStart,
  QUANTITY_INVALID,
  askPhone,
  savedDetails,
  SAVED_DETAILS_INVALID,
  PHONE_INVALID,
  askAddress,
  ADDRESS_INVALID,
  orderSummary,
  CONFIRM_INVALID,
  CONFIRM_STALE,
  BUTTON_STALE,
  orderConfirmed,
  orderDuplicate,
  ORDER_CANCELLED,
  ORDER_PRODUCT_UNAVAILABLE,
  orderInfo,
} = TEXTS.bn;
