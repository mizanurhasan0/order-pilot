// Every customer-facing string of the order flow lives here, so wording can be reviewed
// and changed in one place. The conversation engine only picks which text to send.

const lines = (list) => list.join('\n');

export const formatPrice = (amount) => `৳${amount}`;

const MENU_OPTIONS = lines(['1. 🛍️ View Products', '2. 📦 My Order Information', '3. 👨‍💼 Contact Support']);
const MENU_PROMPT = 'অনুগ্রহ করে 1, 2 অথবা 3 লিখুন।';

export const WELCOME = lines([
  'স্বাগতম! 🛍️',
  '',
  'Tangail Botiques-এ আপনাকে স্বাগতম।',
  '',
  'আমাদের পণ্য দেখতে অথবা অর্ডার করতে নিচের অপশন নির্বাচন করুন।',
  '',
  MENU_OPTIONS,
]);

export const SUPPORT = lines(['👨‍💼 Contact Support', '', 'আমাদের টিম আপনার মেসেজের উত্তর দেবে।']);

export const FALLBACK = lines(['দুঃখিত, আপনার মেসেজটি বুঝতে পারিনি।', '', MENU_OPTIONS, '', MENU_PROMPT]);

// Sent by autoReplyService for photos, stickers and other non-text messages.
export const ATTACHMENT = lines(['দুঃখিত, আমি এখন শুধু টেক্সট মেসেজ বুঝতে পারি।', '', MENU_PROMPT]);

export const SESSION_EXPIRED = lines([
  '⏳ আপনার আগের সেশনের সময় শেষ হয়ে গেছে।',
  '',
  'অনুগ্রহ করে নতুন করে শুরু করুন।',
  '',
  WELCOME,
]);

// --- catalog ---------------------------------------------------------------------------

const CATALOG_HINT = 'next / previous / menu / cancel লিখেও যেতে পারেন।';

const catalogHeader = (page, totalPages) => `🛍️ পণ্য তালিকা – পৃষ্ঠা ${page}/${totalPages}`;

// The short message sent after the product cards (the quick-reply buttons ride on it).
export const catalogNav = ({ page, totalPages }) =>
  lines([catalogHeader(page, totalPages), 'অর্ডার করতে পণ্যের নিচের "Order Now" বাটনে চাপ দিন।', CATALOG_HINT]);

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

export const CATALOG_EDGE_FIRST = lines([
  'এটিই প্রথম পৃষ্ঠা।',
  'পরের পৃষ্ঠায় যেতে next লিখুন, অথবা menu লিখুন।',
]);

export const CATALOG_EDGE_LAST = lines([
  'এটিই শেষ পৃষ্ঠা।',
  'আগের পৃষ্ঠায় যেতে previous লিখুন, অথবা menu লিখুন।',
]);

export const CATALOG_EMPTY = lines(['দুঃখিত, এই মুহূর্তে কোনো পণ্য পাওয়া যাচ্ছে না।', '', 'মেনু দেখতে menu লিখুন।']);

export const PRODUCT_NOT_FOUND = lines([
  'দুঃখিত, এই পণ্যটি পাওয়া যায়নি অথবা এখন স্টকে নেই।',
  '',
  'পণ্য তালিকা দেখতে 1 লিখুন, অথবা menu লিখুন।',
]);

// --- collecting the order --------------------------------------------------------------

export const orderStart = (product) =>
  lines([
    'আপনি নির্বাচন করেছেন:',
    '',
    product.name,
    `Price: ${formatPrice(product.price)}`,
    '',
    'কয়টি পিস অর্ডার করবেন?',
    '(1 থেকে 100)',
    '',
    'বাতিল করতে cancel লিখুন।',
  ]);

export const QUANTITY_INVALID = 'অনুগ্রহ করে 1 থেকে 100-এর মধ্যে একটি সংখ্যা লিখুন।';

export const ASK_PHONE = lines(['আপনার মোবাইল নম্বর দিন।', 'যেমন: 017XXXXXXXX']);

export const PHONE_INVALID = lines([
  'দুঃখিত, মোবাইল নম্বরটি সঠিক মনে হচ্ছে না।',
  '',
  'অনুগ্রহ করে এই ধরনের একটি নম্বর দিন:',
  '017XXXXXXXX, +88017XXXXXXXX, 88017XXXXXXXX',
]);

export const ASK_ADDRESS = 'আপনার সম্পূর্ণ ডেলিভারি ঠিকানা দিন।';

export const ADDRESS_INVALID = lines([
  'দুঃখিত, ঠিকানাটি সঠিক মনে হচ্ছে না।',
  '',
  'অনুগ্রহ করে 10 থেকে 200 অক্ষরের মধ্যে সম্পূর্ণ ঠিকানা লিখুন।',
]);

export const orderSummary = ({ name, product, quantity, unitPrice, subtotal, phone, address }) =>
  lines([
    '🛍️ আপনার অর্ডার:',
    '',
    `Product: ${name ?? product?.name}`,
    `Quantity: ${quantity}`,
    `Unit Price: ${formatPrice(unitPrice)}`,
    `Subtotal: ${formatPrice(subtotal)}`,
    `Phone: ${phone}`,
    `Address: ${address}`,
    '',
    'Delivery charge: Not calculated',
    '',
    'অর্ডারটি নিশ্চিত করবেন?',
    '',
    '1. Confirm',
    '2. Cancel',
  ]);

export const CONFIRM_INVALID = 'অনুগ্রহ করে 1 (Confirm) অথবা 2 (Cancel) লিখুন।';

export const CONFIRM_STALE = lines(['এই কনফার্মেশনটি আর বৈধ নয়।', '', 'নতুন করে শুরু করতে menu লিখুন।']);

// --- finishing -------------------------------------------------------------------------

export const orderConfirmed = (order) =>
  lines([
    '✅ আপনার অর্ডার নিশ্চিত হয়েছে!',
    '',
    `Order ID: ${order.id}`,
    `Total: ${formatPrice(order.subtotal)}`,
    'Delivery charge: Not calculated',
    '',
    'আমাদের টিম শিগগিরই আপনার সাথে যোগাযোগ করবে।',
    '',
    'মেনু দেখতে menu লিখুন।',
  ]);

export const orderDuplicate = (order) =>
  lines(['এই অর্ডারটি ইতিমধ্যে নিশ্চিত করা হয়েছে।', ...(order?.id ? [`Order ID: ${order.id}`] : [])]);

export const ORDER_CANCELLED = lines(['❌ অর্ডার বাতিল করা হয়েছে।', '', WELCOME]);

// The product was removed or sold out between choosing it and confirming.
export const ORDER_PRODUCT_UNAVAILABLE = lines([
  '❌ দুঃখিত, পণ্যটি এখন আর পাওয়া যাচ্ছে না, তাই অর্ডারটি বাতিল করা হয়েছে।',
  '',
  WELCOME,
]);

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
        `${order.id} – ${order.productName} × ${order.quantity} – ${formatPrice(order.subtotal)} – ${order.status}`,
    ),
  ]);
};
