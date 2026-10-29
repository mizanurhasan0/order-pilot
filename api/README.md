# OrderPilot Backend

A Node.js (Express 5) backend for a Facebook Page shop. It serves three things:

- **The Messenger order bot.** Customers browse product cards in Messenger and order step by step (product, quantity, phone number, address, confirmation), in Bangla or English.
- **A public product API** over a static catalog of 50 products (`P001` to `P050`, 8 categories).
- **An admin orders API**, protected by `ADMIN_API_KEY`, which the dashboard in `../web` uses.

The bot itself is the [`orderpilot`](../packages/orderpilot/README.md) package in `../packages/orderpilot`, an npm package any Node.js app can install. This backend links it (`"orderpilot": "link:../packages/orderpilot"`) and sets it up in [`src/bot.js`](src/bot.js) with our products, our shop name and Redis. How the conversation works, every bot option and the bot's own tests are documented there.

**Contents:** [How it fits together](#how-it-fits-together) · [Project structure](#project-structure) · [Quick start](#quick-start) · [Environment variables](#environment-variables) · [REST API](#rest-api) · [Messenger bot](#messenger-bot) · [Tests](#tests) · [Deploying](#deploying) · [Troubleshooting](#troubleshooting) · [Security](#security)

## How it fits together

```
Customer in Messenger ⇄ Meta ⇄ /api/webhooks/facebook ─┐
                                                      ├─ bot (src/bot.js) ─ Upstash Redis, or memory
Dashboard (../web) ─ /api/orders (X-Admin-Key) ───────┘
Anyone ─ /api/products (public), /health
```

- Meta sends every customer message to the webhook, signed with your App secret. The bot answers through Meta's Send API.
- Orders, conversations and the duplicate filter live in Upstash Redis when it is configured (required on Vercel), otherwise in memory, where a restart loses them.
- Replies are opt-in. With `ENABLE_AUTO_REPLY=false` (the default) events are received, checked and logged, and nothing is sent.
- Not included: payment, carts, courier integration, inventory, proactive messages (the bot never writes first) and Meta App Review.

## Project structure

```
src/
├── app.js                 # Express app (Vercel entry): settings check, /health, webhook, routes, error handlers
├── server.js              # local/VPS entry: exits on bad settings, listens on PORT
├── bot.js                 # the Messenger bot: createOrderPilot() with our products, shop name and Redis
├── config.js              # checks of this backend's own variables: auto-reply switch, ADMIN_API_KEY, Redis
├── loadEnv.js             # loads .env (never under `node --test`)
├── data/products.js       # the catalog: 50 products, 8 categories
├── middleware/
│   ├── adminAuth.js       # X-Admin-Key check for /api/orders
│   └── errors.js          # JSON answers for 404, 503 (not configured) and errors
├── routes/
│   ├── products.js        # GET /api/products and /api/products/:id
│   └── orders.js          # /api/orders (admin key required)
├── services/productService.js  # product lists and lookup by id
└── utils/safeEqual.js     # constant-time string comparison
test/                      # node --test; Meta's API is mocked
```

## Quick start

Requirements: Node.js 20 or newer and pnpm 10 (`corepack enable pnpm`, or `brew install pnpm`). Run the commands in this folder.

1. Install:

   ```bash
   pnpm install
   ```

2. Create `.env` from the template, then fill in the values (next section):

   ```bash
   cp .env.example .env
   ```

   Generate the verify token and the admin key with:

   ```bash
   openssl rand -hex 24
   ```

3. Start it. `pnpm dev` restarts on every code change; `pnpm start` runs it once:

   ```bash
   pnpm dev
   ```

4. Check it:

   ```bash
   curl -i http://localhost:3000/health
   ```

   Expect `200` and `{"success":true,"message":"OrderPilot backend is running"}`. The startup log says whether auto-reply is on and where orders are stored.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `META_VERIFY_TOKEN` | always | A random string you invent; the same string goes into Meta's webhook settings. |
| `META_APP_SECRET` | always | Your Meta app's App secret (App settings > Basic). Checks the signature of every webhook delivery. |
| `ADMIN_API_KEY` | always | Protects `/api/orders`. At least 16 characters; generate it with `openssl rand -hex 24`. |
| `ENABLE_AUTO_REPLY` | no | `true` turns replies on. `false` or unset only receives and logs. Any other value is rejected, so a typo never switches replies. |
| `PAGE_ACCESS_TOKEN` | with replies | Page access token for the Send API. |
| `FACEBOOK_PAGE_ID` | with replies | The Page's numeric ID. |
| `META_GRAPH_API_VERSION` | no | Default `v26.0`. Format `vNN.N`. |
| `DETECT_LANGUAGE` | no | `false` starts every customer in Bangla instead of reading their Facebook language. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | on Vercel | Upstash Redis for orders and conversations. Vercel's Upstash integration sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` instead; both work. |
| `PORT` | no | Default `3000`. Only used by `server.js`. |

Write values without quotes or spaces. A value still starting with `replace_with` counts as missing.

**Startup check.** `src/config.js` checks this backend's own variables; the bot checks its own (the two secrets always, the Page token and ID only with replies on) through `bot.checkConfig()`. Anything missing is named, never shown:

```
Missing or invalid settings: ADMIN_API_KEY, appSecret (META_APP_SECRET). See .env.example.
```

`pnpm start` then exits. On Vercel, where there is no process to stop, every request gets `503 {"success":false,"message":"Server is not configured"}` until it is fixed. Restart after every `.env` change: `pnpm dev` does not watch `.env`.

## REST API

All answers are JSON: `{"success":true,"data":...}` or `{"success":false,"message":"..."}`. An unknown path is `404 {"success":false,"message":"Not found"}`.

### `GET /health`

`200 {"success":true,"message":"OrderPilot backend is running"}`

### Products (public)

`GET /api/products` lists products with paging and filters:

| Parameter | Rule | Default |
| --- | --- | --- |
| `page` | whole number, 1 or more | `1` |
| `limit` | whole number from 1 to 50 | `10` |
| `category` | one of the 8 categories, case-insensitive (`saree`, `three piece`, `Women's Dress`) | all |
| `search` | up to 100 characters, matched in name, description and category | none |

```bash
curl "http://localhost:3000/api/products?category=Kurti&search=cotton&limit=3"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "P011",
      "name": "Grey Embroidered Hem Kurti",
      "description": "Light grey cotton kurti with subtle hem embroidery, good for office wear.",
      "category": "Kurti",
      "price": 1250,
      "currency": "BDT",
      "imageUrl": "https://images.unsplash.com/photo-1733209590486-4ed0bfcbc52a?auto=format&fit=crop&w=800&h=800&q=80",
      "available": true
    }
  ],
  "pagination": { "page": 1, "limit": 3, "total": 1, "totalPages": 1 }
}
```

Filters combine, and the totals count the filtered list. A page past the end is `200` with an empty `data`. Bad input is `400`: `page` or `limit` out of range or repeated, a repeated `category` or `search`, a `search` over 100 characters, or an unknown category (the answer then lists the valid `categories`).

`GET /api/products/:id` returns one product; the id is case-insensitive (`p001` works). An unknown id is `404 {"success":false,"message":"Product not found"}`.

To change the catalog, edit `src/data/products.js` and keep every category in its `CATEGORIES` list. Image URLs must be public `https://` links straight to a stable square image (800 x 800 works well), because Meta downloads them for the cards. `test/products.data.test.js` checks the bundled catalog strictly (50 products, 8 categories, price range), so adjust it when you change the catalog on purpose.

### Orders (admin)

Orders hold phone numbers and addresses, so every request needs the admin key in the `X-Admin-Key` header. Without it, or with a wrong one, every path under `/api/orders` answers the same `401 {"success":false,"message":"Unauthorized"}`. Load the key into your shell instead of typing it:

```bash
set -a; source .env; set +a
```

| Request | Answer |
| --- | --- |
| `GET /api/orders` | All orders, newest first: `{"success":true,"count":N,"data":[...]}`. Optional `?status=pending\|confirmed\|cancelled`. |
| `GET /api/orders/:id` | One order, or `404 Order not found`. |
| `PATCH /api/orders/:id/status` with `{"status":"confirmed"}` | The updated order. Any status can change to any other. |

```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" "http://localhost:3000/api/orders?status=pending"
```

```bash
curl -X PATCH -H "X-Admin-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' -d '{"status":"confirmed"}' http://localhost:3000/api/orders/ORD-1001/status
```

An order:

```json
{
  "id": "ORD-1001", "productId": "P001", "productName": "Red Banarasi Style Silk Saree",
  "quantity": 2, "unitPrice": 6200, "subtotal": 12400, "currency": "BDT",
  "customerPsid": "1111111111", "phone": "01712345678", "address": "House 12, Road 3, Tangail Sadar",
  "status": "pending", "createdAt": "2026-10-22T06:14:49.109Z"
}
```

Every order starts as `pending` when the customer confirms in Messenger; there is no `POST` or `DELETE`. `unitPrice` is the price at confirmation, so later catalog edits do not change old orders. A wrong status, a body that is not a JSON object (or a missing `Content-Type: application/json`) or malformed JSON is `400`; a body over 10 KB is `413`.

Changing a status does **not** message the customer: the bot only replies inside Meta's 24-hour window and never writes first. Customers see their latest orders and statuses when they send `2` in Messenger.

## Messenger bot

The bot is set up in [`src/bot.js`](src/bot.js): shop name `Tangail Botiques`, the products from `src/data/products.js`, Redis when configured, replies only with `ENABLE_AUTO_REPLY=true`, and Vercel's `waitUntil` so replies finish after the webhook has answered. The webhook is mounted at `/api/webhooks/facebook` in `src/app.js`, before any body parser, because the signature is checked on the raw body.

What customers can type and tap, the order steps, the Bangla and English texts, and every reply rule are in the [package README](../packages/orderpilot/README.md). The customer texts live in `../packages/orderpilot/src/services/replyTexts.js`.

### Connect the Facebook Page

Meta renames dashboard items from time to time, so labels may differ slightly.

1. **Make the backend public.** Locally, start ngrok in a second terminal and copy its `https://` address. In production use your domain (see [Deploying](#deploying)).

   ```bash
   ngrok http 3000
   ```

2. **Set the webhook.** In your app at developers.facebook.com/apps, open the Messenger API settings (Use cases > Customize on the Messenger use case; older dashboards: Products > Messenger > Settings). Under Configure webhooks, set the Callback URL to `https://<your-domain>/api/webhooks/facebook` and the Verify token to your `META_VERIFY_TOKEN`, then click Verify and save. The server log shows `[webhook] verification succeeded`.
3. **Connect the Page and subscribe.** Under Generate access tokens, connect your Page. Then click Add Subscriptions and tick these fields:

   | Field | What arrives through it |
   | --- | --- |
   | `messages` | Typed messages and quick replies (quantity buttons, Confirm and Cancel, Next and Previous, the menu) |
   | `messaging_postbacks` | The **🛒 অর্ডার করুন** button on product cards, and Get Started |
   | `messaging_referrals` | Product links (`https://m.me/<page>?ref=ORDER_PRODUCT:P001`) opened in an existing chat |

4. **Page token and Page ID.** Generate a token for the Page on the same screen, copy it at once into `PAGE_ACCESS_TOKEN`, and put the Page's numeric ID into `FACEBOOK_PAGE_ID`. The surest way to find the ID: message the Page and read `pageId` in the `[webhook] event` log line.
5. **Turn replies on.** Set `ENABLE_AUTO_REPLY=true` and restart. The startup log says `Auto-reply: enabled`.

Steps 2 and 3 can also be done from code with the bot's `connect()`. Add `FACEBOOK_APP_ID` and `WEBHOOK_URL` (your full webhook URL) to `.env`, keep the server running, and run:

```bash
node --input-type=module -e "const { bot } = await import('./src/bot.js'); console.log(JSON.stringify(await bot.connect(), null, 2));"
```

While the app is in Development mode, Meta delivers events and replies only for people with a role on the app (App roles > Roles: admin, developer or tester). Everyone else needs App Review (see [Security](#security)).

### Test the webhook with curl

Load `.env` first (`set -a; source .env; set +a`).

Verification answers `200` with the challenge; a wrong token answers `403`:

```bash
curl -i "http://localhost:3000/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=CHALLENGE_ACCEPTED"
```

A signed delivery, the way Meta sends it. The signature is the HMAC-SHA256 of the exact body bytes with your App secret:

```bash
BODY='{"object":"page","entry":[{"id":"1234567890","time":1700000000000,"messaging":[{"sender":{"id":"1111111111"},"recipient":{"id":"1234567890"},"timestamp":1700000000000,"message":{"mid":"m_FAKE_1","text":"hi"}}]}]}'
```

```bash
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //')
```

```bash
curl -i --data-raw "$BODY" -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=$SIG" http://localhost:3000/api/webhooks/facebook
```

Expect `200 EVENT_RECEIVED`. The fake Page ID `1234567890` is not yours, so with replies on the event is ignored as `page_mismatch` and nothing goes to Meta. Without the header, with another signature or with a changed body the answer is `403`; signed non-JSON is `400`.

### Test a real order

From an account with a role on the app, message your Page:

1. `hi`: the welcome message and menu arrive.
2. `1`: five product cards, then page 1 of 10 with a Next button.
3. Tap **🛒 অর্ডার করুন** (or type `P001`), then answer quantity, phone (`01712345678`) and address.
4. Tap **✅ নিশ্চিত করুন**: the customer gets the order ID, for example `ORD-1001`, and the log has one `[Order] Order created` line.
5. `GET /api/orders` shows the order as `pending`. Tapping Confirm again answers with the same order ID and creates nothing new.

### Log lines

Logs never contain message text, phone numbers, addresses, payload values or tokens; sender IDs keep only their last 4 characters. A typical message:

```
[webhook] event {"type":"message","pageId":"1234567890","senderId":"…1111","mid":"m_1","textLength":2,"attachmentCount":0,"timestamp":1700000000000}
[webhook] received {"entries":1,"events":1,"skipped":0,"counts":{"message":1}}
[Messenger] Incoming customer message {"pageId":"1234567890","senderId":"…1111","mid":"m_1","kind":"text","payloadType":null,"textLength":2,"attachmentCount":0}
[AutoReply] Matching reply rule {"rule":"welcome","step":"IDLE"}
[SendAPI] Reply sent successfully {"senderId":"…1111","rule":"welcome","messageId":"m_2"}
```

| Line | Meaning |
| --- | --- |
| `[webhook] verification rejected: <reason>` / `event rejected: <reason>` | Meta's request was refused (reasons in [Troubleshooting](#troubleshooting)). |
| `[Messenger] Ignored event {"reason":...}` | Not answered on purpose: `page_mismatch`, `echo` or `self_sender` (the Page's own messages), `unsupported_event` (deliveries, reads, reactions), `duplicate` (seen in the last 10 minutes), `no_content`, `no_mid`, `no_payload`, `unsupported_referral`. |
| `[SendAPI] Reply failed {...}` | Meta refused the reply; `hint` names the usual cause and `fbtraceId` is for Meta support. |
| `[SendAPI] Catalog template failed, text fallback used` | The product cards were refused (usually an image URL); the customer got a text list. |
| `[SendAPI] Catalog navigation failed` / `Product photo failed, text sent without it` | Part of a reply failed; the rest was delivered. |
| `[Order] Order created {...}` | A new order: id, product, quantity and total only. |

## Tests

```bash
pnpm test
```

Node's built-in test runner runs `test/`. Meta's Graph API is mocked, so nothing leaves the machine, and the tests never read `.env` or use Redis, even when those are set in your shell. The bot's own tests run in the package (`pnpm test` in `../packages/orderpilot`).

| File | Covers |
| --- | --- |
| `app.test.js` | The assembled app: missing settings named once, `503` until fixed, the Page settings asked for only with replies on, the routes |
| `config.test.js` | The auto-reply switch, `ADMIN_API_KEY` and Redis settings |
| `adminAuth.test.js` | The `X-Admin-Key` check, constant-time comparison, the key never echoed |
| `products.api.test.js`, `productService.test.js`, `products.data.test.js` | The product API, its filters and errors, and the bundled catalog |
| `orders.api.test.js` | The orders API: `401` everywhere without the key, list, filter, get, `PATCH`, `400`, `404`, `413` |
| `webhook.test.js` | The mounted webhook: verification, signatures, `200` before replies, duplicates, replies off, Send API failures |
| `conversationFlow.test.js` | A whole order end to end through the webhook, the bot and the orders API |

## Deploying

### Vercel (free Hobby plan)

Vercel serves the app exported by `src/app.js` as one serverless function. Serverless instances share no memory, so Redis is required there: without it every request gets `503`.

1. Create a Vercel project from this repository with Root Directory `api`. The bot package sits outside it, so keep **Include source files outside of the Root Directory in the Build Step** switched on (the default).
2. Add Upstash for Redis from the project's Storage tab (free plan). It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Add `META_VERIFY_TOKEN`, `META_APP_SECRET`, `ADMIN_API_KEY` and, for replies, `ENABLE_AUTO_REPLY`, `PAGE_ACCESS_TOKEN` and `FACEBOOK_PAGE_ID` under Settings > Environment Variables.
4. Deploy, open `https://<project>.vercel.app/health`, and set the Meta Callback URL to `https://<project>.vercel.app/api/webhooks/facebook`. Preview URLs sit behind Vercel's login, so use the production domain.

The per-customer reply queue runs inside one instance, so two messages from one customer reaching two instances at the same moment are not ordered against each other. That is rare.

### A VPS

Set the variables in the server's environment (with a fresh `ADMIN_API_KEY`, not your laptop's), install with `pnpm install --frozen-lockfile --prod`, run `pnpm start` under pm2 or systemd, and put nginx or Caddy with HTTPS in front. The proxy must pass the request body through unchanged, or every signature check fails. Without Redis, run exactly one instance: a restart loses every order and conversation, and a second instance would keep separate ones.

## Troubleshooting

Start with the last log line for your request; locally, the ngrok inspector at http://127.0.0.1:4040 shows every request Meta sends.

| What you see | Cause | Fix |
| --- | --- | --- |
| `Missing or invalid settings: ...` and the server exits | A required variable is missing, a placeholder, or malformed (`ADMIN_API_KEY` under 16 characters, `ENABLE_AUTO_REPLY` not `true`/`false`, a non-numeric Page ID) | Fix the named variables in `.env` and start again. |
| `Port 3000 is already in use` | Another process has the port | Stop it (`lsof -i :3000`) or set another `PORT` (and use it in `ngrok http`). |
| Meta cannot verify the URL; `verification rejected: token_mismatch` | The verify token in Meta differs from `META_VERIFY_TOKEN` | Copy the exact value into both, restart. |
| Meta cannot reach the URL at all | Server or ngrok not running, `http://` used, or ngrok's address changed after a restart | Use the current `https://` address ending in `/api/webhooks/facebook`. |
| `403`, `event rejected: signature_mismatch` | Wrong App secret (not the Page token or verify token), stray characters in `.env`, or a proxy changed the body | Re-copy the App secret, restart, and make sure nothing rewrites the body. |
| `403`, `missing_signature` or `malformed_signature` | No `X-Hub-Signature-256: sha256=<64 hex>` header, or no `Content-Type: application/json` | Send both headers as in the curl example. |
| `404`, `event rejected: unsupported_object` | The app is subscribed to something other than a Page | Subscribe the Page object. |
| Verification works but no events arrive | Page not connected or fields not subscribed, the sender has no role on the app, or another Page was messaged | Redo steps 3 and 5 of Connect the Facebook Page; test from an account with a role. |
| Events arrive, but no `[Messenger]` line | `ENABLE_AUTO_REPLY` is not `true`, or `.env` changed without a restart | Set it and restart. Variables exported in your shell win over `.env`. |
| `Ignored event {"reason":"page_mismatch"}` | `FACEBOOK_PAGE_ID` is not the `pageId` in the `[webhook] event` line | Copy that `pageId` into `.env`, restart. |
| Typed messages work, but **🛒 অর্ডার করুন** does nothing | `messaging_postbacks` is not subscribed | Subscribe it. Meanwhile customers can type the product code. |
| A product link opens the chat without the product | `messaging_referrals` is not subscribed | Subscribe it. |
| `Reply failed`, hint `invalid_access_token` (code 190) | Page token wrong, expired, revoked or for another Page | Generate a new token, update `.env`, restart. |
| `Reply failed`, hint `permission_denied` (code 10 or 200) | The person has no role on the app, or `pages_messaging` lacks Advanced Access | Test with a tester; App Review for the public. |
| `Reply failed`, hint `outside_messaging_window` | The person's last message is over 24 hours old | They must write again; the bot never writes first. |
| `Reply failed`, hint `invalid_parameter` (code 100) | A fake recipient (like the curl example's), or Meta refused a card image | Test with a real message; check the image URLs. |
| `Reply failed`, reason `timeout` or `network` | Graph API not reachable within 10 seconds | Check the internet connection. Replies are never retried, so a customer never gets the same message twice. |
| `Catalog template failed, text fallback used` | A product image is not a public `https://` image, or a product has an invalid price | Fix `src/data/products.js`; `pnpm test` also catches bad data. |
| `401 Unauthorized` from `/api/orders` | `X-Admin-Key` missing or wrong; often `$ADMIN_API_KEY` is empty because `.env` was not loaded in this terminal | `set -a; source .env; set +a`, then retry. |
| Orders disappeared | The server restarted while storage was memory | Set the Upstash Redis variables. |

Give Meta support the `fbtraceId` from the log line and the time of the request, never a token.

## Security

- Secrets live only in environment variables. `.env` is git-ignored; `.env.example` holds placeholders only.
- Every webhook delivery's signature is checked on the raw body before anything is parsed. Signatures, the verify token and the admin key are compared in constant time.
- `/api/orders` checks `X-Admin-Key` before anything else, answers one identical `401` for every failure, and never logs or echoes the key. Rotate it by changing the value and restarting. The product API is public by design.
- Logs carry no message text, payload values, phone numbers, addresses, tokens or keys. Customers only ever see their own orders, without phone or address.
- The Page token travels only in the `Authorization` header and is redacted from Meta's error messages.
- The bot never writes first, never retries a reply, and confirms each order once: a repeated Confirm returns the same order.
- To answer the public, the Meta app needs Business Verification and Advanced Access to `pages_messaging` through App Review. Until then only people with a role on the app get replies.
- If a secret leaks, generate a new one, update the environment and restart.
