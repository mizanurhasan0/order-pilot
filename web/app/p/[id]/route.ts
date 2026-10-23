// Public product link for Facebook posts: https://<dashboard>/p/P001.
//
// Facebook builds a link preview from the page a link points to. An m.me link shows the Page's
// own picture, so posts link here instead:
// - link-preview crawlers get a small HTML page whose Open Graph tags carry the product photo,
//   name and price, read from the public GET /api/products/:id;
// - everyone else is redirected to m.me/<page>?ref=ORDER_PRODUCT:P001, which opens Messenger with
//   the product chosen. Customers never wait for the backend: an unknown id is answered by the
//   bot ("product not found" and the menu).
//
// proxy.ts does not run on this path, and nothing here touches orders.

import { getBackendUrl } from '@/lib/backend';
import { formatMoney } from '@/lib/format';
import { getFacebookPageUsername, messengerProductLink } from '@/lib/messenger';
import type { Product } from '@/lib/types';

// Crawlers that build link previews. They must not be redirected: Facebook follows redirects and
// would show the m.me preview (the Page picture) again.
const PREVIEW_CRAWLERS =
  /facebookexternalhit|facebot|facebookcatalog|meta-externalagent|twitterbot|whatsapp|telegrambot|slackbot|linkedinbot|discordbot|pinterest|skypeuripreview|embedly/i;

const PRODUCT_ID_FORMAT = /^[A-Za-z0-9_-]{1,40}$/;
const HOST_FORMAT = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
const BACKEND_TIMEOUT_MS = 5_000;

const HEADERS = {
  'Cache-Control': 'no-store', // the answer depends on who asks
  Vary: 'User-Agent',
  'X-Robots-Tag': 'noindex',
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function htmlResponse(status: number, title: string, body: string, head = ''): Response {
  const html = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${head}
</head>
<body style="margin:0;padding:32px 16px;background:#f8faf8;color:#25382c;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center">
<main style="max-width:420px;margin:0 auto">
${body}
</main>
</body>
</html>`;
  return new Response(html, { status, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
}

const messageResponse = (status: number, message: string) =>
  htmlResponse(status, message, `<p style="font-size:16px">${escapeHtml(message)}</p>`);

// The product from the public Express endpoint, or null when it does not exist.
// Throws when the backend cannot be reached or answers something unexpected.
async function fetchProduct(backendUrl: string, id: string): Promise<Product | null> {
  const res = await fetch(`${backendUrl}/api/products/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok || body?.success !== true || typeof body.data?.id !== 'string') {
    throw new Error('Unexpected backend response');
  }
  return body.data as Product;
}

// The address the crawler asked for, from the Host header. request.url can name the server's
// own host instead (on Vercel possibly a deployment URL behind its login), and Facebook re-reads
// og:url. Null leaves og:url out: Facebook then uses the shared link itself.
function pageUrlOf(request: Request, productId: string): string | null {
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0].trim();
  if (!HOST_FORMAT.test(host)) return null;
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const protocol = forwarded === 'http' || forwarded === 'https' ? forwarded : new URL(request.url).protocol.slice(0, -1);
  return `${protocol}://${host}/p/${encodeURIComponent(productId)}`;
}

function previewResponse(product: Product, pageUrl: string | null, messengerUrl: string): Response {
  const price = formatMoney(product.price, product.currency);
  const title = `${product.name} – ${price}`;
  const description = [product.description, 'ট্যাপ করে Messenger-এ অর্ডার করুন।'].filter(Boolean).join(' ');
  const image = /^https:\/\/\S+$/i.test(product.imageUrl) ? product.imageUrl : null;

  const tags: [string, string][] = [
    ['og:type', 'website'],
    ...(pageUrl ? ([['og:url', pageUrl]] as [string, string][]) : []),
    ['og:title', title],
    ['og:description', description],
    ...(image ? ([['og:image', image], ['og:image:alt', product.name]] as [string, string][]) : []),
  ];
  const head = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    ...tags.map(([property, content]) => `<meta property="${property}" content="${escapeHtml(content)}">`),
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n');

  const body = [
    image && `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" style="width:100%;border-radius:16px">`,
    `<h1 style="margin:20px 0 6px;font-size:20px">${escapeHtml(product.name)}</h1>`,
    `<p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#205e46">${escapeHtml(price)}</p>`,
    `<a href="${escapeHtml(messengerUrl)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#205e46;color:#fff;font-weight:600;text-decoration:none">Messenger-এ অর্ডার করুন</a>`,
  ]
    .filter(Boolean)
    .join('\n');

  return htmlResponse(200, title, body, head);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!PRODUCT_ID_FORMAT.test(id)) return messageResponse(404, 'Product not found.');

  const pageUsername = getFacebookPageUsername();
  if (!pageUsername) return messageResponse(503, 'This product link is not set up yet.');

  // Customers go straight to Messenger. Only crawlers need the product itself.
  if (!PREVIEW_CRAWLERS.test(request.headers.get('user-agent') ?? '')) {
    const location = messengerProductLink(pageUsername, id.toUpperCase());
    return new Response(null, { status: 302, headers: { ...HEADERS, Location: location } });
  }

  let product: Product | null;
  try {
    const backendUrl = getBackendUrl();
    if (!backendUrl) throw new Error('BACKEND_API_URL is not a valid URL');
    product = await fetchProduct(backendUrl, id);
  } catch {
    return messageResponse(502, 'Please try again later.');
  }
  if (!product) return messageResponse(404, 'Product not found.');

  return previewResponse(product, pageUrlOf(request, product.id), messengerProductLink(pageUsername, product.id));
}
