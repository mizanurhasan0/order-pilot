# orderpilot

A Messenger order bot for a Facebook Page. Install it in any Node.js app, give it the Page's details and your products, mount one webhook route, and customers can browse and order in Messenger, in Bangla or English.

- Product cards in Messenger, 5 per page, with **🛒 Order** buttons.
- Order steps: quantity → phone number → address → summary → confirm. Returning customers can reuse their last phone number and address.
- Bangla by default, English for customers whose Facebook language is English; a 🌐 button switches.
- Product links for posts and websites (`https://m.me/<page>?ref=ORDER_PRODUCT:P001`) open Messenger with the product chosen.
- One order per confirmation, even when Meta delivers an event twice or the customer taps twice.
- Logs never contain message text, phone numbers, addresses or tokens.

No runtime dependencies. Node.js 20 or newer.

## Quick start (Express)

```bash
npm install orderpilot
```

```js
import express from 'express';
import { createOrderPilot } from 'orderpilot';

const bot = createOrderPilot({
  shopName: 'My Shop',
  products: [
    { id: 'P001', name: 'Red Silk Saree', price: 6200, imageUrl: 'https://example.com/p001.jpg' },
  ],
  onOrder: async (order) => {
    // save it in your own database, send an email, ...
  },
});

const app = express();
app.use('/webhook/facebook', bot.webhook); // before express.json(): the signature needs the raw body
app.use(express.json());
app.listen(3000);
```

`.env` (or real environment variables):

```bash
PAGE_ACCESS_TOKEN=...        # Page access token (Meta app > Messenger > Access tokens)
FACEBOOK_PAGE_ID=...         # the Page's numeric id
META_APP_SECRET=...          # App settings > Basic > App secret (checks every delivery's signature)
META_VERIFY_TOKEN=...        # any secret string; the same value goes into the webhook settings
```

Then link the Page once the server is reachable over HTTPS:

```js
const result = await bot.connect();
console.log(result.steps); // [{ step: 'app_webhook', ... }, { step: 'page_subscription', ok: true }, { step: 'get_started', ok: true }]
```

## Other frameworks

```js
// Next.js (App Router): app/api/webhook/facebook/route.js
import { bot } from '@/lib/bot';
export const GET = bot.fetchHandler;
export const POST = bot.fetchHandler;

// Plain node:http
http.createServer((req, res) => {
  if (req.url.startsWith('/webhook/facebook')) return bot.webhook(req, res);
  res.statusCode = 404;
  res.end();
}).listen(3000);

// Hono, Bun, Deno, Cloudflare Workers: anything that hands you a Request
app.all('/webhook/facebook', (c) => bot.fetchHandler(c.req.raw));
```

`bot.webhook` answers Meta first and sends the replies right after. `bot.fetchHandler` does the same when it has a `waitUntil` (the `waitUntil` option, or `fetchHandler(request, { waitUntil })`); without one it sends the replies before it responds, so a serverless platform cannot stop them halfway. On Vercel pass `waitUntil` from `@vercel/functions`.

## Options

Every Page setting can come from an option or, when the option is left out, from the environment variable next to it. Environment variables are read on every request, so the bot can be created before `.env` is loaded.

| Option | Environment variable | |
| --- | --- | --- |
| `pageAccessToken` | `PAGE_ACCESS_TOKEN` | Page access token for the Send API. |
| `pageId` | `FACEBOOK_PAGE_ID` | The Page's numeric id. |
| `appSecret` | `META_APP_SECRET` | Checks the `X-Hub-Signature-256` of every delivery. |
| `verifyToken` | `META_VERIFY_TOKEN` | Answers Meta's webhook verification. |
| `graphApiVersion` | `META_GRAPH_API_VERSION` | Default `v26.0`. |
| `appId` | `FACEBOOK_APP_ID` | Only for `connect()` setting the app's webhook. |
| `webhookUrl` | `WEBHOOK_URL` | The public `https://` URL of your webhook, for `connect()`. |
| `shopName` | `SHOP_NAME` | Shown in the welcome message. |
| `detectLanguage` | `DETECT_LANGUAGE` | Pick Bangla or English from the customer's Facebook language. On unless `false`. |
| `products` | | An array, or a function (may be async) that returns one. See below. |
| `onOrder(order)` | | Runs once for every new order, before the customer's confirmation is sent. A failure is logged and never stops the reply. |
| `redis` | | A Redis client (`@upstash/redis`) to keep orders, conversations, languages and the duplicate filter in. |
| `redisPrefix` | | Key prefix in Redis, default `orderpilot:`. |
| `orders`, `sessions`, `preferences`, `dedupe` | | Your own stores instead of the built-in ones (see `index.d.ts` for the methods). |
| `autoReply` | | `false` (or a function returning false) receives and logs events without replying. Default on. |
| `waitUntil` | | Keeps a serverless function alive until the replies are sent. |

