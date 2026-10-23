// Every customer-facing string of the order flow lives here, so wording can be reviewed
// and changed in one place. The conversation engine only picks which text to send.
// Everything is Bangla; product names, prices and order ids are shown as they are stored.

const lines = (list) => list.join('\n');

export const formatPrice = (amount) => `৳${amount}`;

// Quick-reply labels (Messenger cuts them at 20 characters).
export const BUTTONS = Object.freeze({
  products: '🛍️ পণ্য দেখুন',
  myOrders: '📦 আমার অর্ডার',
  support: '👨‍💼 সহায়তা',
  shopMore: '🛍️ আরও কিনুন',
  menu: '🏠 মেনু',
  cancel: '❌ বাতিল',
  useSaved: '✅ হ্যাঁ, এই তথ্য',
  newDetails: '✏️ নতুন তথ্য দেব',
  savedAddress: '🏠 আগের ঠিকানা',
});

// The button that reuses the number of the customer's last order.
export const savedPhoneButton = (phone) => `📱 ${phone}`;

const MENU_OPTIONS = lines(['1. 🛍️ পণ্য দেখুন', '2. 📦 আমার অর্ডারের তথ্য', '3. 👨‍💼 সহায়তা']);
const MENU_PROMPT = 'নিচের বাটনে চাপুন, অথবা 1, 2 বা 3 লিখুন।';
const CANCEL_HINT = 'বাতিল করতে ❌ বাতিল চাপুন, অথবা "বাতিল" লিখুন।';

export const WELCOME = lines([
  'স্বাগতম! 🛍️',
  '',
  'Tangail Botiques-এ আপনাকে স্বাগতম।',
  '',
  'আমাদের পণ্য দেখতে অথবা অর্ডার করতে নিচের অপশন নির্বাচন করুন।',
  '',
  MENU_OPTIONS,
]);

export const SUPPORT = lines(['👨‍💼 সহায়তা', '', 'আমাদের টিম শিগগিরই আপনার মেসেজের উত্তর দেবে।']);

export const FALLBACK = lines(['দুঃখিত, আপনার মেসেজটি বুঝতে পারিনি।', '', MENU_OPTIONS, '', MENU_PROMPT]);

// Photos, stickers, likes and other non-text messages outside an order.
export const ATTACHMENT = lines(['দুঃখিত, আমি এখন শুধু টেক্সট মেসেজ বুঝতে পারি।', '', MENU_PROMPT]);

export const SESSION_EXPIRED = lines([
  '⏳ আপনার আগের সেশনের সময় শেষ হয়ে গেছে।',
  '',
  'অনুগ্রহ করে নতুন করে শুরু করুন।',
  '',
  WELCOME,
]);

// --- in the middle of an order ---------------------------------------------------------
// Anything that is not an answer (a greeting, Menu, an old button, a sticker) keeps the order
// and repeats the current question under one of these lines. Only Cancel starts over.

export const ORDER_IN_PROGRESS = '⏳ আপনার অর্ডারটি এখনো চলছে। নিচের প্রশ্নের উত্তর দিন, অথবা নতুন করে শুরু করতে ❌ বাতিল চাপুন।';

export const ATTACHMENT_IN_ORDER = lines(['দুঃখিত, ছবি বা স্টিকার বুঝতে পারি না।', ORDER_IN_PROGRESS]);

// The note on top, then the question it repeats.
export const resumed = (note, question) => lines([note, '', question]);

// --- catalog ---------------------------------------------------------------------------

const CATALOG_HINT = 'পৃষ্ঠা বদলাতে "পরের" বা "আগের" লিখুন, মেনুর জন্য "মেনু"।';

const catalogHeader = (page, totalPages) => `🛍️ পণ্য তালিকা – পৃষ্ঠা ${page}/${totalPages}`;

// The short message sent after the product cards (the quick-reply buttons ride on it).
export const catalogNav = ({ page, totalPages }) =>
  lines([
    catalogHeader(page, totalPages),
    '🛒 অর্ডার করতে নিচে পণ্যের কোডে চাপ দিন (কোডটি ছবির নিচে নামের শুরুতে আছে)।',
    CATALOG_HINT,
  ]);

// Plain-text version of the page, used when Messenger rejects the card template.
export const catalogFallback = (products, page, totalPages) =>
  lines([
    catalogHeader(page, totalPages),
    '',
    ...products.map((product) => `${product.id} – ${product.name} – ${formatPrice(product.price)}`),
    '',
    'অর্ডার করতে পণ্যের কোড লিখুন (যেমন: P001)।',
    CATALOG_HINT,
  ]);

export const CATALOG_EDGE_FIRST = lines(['এটিই প্রথম পৃষ্ঠা।', 'পরের পৃষ্ঠায় যেতে "পরের" লিখুন, অথবা "মেনু" লিখুন।']);