`bot.checkConfig()` lists what is missing, for example `['pageAccessToken (PAGE_ACCESS_TOKEN)']`. Without `appSecret` or `verifyToken` the webhook answers `503`; without the Page token the bot receives events but cannot reply.

## Products

```js
createOrderPilot({ products: async () => db.product.findMany({ where: { published: true } }) });
```

| Field | |
| --- | --- |
| `id` | What customers type (`p001`, `order SKU-55`) and what product links carry. Case-insensitive. |
| `name` | Shown on the card and in the summary. |
| `price` | Whole currency units, a positive integer (৳1250 is `1250`). |
| `imageUrl` | A public `https://` image; Messenger fetches it. Square photos look best. |
| `description` | Optional, the card's second line. |
| `currency` | Optional, default `BDT`. |
| `available` | Optional, `false` hides the product. |

A function is called on every lookup, so changes show up at once; cache inside it if the query is slow. Products without a usable `id`, `name` or `price` are skipped. If a card cannot be built (an `http://` image, say) the page is sent as a text list instead.

## Storage

Without a store everything lives in the process's memory: fine for one long-running server, lost on restart. Serverless hosting (Vercel, Netlify, Lambda) runs many short-lived instances, so pass Redis there:

```js
import { Redis } from '@upstash/redis';
createOrderPilot({ redis: Redis.fromEnv(), products });
```

`bot.orders` is the order store the bot uses: `list({ status })`, `get(id)`, `updateStatus(id, status)` (`pending`, `confirmed`, `cancelled`), `listByCustomer(psid)`. Build your admin screen on it, or keep your own copy with `onOrder`.

Order: `{ id: 'ORD-1001', productId, productName, quantity, unitPrice, subtotal, currency, customerPsid, phone, address, status: 'pending', createdAt }`.

## connect()

Does through the Graph API what you would otherwise click in the Meta App Dashboard. Safe to run again.

1. **app_webhook**: sets the app's Page webhook to `webhookUrl` with your verify token (needs `appId`, `appSecret`, `verifyToken`, `webhookUrl`; skipped and listed in `missing` otherwise). Meta verifies the URL immediately, so the server must already be running there.
2. **page_subscription**: subscribes the Page to `messages`, `messaging_postbacks` and `messaging_referrals`.
3. **get_started**: adds Messenger's Get Started button (`connect({ getStarted: false })` skips it).

It never throws or logs and never returns a token: `{ ok, steps: [{ step, ok, skipped?, missing?, reason?, hint?, code? }] }`. A `hint` such as `permission_denied` or `invalid_access_token` says what to fix.

## Before real customers can use it

Meta lets a new app reply only to people with a role on it (admins, developers, testers). To answer everyone, the app needs **Advanced Access** to `pages_messaging` (and `pages_manage_metadata` for `connect()`), which takes **App Review** and **Business Verification**. Review is per app, not per Page.

The bot answers within Meta's 24-hour window only; it never writes first.

## Helpers

```js
import { productLink, textsFor, ORDER_STATUSES } from 'orderpilot';

productLink('myshop', 'P001'); // https://m.me/myshop?ref=ORDER_PRODUCT:P001
textsFor('en', 'My Shop').WELCOME; // every customer-facing text, per language
```

## Development

```bash
npm test
```

The tests mock the Graph API, so they make no Meta calls and need no `.env`.

This package is `"private": true` until it is published: remove that line and choose a license first.