export const CATALOG_EDGE_LAST = lines(['এটিই শেষ পৃষ্ঠা।', 'আগের পৃষ্ঠায় যেতে "আগের" লিখুন, অথবা "মেনু" লিখুন।']);

export const CATALOG_EMPTY = lines(['দুঃখিত, এই মুহূর্তে কোনো পণ্য পাওয়া যাচ্ছে না।', '', 'মেনু দেখতে "মেনু" লিখুন।']);

export const PRODUCT_NOT_FOUND = lines([
  'দুঃখিত, এই পণ্যটি পাওয়া যায়নি অথবা এখন স্টকে নেই।',
  '',
  'পণ্য তালিকা দেখতে 1 লিখুন, অথবা "মেনু" লিখুন।',
]);

// --- collecting the order --------------------------------------------------------------

export const orderStart = (product) =>
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
  ]);

export const QUANTITY_INVALID = 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 থেকে 100-এর মধ্যে একটি সংখ্যা লিখুন।';

// `previousPhone`: the number of the customer's last order, offered as a button.
export const askPhone = (previousPhone) =>
  lines([
    '📱 আপনার মোবাইল নম্বর দিন।',
    ...(previousPhone ? [`আগের নম্বরটি (${previousPhone}) দিতে নিচের 📱 বাটনে চাপুন।`] : []),
    'নিচে আপনার নম্বরের বাটন থাকলে চাপুন, অথবা লিখুন। যেমন: 017XXXXXXXX',
  ]);

// A returning customer: the phone and address of their last order, offered for this one.
export const savedDetails = ({ phone, address }) =>
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
  ]);

export const SAVED_DETAILS_INVALID = 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 (এই তথ্য) / 2 (নতুন তথ্য) লিখুন।';

export const PHONE_INVALID = lines([
  'দুঃখিত, মোবাইল নম্বরটি সঠিক মনে হচ্ছে না।',
  '',
  'অনুগ্রহ করে এই ধরনের একটি নম্বর দিন:',
  '017XXXXXXXX, +88017XXXXXXXX, 88017XXXXXXXX',
]);

// `previousAddress`: the address of the customer's last order, offered as a button.
export const askAddress = (previousAddress) =>
  lines([
    '🏠 আপনার সম্পূর্ণ ডেলিভারি ঠিকানা লিখুন।',
    'যেমন: বাসা 12, রোড 3, টাঙ্গাইল সদর, টাঙ্গাইল',
    ...(previousAddress
      ? ['', `আগের ঠিকানা: ${previousAddress}`, 'একই ঠিকানায় নিতে নিচের 🏠 আগের ঠিকানা বাটনে চাপুন।']
      : []),
  ]);

export const ADDRESS_INVALID = lines([
  'দুঃখিত, ঠিকানাটি সঠিক মনে হচ্ছে না।',
  '',
  'অনুগ্রহ করে 10 থেকে 200 অক্ষরের মধ্যে সম্পূর্ণ ঠিকানা লিখুন।',
]);

const DELIVERY_CHARGE = 'ডেলিভারি চার্জ: এখনো যোগ করা হয়নি';

export const orderSummary = ({ name, product, quantity, unitPrice, subtotal, phone, address }) =>
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
  ]);

export const CONFIRM_INVALID = 'অনুগ্রহ করে নিচের বাটনে চাপুন, অথবা 1 (নিশ্চিত) / 2 (বাতিল) লিখুন।';

export const CONFIRM_STALE = lines(['এই কনফার্মেশনটি আর বৈধ নয়।', '', 'নতুন করে শুরু করতে "মেনু" লিখুন।']);

// An old quick reply tapped while no order is in progress.
export const BUTTON_STALE = lines(['এই বাটনটি আর কাজ করছে না।', '', 'নিচের মেনু থেকে আবার শুরু করুন।']);

// --- finishing -------------------------------------------------------------------------

export const orderConfirmed = (order) =>
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
  ]);

export const orderDuplicate = (order) =>
  lines(['এই অর্ডারটি ইতিমধ্যে নিশ্চিত করা হয়েছে।', ...(order?.id ? [`অর্ডার আইডি: ${order.id}`] : [])]);

export const ORDER_CANCELLED = lines(['❌ অর্ডার বাতিল করা হয়েছে।', '', WELCOME]);

// The product was removed or sold out between choosing it and confirming.
export const ORDER_PRODUCT_UNAVAILABLE = lines([
  '❌ দুঃখিত, পণ্যটি এখন আর পাওয়া যাচ্ছে না, তাই অর্ডারটি বাতিল করা হয়েছে।',
  '',
  WELCOME,
]);

const ORDER_STATUS = { pending: 'অপেক্ষমাণ', confirmed: 'নিশ্চিত', cancelled: 'বাতিল' };

// Deliberately has no phone number or address: only the customer's own order summary lines.
export const orderInfo = (orders) => {
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
};
