# OrderPilot Messenger Backend (Phase 3)

A small Node.js (Express 5) backend that lets Meta verify your **Callback URL**, receives **Facebook Messenger webhook events**, and **talks to customers automatically** through the Messenger **Send API**. Since Phase 3 it shows a product catalog inside Messenger and **collects orders** step by step (product, quantity, phone number, address, confirmation). It runs locally and is exposed to Meta through an ngrok HTTPS tunnel. It can be deployed to a VPS later.

**Phase 1 is in (unchanged):** webhook verification (`GET`), signed event receiver (`POST`, `messages` and `messaging_postbacks`), `/health`, startup env validation, safe logging.
**Phase 2 is in:** automatic replies through the Send API (opt-in with `ENABLE_AUTO_REPLY=true`), loop prevention, in-memory duplicate protection, Send API error hints in the logs, automated tests (`pnpm test`). The Phase 2 keyword rules are replaced by the Phase 3 conversation (section 15).
**Phase 3 is in:**

- A static catalog of **50 products** (ids `P001` to `P050`, 8 categories) and a public **REST product API** (section 14).
- The catalog inside Messenger as **generic-template cards, 5 per page**, each with an **🛒 অর্ডার করুন** postback button (section 15).
- **Order collection**: quantity, then phone number, then address, then a summary the customer confirms (section 15).
- **In-memory orders** and an **admin-protected orders API** (section 16).
- **30-minute conversation sessions**, one per customer.

**Still out:** database (orders, sessions and duplicate protection live in memory and are lost on every restart), payment, cart or multi-product orders, courier integration, inventory, dashboard or frontend, AI, proactive notifications (the bot never writes first), App Review / Advanced Access.

With `ENABLE_AUTO_REPLY=false` (the default) the Messenger side behaves exactly like Phase 1: it receives and logs webhook events and never replies. The product API and the orders API are always available, and the server will not start without `ADMIN_API_KEY` (section 2).

**The Messenger bot is a separate package.** The webhook, the conversation, the Send API client and the order, session and language stores live in [`../packages/orderpilot`](../packages/orderpilot/README.md), an npm package any Node.js app can install. This backend uses it through a local link (`"orderpilot": "link:../packages/orderpilot"` in `package.json`) and sets it up in `src/bot.js` with our 50 products, our shop name and Upstash Redis. Everything below works exactly as before; only the file locations changed. Paths starting with `orderpilot/` mean `../packages/orderpilot/`.

Upgrading from Phase 2: no new dependencies, so `pnpm install` is not needed. Add `ADMIN_API_KEY` to your `.env` (section 2) and make sure the app is subscribed to `messaging_postbacks` (section 8), because the 🛒 অর্ডার করুন and Confirm buttons arrive as postbacks.

## Project structure

```
.
├── src/
│   ├── app.js                     # Express app (Vercel entry): env checks, /health, routes, 404 and error handlers
│   ├── server.js                  # local/VPS entry: env and PORT checks, then listens
│   ├── loadEnv.js                 # loads .env before anything reads process.env
│   ├── config.js                  # env helpers: auto-reply flag, Send API settings, ADMIN_API_KEY and Redis checks
│   ├── bot.js                     # the Messenger bot: createOrderPilot() with our products, shop name and Redis
│   ├── data/
│   │   └── products.js            # the static catalog: 50 products, 8 categories (edit this file to change products)
│   ├── middleware/
│   │   └── adminAuth.js           # X-Admin-Key check that protects /api/orders
│   ├── routes/
│   │   ├── facebookWebhook.js     # the bot's webhook (GET verification + signed POST events), mounted by app.js
│   │   ├── products.js            # GET /api/products and /api/products/:id (public)
│   │   └── orders.js              # /api/orders over the bot's orders (admin key required)
│   ├── services/
│   │   └── productService.js      # product lists and lookup by id for the REST API
│   └── utils/
│       └── safeEqual.js           # constant-time string comparison
├── test/
│   ├── adminAuth.test.js          # X-Admin-Key middleware, constant-time comparison
│   ├── config.test.js             # ADMIN_API_KEY and Redis startup validation
│   ├── conversationFlow.test.js   # a whole order end to end: webhook, bot, Send API (mocked), orders API
│   ├── orders.api.test.js         # /api/orders over HTTP
│   ├── productService.test.js     # product lists, filters, lookup by id
│   ├── products.api.test.js       # /api/products over HTTP
│   ├── products.data.test.js      # invariants of the 50-product catalog
│   └── webhook.test.js            # the mounted webhook: signature, 200 before processing, replies
├── .env                           # your secrets (git-ignored, never commit)
├── .env.example                   # template, safe to commit
├── .gitignore
├── package.json
├── pnpm-lock.yaml                 # created by `pnpm install`, commit it
└── README.md

../packages/orderpilot/            # the Messenger bot package (see its README)
├── src/
│   ├── index.js                   # public API: createOrderPilot(), productLink(), texts, payloads, stores
│   ├── orderPilot.js              # createOrderPilot(): wires settings, stores, catalog, Send API client and webhook
│   ├── config.js                  # settings: an option, else the environment variable (read on every call)
│   ├── webhook.js                 # GET verification + signed POST receiver, Express/node:http and fetch adapters
│   ├── connect.js                 # connect(): app webhook, Page subscription, Get Started button
│   ├── catalog.js                 # products from an array or a (database) function, Messenger pages of 5
│   ├── graph.js                   # the Graph API request (token in the header only, error hints)
│   ├── services/                  # autoReplyService, conversationService, messengerService, replyTexts,
│   │                              # quickReplies, payloads, language, dedupeCache, redisDedupeCache
│   ├── store/                     # orders, sessions and languages, each in memory and in Redis
│   └── utils/                     # keyedQueue, maskId, normalizeText, safeEqual, validators
└── test/                          # the bot's own tests (Meta API mocked)
```

Requirements: Node.js 20 or newer and [pnpm](https://pnpm.io/installation) 10 or newer. Run every command below from the project root (the folder that contains `package.json`).

If `pnpm` is not installed yet, enable it through Corepack (ships with Node) or install it with Homebrew:

```bash
corepack enable pnpm
```

```bash
brew install pnpm
```

---

## 1. Install dependencies

```bash
pnpm install
```

If it seems to freeze, press Ctrl+C and run it again with `pnpm install --reporter=append-only` to see which step it is stuck on (see section 19).

## 2. Configure `.env`

The local `.env` already exists with a generated random `META_VERIFY_TOKEN` and a generated `ADMIN_API_KEY`. If you ever need to create it again:

```bash
cp .env.example .env
```

| Variable | Value |
| --- | --- |
| `PORT` | `3000` (ngrok and the curl examples below assume this) |
| `META_VERIFY_TOKEN` | A random string you invent. You type the same string into Meta's webhook settings. |
| `META_APP_SECRET` | Your Meta app's **App secret**: Meta Developers, your app, **App settings > Basic > App secret** (click Show). Used to validate the `X-Hub-Signature-256` header. |

Generate a verify token (either command works):

```bash
openssl rand -hex 24
```

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Paste your real App secret into `META_APP_SECRET`.

**Phase 2 variables** (automatic replies):

| Variable | Purpose | Where to get it | Default |
| --- | --- | --- | --- |
| `ENABLE_AUTO_REPLY` | Opt-in switch. `true` turns automatic replies on, `false` keeps Phase 1 behaviour (receive and log only). Only `true` or `false` are accepted. | You choose. | unset = `false` |
| `PAGE_ACCESS_TOKEN` | Page access token used to call the Send API. Treat it like a password. | Section 10. | none (required when `ENABLE_AUTO_REPLY=true`) |
| `FACEBOOK_PAGE_ID` | ID of the Facebook Page that receives the messages (digits only). | Section 11. | none (required when `ENABLE_AUTO_REPLY=true`) |
| `META_GRAPH_API_VERSION` | Graph API version used for Send API calls, format `vNN.N`. | Section 11. | `v26.0` |
| `DETECT_LANGUAGE` | `false` turns off reading a new customer's Facebook language; everyone then starts in Bangla. Any other value (or unset) leaves it on. See "Language (বাংলা / English)" in section 15. | You choose. | on |

**Phase 3 variable** (orders API):

| Variable | Purpose | Where to get it | Default |
| --- | --- | --- | --- |
| `ADMIN_API_KEY` | Secret that protects `/api/orders` (customer phone numbers and addresses). Callers send it in the `X-Admin-Key` header. At least 16 characters, and not a `replace_with_...` placeholder. | You generate it: `openssl rand -hex 24` (48 hex characters). | none. **Always required**, even with `ENABLE_AUTO_REPLY=false`: the server refuses to start without a valid one. |

Generate an admin key:

```bash
openssl rand -hex 24
```

The local `.env` already got a freshly generated `ADMIN_API_KEY` appended when Phase 3 was added; its value was never printed. To use it, read it from your own `.env`: load the file into your shell (the same command as in section 5) and then use `$ADMIN_API_KEY` in the curl commands of section 16:

```bash
set -a; source .env; set +a
```

If you would rather load only that one variable:

```bash
export ADMIN_API_KEY=$(grep '^ADMIN_API_KEY=' .env | cut -d= -f2-)
```

To check that the line exists without showing the key (prints `1`):

```bash
grep -c '^ADMIN_API_KEY=' .env
```

Never paste the admin key into chat, tickets, screenshots or documentation, never put it in a URL, and never commit it (`.env` is git-ignored). Do not run `echo $ADMIN_API_KEY`, or anything else that prints it, while sharing your screen.

Write values without quotes, spaces or a trailing space. A complete `.env` looks like this:

```
PORT=3000
META_VERIFY_TOKEN=<paste-the-generated-token>
META_APP_SECRET=<paste-your-meta-app-secret>
ENABLE_AUTO_REPLY=false
PAGE_ACCESS_TOKEN=replace_with_page_access_token
FACEBOOK_PAGE_ID=replace_with_page_id
META_GRAPH_API_VERSION=v26.0
ADMIN_API_KEY=<paste-a-generated-key>
```

How the switch works:

- `ENABLE_AUTO_REPLY=false` (or unset): Phase 1 behaviour. The webhook is received, validated and logged, and no reply is ever sent. `PAGE_ACCESS_TOKEN` and `FACEBOOK_PAGE_ID` are not checked and may stay as placeholders.
- `ENABLE_AUTO_REPLY=true`: `PAGE_ACCESS_TOKEN` and `FACEBOOK_PAGE_ID` must hold real values and `META_GRAPH_API_VERSION` must be unset or look like `v26.0`. Otherwise the server refuses to start.
- When Phase 2 was added, the local `.env` was extended with `ENABLE_AUTO_REPLY=false` and the two `replace_with_...` placeholders, so the existing setup keeps starting until you fill in the real values (sections 10 and 11) and switch the flag to `true`. If you create `.env` again from `.env.example`, check `ENABLE_AUTO_REPLY` first: with `true` the server will not start until the token and Page ID are real. Also replace the `ADMIN_API_KEY` placeholder with a generated key.

The server refuses to start (exit code 1) if `META_VERIFY_TOKEN` or `META_APP_SECRET` is missing, empty, or still the `replace_with_...` placeholder. The same applies to `ADMIN_API_KEY`, which must also be at least 16 characters long. With `ENABLE_AUTO_REPLY=true` the same applies to `PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID` (digits only) and a malformed `META_GRAPH_API_VERSION`. Any `ENABLE_AUTO_REPLY` value other than `true` or `false` (for example `yes`, `1` or `on`) is rejected too, so a typo can never silently enable replies. It prints, for example, `Invalid or missing environment variables: META_APP_SECRET, ADMIN_API_KEY. See .env.example.` (names only, never values). Restart the server after every `.env` change.

## 3. Start the backend

Development (restarts on code changes):

```bash
pnpm dev
```

Production-style start:

```bash
pnpm start
```

The server listens on `http://localhost:3000` and prints `OrderPilot backend listening on http://localhost:3000` followed by one auto-reply status line: `Auto-reply: enabled (Graph API v26.0)` or `Auto-reply: disabled (set ENABLE_AUTO_REPLY=true to enable)`. The line never contains the token, the Page ID or the admin key. Keep this terminal open.

> **Orders live in memory.** `pnpm dev` restarts the server whenever you save a source file, and every restart deletes all orders and conversation sessions (section 16). Use `pnpm start` while you test the ordering flow, or expect to lose test orders when you edit code.

## 4. Test `GET /health`

```bash
curl -i http://localhost:3000/health
```

Expected: `200 OK` with body:

```json
{"success":true,"message":"OrderPilot backend is running"}
```

Unknown paths return `404`:

```bash
curl -i http://localhost:3000/does-not-exist
```

```json
{"success":false,"message":"Not found"}
```

## 5. Test webhook verification with curl

The examples read the token from `.env`. Load it into your current shell once (bash/zsh; or skip this and paste the token value in place of `$META_VERIFY_TOKEN`):

```bash
set -a; source .env; set +a
```

**Successful verification** (valid mode and token). Expect `200`, `Content-Type: text/plain`, and a body of exactly `CHALLENGE_ACCEPTED`:

```bash
curl -i "http://localhost:3000/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=CHALLENGE_ACCEPTED"
```

**Wrong token.** Expect `403 Forbidden`:

```bash
curl -i "http://localhost:3000/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=CHALLENGE_ACCEPTED"
```

**Wrong mode.** Expect `403 Forbidden`:

```bash
curl -i "http://localhost:3000/api/webhooks/facebook?hub.mode=unsubscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=CHALLENGE_ACCEPTED"
```

**Missing params.** Expect `403 Forbidden`:

```bash
curl -i "http://localhost:3000/api/webhooks/facebook"
```

The server log shows only a reason code (for example `verification rejected: token_mismatch`), never the token.

## 6. Install and use ngrok

Meta can only call a public **HTTPS** URL, so ngrok tunnels it to your laptop.

1. Create a free account: <https://dashboard.ngrok.com/signup>
2. Install the agent. macOS:

   ```bash
   brew install ngrok
   ```

   Other OS (Windows, Linux, direct download): <https://ngrok.com/download>

3. Add your authtoken (copy it from <https://dashboard.ngrok.com/get-started/your-authtoken>):

   ```bash
   ngrok config add-authtoken <your-ngrok-authtoken>
   ```

4. With the backend running (section 3), open a second terminal and start the tunnel:

   ```bash
   ngrok http 3000
   ```

5. Copy the **https** `Forwarding` URL, for example `https://abc-123.ngrok-free.dev`. That is `<your-ngrok-domain>` in the next sections.

Check it works through the tunnel:

```bash
curl -i https://<your-ngrok-domain>/health
```

Notes:

- Random tunnel URLs change every time ngrok restarts, and then you must update the Callback URL in Meta. Free ngrok accounts also get a free, stable dev domain (shown on the **Domains** page of the ngrok dashboard; the exact menu name may change). To always use it:

  ```bash
  ngrok http 3000 --url https://<your-free-ngrok-dev-domain>
  ```

- Open <http://127.0.0.1:4040> (ngrok's local inspector) to see every request Meta sends, with status codes. It is the fastest way to debug.
- Keep both the backend and ngrok running while you configure Meta.
- The tunnel also exposes your product API and your orders API to the internet. The orders API needs the admin key (section 16); the product API is public by design (section 14).

## 7. Configure the Callback URL and Verify Token in Meta Developers

Meta renames dashboard items from time to time, so the exact labels may differ slightly from the ones below.

1. Open your app at <https://developers.facebook.com/apps>. Keep it in **Development** mode while you test.
2. Go to the Messenger setup of the app: in the current dashboard this is **Use cases > Customize** on the "Engage with customers on Messenger from Meta" use case, then the **Messenger API settings** (Meta's docs call this section "Messenger API Setup"). Older dashboards show **Products > Messenger > Settings**.
3. In **Configure webhooks**, fill in:
   - **Callback URL**: `https://<your-ngrok-domain>/api/webhooks/facebook`
   - **Verify token**: the exact value of `META_VERIFY_TOKEN` from your `.env`
4. Click **Verify and save** (it may just say **Save**). Meta sends a `GET` request to your URL. The backend must be running and ngrok must stay up while you click.
5. Success: the dashboard accepts the URL and your server log shows `verification succeeded`. If it fails, see section 19.

Other values:

- **App secret** (for `META_APP_SECRET`): **App settings > Basic > App secret**.
- **Page access token** (for `PAGE_ACCESS_TOKEN`): only needed when `ENABLE_AUTO_REPLY=true`. See section 10.
- **Page ID** (for `FACEBOOK_PAGE_ID`): only needed when `ENABLE_AUTO_REPLY=true`. See section 11.

## 8. Subscribe to `messages` and `messaging_postbacks`

In the same Messenger API settings screen (the exact labels may differ):

1. Connect your Facebook Page to the app: in **Generate access tokens**, click **Connect** (some dashboards say **Add or remove Pages**), log in and select the Page. You need a role on that Page.
2. Click **Add Subscriptions**, tick the **Page** webhook fields **`messages`** and **`messaging_postbacks`**, then **Confirm**/**Save**.
3. If you use the separate **Webhooks** product instead, pick the **Page** object and subscribe to the same two fields there. You can also install the app on the Page in Meta Business Suite under **All tools > Business apps**.

Development mode: while the app has only Standard Access, Meta delivers events only for people who have a role on the app (admin, developer or tester; add them under **App roles > Roles** and have them accept). Events from the general public need Advanced Access via App Review, which is outside Phases 1 to 3. The same applies to replies: the Page can only answer people who have a role on the app (see section 10).

**Both fields are required for the ordering flow:**

| Field | What arrives through it |
| --- | --- |
| `messages` | Text messages and **quick replies** (the `◀ আগের`, `পরের ▶` and `🏠 মেনু` buttons under the catalog arrive as messages that carry a payload) |
| `messaging_postbacks` | **Postback buttons**: `🛒 অর্ডার করুন` on a product card, and `✅ নিশ্চিত করুন` / `❌ বাতিল` under the order summary (and the Page's Get Started button, if you set one up) |
| `messaging_referrals` | Optional: **product links** (`https://m.me/<page>?ref=ORDER_PRODUCT:P001`) opened by a customer who already chatted with the Page (section 15, "Product links for Facebook posts") |

Without `messaging_postbacks` the bot still answers typed messages and the `পরের ▶` quick replies, but tapping `🛒 অর্ডার করুন` or `✅ নিশ্চিত করুন` does nothing. (Customers can still order by typing a product code such as `P001` and confirming with `1`.) Subscribing to `message_echoes` is optional: echoes are copies of the messages your Page sends, and the server ignores them (they are logged as ignored, never answered). Delivery, read and reaction events are also ignored.

Test with a real event: from a Facebook account that has a role on the app, send a message to the connected Page. The server log shows a `message` event with a masked sender ID and the text length, but not the text. Postbacks only arrive when someone taps a button the Page offers, so use section 9 to test postbacks without Messenger, or tap `🛒 অর্ডার করুন` in section 17.

## 9. Verify POST requests with a valid test signature

Meta signs every `POST`. The header `X-Hub-Signature-256: sha256=<hex>` is the HMAC-SHA256 of the **exact raw request body**, keyed with your App secret. This flow fakes that, so you can test without Meta (bash/zsh with `openssl`; on Windows use Git Bash or WSL).

Load `.env` into your shell:

```bash
set -a; source .env; set +a
```

Put a sample `messages` event (fake IDs and text) in a variable:

```bash
BODY='{"object":"page","entry":[{"id":"1234567890","time":1700000000000,"messaging":[{"sender":{"id":"1111111111"},"recipient":{"id":"1234567890"},"timestamp":1700000000000,"message":{"mid":"m_FAKE_MESSAGE_ID_1","text":"fake test message"}}]}]}'
```

Compute the signature (prints 64 hex characters):

```bash
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //')
```

Send it:

```bash
curl -i --data-raw "$BODY" -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=$SIG" http://localhost:3000/api/webhooks/facebook
```

Expected: `200 OK` with body `EVENT_RECEIVED`, and server log lines similar to:

```
[webhook] event {"type":"message","pageId":"1234567890","senderId":"…1111","mid":"m_FAKE_MESSAGE_ID_1","textLength":17,"attachmentCount":0,"timestamp":1700000000000}
[webhook] received {"entries":1,"events":1,"skipped":0,"counts":{"message":1}}
```

With `ENABLE_AUTO_REPLY=true` the same request is also processed for auto-reply after the `200`. The sample uses the fake Page ID `1234567890`, so unless that is your real `FACEBOOK_PAGE_ID` the event is ignored with `reason":"page_mismatch"` and nothing is sent to Meta. If you replace it with your real Page ID, the server will try to answer the fake sender `1111111111` and log a harmless `[SendAPI] Reply failed` (Meta cannot deliver to a fake user). Use section 17 to test real replies.

Now a `messaging_postbacks` event. Replace `BODY`, then re-run the `SIG=...` command and the `curl` command above:

```bash
BODY='{"object":"page","entry":[{"id":"1234567890","time":1700000000000,"messaging":[{"sender":{"id":"1111111111"},"recipient":{"id":"1234567890"},"timestamp":1700000000000,"postback":{"mid":"m_FAKE_POSTBACK_ID_1","title":"Get Started","payload":"FAKE_PAYLOAD"}}]}]}'
```

Expected log: a `postback` event with `"hasPayload":true`. The payload value itself is never logged. With auto-reply on and a matching Page ID, a postback whose payload the bot does not know (like `FAKE_PAYLOAD`) is answered with the welcome menu, the same way as `GET_STARTED`.

### Failing cases

Run these with the `BODY` and `SIG` from above still set. Each one must return `403` (the last returns `400`).

No signature header:

```bash
curl -i --data-raw "$BODY" -H 'Content-Type: application/json' http://localhost:3000/api/webhooks/facebook
```

Wrong signature:

```bash
curl -i --data-raw "$BODY" -H 'Content-Type: application/json' -H 'X-Hub-Signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000' http://localhost:3000/api/webhooks/facebook
```

Valid signature but the body changed by one trailing space:

```bash
curl -i --data-raw "$BODY " -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=$SIG" http://localhost:3000/api/webhooks/facebook
```

Valid signature over a body that is not JSON. Expect `400`, because the signature is checked first and the JSON afterwards:

```bash
curl -i --data-raw '{not json' -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=$(printf '%s' '{not json' | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //')" http://localhost:3000/api/webhooks/facebook
```

> **Warning:** the signature covers the exact bytes. ANY change to the body (whitespace, a newline, key order, pretty-printing, re-serializing parsed JSON) produces a different signature. That is why the server validates the raw body before parsing it, and why a proxy or middleware that rewrites the body breaks validation. Real Meta payloads escape non-ASCII characters as `\uXXXX`; this works as long as you hash the bytes exactly as received.

### Cross-platform alternative (Node 20.6+)

Instead of `openssl`, compute the signature with Node, reading the secret from `.env`. Save the sample JSON as `payload.json` (for example `printf '%s' "$BODY" > payload.json`, or paste it into a file with your editor), then:

```bash
node --env-file=.env -e "const c=require('crypto');const b=require('fs').readFileSync(process.argv[1]);console.log(c.createHmac('sha256',process.env.META_APP_SECRET).update(b).digest('hex'))" payload.json
```

Send the same file with `--data-binary` (plain `-d @file` strips newlines and would break the signature). Replace `<hex-from-above>` with the printed value:

```bash
curl -i --data-binary @payload.json -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=<hex-from-above>" http://localhost:3000/api/webhooks/facebook
```

## 10. Configure `PAGE_ACCESS_TOKEN`

The Page access token lets your backend call the Send API as your Page. It needs the `pages_messaging` permission and must be requested by a person who can perform the `MESSAGING` task on the Page. Meta renames dashboard items from time to time, so the labels below may differ slightly.

1. Open the Messenger API settings of your app (section 7, step 2).
2. In **Generate access tokens**, click **Connect** and select your Page (skip this if the Page is already connected from section 8). You need a role on that Page.
3. Generate a token for that Page and copy it right away. Meta's quick start describes picking the Page and getting a token in a **Page Access Token** field, and says the dashboard does not store it. Each new generation creates a new token, and earlier tokens keep working. The button next to a connected Page may be labelled differently in your dashboard (for example **Generate**).
4. Paste it into `.env` (no quotes, no spaces):

   ```
   PAGE_ACCESS_TOKEN=<paste-the-page-access-token>
   ```

5. Set `ENABLE_AUTO_REPLY=true` and restart the server (section 3).

Alternative: in the Graph API Explorer (<https://developers.facebook.com/tools/explorer>) choose your app, generate a User access token with `pages_show_list` and `pages_messaging`, then call `GET /me/accounts`. Each Page in the response has an `id` (the Page ID, section 11) and an `access_token` (the Page access token).

Rules for the token:

- Treat it like a password. Keep it only in `.env` or the server's environment. Never commit it, put it in a URL, paste it into chat, tickets or screenshots, or log it. This backend sends it only in the `Authorization` header and never logs it.
- If it leaks, generate a new token, update the environment and restart. User-backed tokens can be invalidated by actions of the person who generated them (per Meta's best practices), and Meta's quick start says earlier tokens keep working after a new one is generated, so also revoke the leaked one through the account that created it.
- Development mode: until the app passes App Review, Page tokens only work with people who have a role on the app (Administrator, Developer or Tester, added under **App roles > Roles**). Only those people get webhook events and automatic replies. Everyone else gets nothing.
- Production: Meta recommends a stable token backed by a system user (a business) instead of a personal one, because a personal token can be invalidated by user actions. That is outside Phase 3.
- A wrong, expired or revoked token shows up as `[SendAPI] Reply failed` with the hint `invalid_access_token` (section 20).

## 11. Configure `FACEBOOK_PAGE_ID` and `META_GRAPH_API_VERSION`

**`FACEBOOK_PAGE_ID`** is the numeric ID of the Facebook Page that receives the messages. Digits only. It must be the same Page that you connected in section 8 and that the token belongs to. It is not the app ID, the business ID or a personal profile ID.

Ways to find it (the first one is the most reliable):

1. Send a message from an account with an app role to your Page and read the `pageId` field of the `[webhook] event` log line (section 9 shows the format). This works even with `ENABLE_AUTO_REPLY=false`.
2. On the Facebook Page, open **About** (the **Page transparency** area often shows the Page ID), or use the Page settings in Meta Business Suite. The labels vary by version.
3. Call `GET /me/accounts` in the Graph API Explorer (section 10) and read the `id` field of your Page.

If `FACEBOOK_PAGE_ID` differs from the `pageId` Meta sends, every event is ignored with `"reason":"page_mismatch"` and no reply is sent.

**`META_GRAPH_API_VERSION`** is optional. The default is `v26.0`, the current Graph API version (released 2026-07-29). The format is `v` plus major and minor number (`v26.0`). A malformed value stops the server at startup when `ENABLE_AUTO_REPLY=true`. Meta supports every version for a limited time, so check the [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog) before pinning an older one, and raise the value before your version expires.

## 12. How automatic replies work

With `ENABLE_AUTO_REPLY=true`, each webhook request goes through these steps:

1. **Signature check.** `X-Hub-Signature-256` is validated on the raw body first (section 9). An invalid request gets `403` and never reaches the reply code.
2. **`200 EVENT_RECEIVED` immediately.** After validation and the normal `[webhook]` logging, the server answers Meta at once, because Meta expects a quick `200`.
3. **Asynchronous processing.** Only after the response has been sent, each event is checked, one filter after another. An event that fails a filter is skipped and logged as `[Messenger] Ignored event {"reason":"<code>"}` (no message content).
4. **Duplicate check** by message id (see "Why duplicates are filtered" below).
5. **One customer at a time.** Events of the same customer on the same Page are queued and handled strictly one after another, in arrival order (section 15). Different customers are handled at the same time.
6. **Conversation.** The conversation engine decides what to answer from the customer's current step and what they sent: a typed message, a quick reply or a postback button (section 15). It returns one or more replies.
7. **Send API.** Each reply goes out as `POST https://graph.facebook.com/<version>/<page-id>/messages` with `messaging_type` `RESPONSE`, the token in the `Authorization` header and a 10 second timeout. A reply is plain text (with quick-reply buttons where needed), a carousel of product cards (a *generic template*), or the order summary with two buttons (a *button template*). If a reply fails, the remaining replies of that event are not sent. There are no retries, because after a timeout the server cannot know whether Meta already delivered the message, and a retry could send the customer the same reply twice.

Filters, in the order they run:

| # | Skipped when | `reason` in the log |
| --- | --- | --- |
| 1 | The Page ID in the event is not `FACEBOOK_PAGE_ID` | `page_mismatch` |
| 2 | The event is not an object, has no sender, the sender is the Page itself, or the recipient is a different Page | `invalid_event`, `no_sender`, `self_sender`, `recipient_mismatch` |
| 3 | It is neither a customer message nor a postback: delivery, read, reactions and so on | `unsupported_event` |
| 4 | It is an echo, a copy of a message the Page itself sent | `echo` |
| 5 | A message has no message id (`mid`), or a postback has no payload | `no_mid`, `no_payload` |
| 6 | The same `mid` was already seen in the last 10 minutes (postbacks without a `mid` are identified by sender, timestamp and payload) | `duplicate` |
| 7 | The message has no text, no attachment and no quick-reply payload | `no_content` |

Because the Page's own messages are never answered (filters 2 and 4; Meta echoes carry the Page as the sender), a reply can never trigger another reply, so there is no loop. The bot also never sends anything on its own: every reply answers a customer message or button tap (section 13).

Which rule answers a message is described in section 15.

### Log lines

For a customer message `Hello` the logs look like this (fake IDs; sender IDs are masked to their last 4 characters, and message text is never logged):

```
[webhook] event {"type":"message","pageId":"1234567890","senderId":"…1111","mid":"m_FAKE_MESSAGE_ID_1","textLength":5,"attachmentCount":0,"timestamp":1700000000000}
[webhook] received {"entries":1,"events":1,"skipped":0,"counts":{"message":1}}
[Messenger] Incoming customer message {"pageId":"1234567890","senderId":"…1111","mid":"m_FAKE_MESSAGE_ID_1","kind":"text","payloadType":null,"textLength":5,"attachmentCount":0}
[AutoReply] Matching reply rule {"rule":"welcome","step":"IDLE"}
[SendAPI] Reply sent successfully {"senderId":"…1111","rule":"welcome","messageId":"m_FAKE_REPLY_ID_1"}
```

- `kind` is `text`, `quick_reply`, `postback` or `attachment`. `payloadType` is only the type prefix of a button payload (for example `ORDER_PRODUCT`, or `unknown`), never the full value; it is `null` for typed text.
- `rule` is the name of the reply (section 15 lists them). `step` is where the customer's conversation **is after** this event (for example `WAITING_FOR_QUANTITY` after `order_start`, `IDLE` after `order_confirmed`; `null` for attachments, which never touch the session).
- Product cards and the order summary add `"mode":"template"` to the success line (`"mode":"text_fallback"` when the template was replaced by plain text).
- A confirmed order adds one more line before the success line, `[Order] Order created {"orderId":"ORD-1001",...}`. Section 17 shows complete examples.

When Meta rejects the reply, the last line becomes an error line instead. `hint` is a short label for the most common causes (section 20), `fbtraceId` is the ID to quote to Meta support:

```
[SendAPI] Reply failed {"senderId":"…1111","rule":"welcome","reason":"graph_error","status":400,"code":190,"subcode":null,"hint":"invalid_access_token","fbtraceId":"FAKE_TRACE_ID_1"}
```

A skipped event logs one line with the reason only:

```
[Messenger] Ignored event {"reason":"duplicate"}
```

Three more warning lines tell you about templates: `[SendAPI] Catalog template failed, text fallback used` (Meta rejected the cards, the customer got a text list instead), `[SendAPI] Order summary template failed, text fallback used` (Meta rejected the Confirm / Cancel buttons, the customer got the summary as plain text) and `[SendAPI] Catalog navigation failed` (the cards were delivered but the Next / Previous message was not). They carry only `reason`, `hint` and `code`. See section 20.

An unexpected programming error logs `[AutoReply] Unexpected error {"name":"<ErrorName>"}` (error name only). In every case the webhook has already answered `200` and the server keeps running.

Logs never contain what the customer typed. That matters more since Phase 3, because customers now type phone numbers and addresses. Orders log only the order id, product id, quantity and total.

### Why duplicates are filtered

Meta retries a webhook delivery when it does not get a quick `200`, and it can deliver the same message more than once. Without a check the customer would receive the same reply several times, and a repeated `Confirm` could create a second order. The server therefore remembers each message `mid` before sending and skips repeats (`Ignored event ... duplicate`). On top of that, every order summary carries its own one-time draft id, so even a repeat that gets past this cache cannot create a second order (section 15).

Limits of this in-memory cache:

- It lives in memory: 10 minute TTL, at most 5000 ids (the oldest are dropped first).
- It is lost on every restart, so a retry that arrives after a restart can be answered again.
- It is not shared between instances. Two server processes behind a load balancer would both answer.

For production you need persistent deduplication, for example a database unique constraint on the message id, or a Redis `SET key value NX EX <seconds>` with a TTL, plus a job queue so failed sends can be retried safely without answering twice.

## 13. Meta's 24-hour messaging window

Meta's standard messaging rules let a business message a person only within 24 hours after that person's last message (Meta's docs say the window lasts 24 hours for most user actions, and up to 7 days when the conversation starts from a Click-to-Messenger or Click-to-Direct ad). Every reply of this backend is sent immediately after the customer writes or taps a button, so it always fits the window, and it is sent with `messaging_type: RESPONSE`.

| Case | What Meta allows | This backend |
| --- | --- | --- |
| Reply within the window | `messaging_type` `RESPONSE` | All replies: prompts, product cards, order summary and confirmation |
| Message after the window | Only with an allowed message tag for a non-promotional use case, or another approved mechanism. For promotional content Meta points to Sponsored Messages or One-Time Notifications. | Not implemented. The bot never messages first, and a late send fails (hint `outside_messaging_window`, section 20). |
| `HUMAN_AGENT` tag | Lets a business representative respond manually within 7 days | Never use it for automated messages. It is meant for a real human agent replying by hand. |
| `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE` tags | Since 2026-04-27 requests with these tags return error code 100 | Not used |

Consequence: **changing an order's status through the orders API does not message the customer** (section 16). A status update sent more than 24 hours after the customer's last message would need one of the approved mechanisms above, so plan for that before building order notifications. Customers see the current status of their own latest orders when they send `2` (আমার অর্ডারের তথ্য). Meta changes these rules from time to time, so check the current documentation: <https://developers.facebook.com/docs/messenger-platform/send-messages>.

## 14. Product catalog and REST API

The catalog is a plain list of **50 products** (`P001` to `P050`) in **8 categories**: Saree, Three Piece, Kurti, Panjabi, T-Shirt, Shirt, Hijab and Women's Dress. It lives in `src/data/products.js` and is loaded when the server starts. There is no database. The products are interleaved by category, so every Messenger page of 5 cards shows a mix.

A product looks like this:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | `P001` to `P050`. Unique. Customers can type it (section 15). |
| `name` | string | Card title. Messenger shows `Name – ৳Price`; a long name is shortened to fit 80 characters, the price is always kept. |
| `description` | string | Card subtitle. Keep it at 80 characters or less (Messenger cuts longer text). |
| `category` | string | One of the 8 categories. |
| `price` | integer | Whole taka (BDT), no decimals. |
| `currency` | string | `BDT` |
| `imageUrl` | string | Public HTTPS image used on the card. |
| `available` | boolean | `false` hides the product from Messenger. The REST API still lists it. |

The product API is **public** (no key), because the data is the same catalog every customer sees. Do not put anything private in `src/data/products.js`.

### `GET /api/products`

Query parameters (all optional):

| Parameter | Rule | Default |
| --- | --- | --- |
| `page` | whole number, 1 or more | `1` |
| `limit` | whole number from 1 to 50 | `10` |
| `category` | one of the 8 categories, case-insensitive, whole name (`saree`, `three piece`, `Women's Dress`) | all categories |
| `search` | up to 100 characters; case-insensitive text that must appear in the name, the description or the category | no search |

Filters combine (both must match). `total` and `totalPages` are counted after the filters. A page beyond the end is still `200` with an empty `data` array and the correct totals, and a search with no match gives `total` 0 and `totalPages` 1.

```bash
curl -i http://localhost:3000/api/products
```

Expected: `200 OK` with this shape (the first of the 10 products is shown):

```json
{
  "success": true,
  "data": [
    {
      "id": "P001",
      "name": "Red Banarasi Style Silk Saree",
      "description": "Rich red silk-blend saree with golden zari border, made for weddings.",
      "category": "Saree",
      "price": 6200,
      "currency": "BDT",
      "imageUrl": "https://images.unsplash.com/photo-1618901185975-d59f7091bcfe?auto=format&fit=crop&w=800&h=800&q=80",
      "available": true
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 50, "totalPages": 5 }
}
```

The real response is compact JSON on a single line. More examples follow. The second page, five products per page:

```bash
curl -i "http://localhost:3000/api/products?page=2&limit=5"
```

One category (the name is case-insensitive; encode spaces as `%20`):

```bash
curl -i "http://localhost:3000/api/products?category=Saree"
```

```bash
curl -i "http://localhost:3000/api/products?category=three%20piece"
```

```bash
curl -i "http://localhost:3000/api/products?category=Women%27s%20Dress"
```

Search, and a search combined with a category and paging:

```bash
curl -i "http://localhost:3000/api/products?search=cotton"
```

```bash
curl -i "http://localhost:3000/api/products?category=Kurti&search=cotton&page=1&limit=3"
```

Invalid input gives `400` with `{"success":false,"message":"..."}`:

| Request | `message` |
| --- | --- |
| `?page=0`, `?page=abc`, `?page=1.5`, or `page` given twice | `page must be an integer of 1 or more` |
| `?limit=0`, `?limit=100`, `?limit=abc`, or `limit` given twice | `limit must be an integer between 1 and 50` |
| `?category=Shoes` | `Unknown category`, plus a `categories` array listing the valid names |
| `category` given twice | `category must be a single value` |
| `?search=` longer than 100 characters | `search must be at most 100 characters` |
| `search` given twice | `search must be a single value` |

A blank `category` or `search` (`?category=&search=`) means no filter, and unknown query parameters are ignored. For example:

```bash
curl -i "http://localhost:3000/api/products?category=Shoes"
```

```bash
curl -i "http://localhost:3000/api/products?limit=100"
```

### `GET /api/products/:id`

```bash
curl -i http://localhost:3000/api/products/P001
```

Expected: `200 OK` with `{"success":true,"data":{...the product...}}`. The id is case-insensitive (`p001` works). An unknown id returns `404`:

```bash
curl -i http://localhost:3000/api/products/P999
```

```json
{"success":false,"message":"Product not found"}
```

There are no other methods: `POST`, `PUT`, `PATCH` and `DELETE` on these paths return the normal `404 {"success":false,"message":"Not found"}`. The catalog is changed by editing the file, not through the API.

### Replace the products and images

1. Open `src/data/products.js` and edit the list. Keep every field of the table above, keep ids unique (`P` followed by digits, such as `P051`), and put every category in the `CATEGORIES` list at the top of that file (the `category` filter of the API only knows the categories listed there).
2. Restart the server (section 3). Under `pnpm dev` the change restarts it for you, which also clears orders and sessions (section 16).
3. Run `pnpm test`. `test/products.data.test.js` is strict about the **bundled demo catalog**: exactly 50 products `P001` to `P050`, the 8 categories, every product available, prices from 200 to 10000, descriptions of 20 to 80 characters, HTTPS image URLs and a mix of categories on page 1. When you intentionally change the number of products, mark a product `available: false`, or use prices or categories outside those limits, update that test to match your own catalog.

Rules for `imageUrl`, because Messenger (Meta's servers) has to download the picture when it shows the card:

- It must be a **public HTTPS** URL that points straight at an image file (JPG or PNG). No login, no cookies, no redirect to a web page, no `http://`, no `localhost` or private network address.
- Use a **square** picture, **800 x 800** pixels. The cards use Messenger's square image ratio. The bundled demo data uses `images.unsplash.com` photos with the parameters `fit=crop&w=800&h=800`, which makes the host crop each photo to a square. Those are sample photos only: replace them with your own product photos (for example on your own storage or CDN, already cropped to 800 x 800) before going live.
- Use a **stable** URL: the same address must always return the same picture. Do not use a "random image" endpoint (for example a service that returns a different photo on every request), because the card would change or fail unpredictably.
- If Meta cannot load a card image, it may reject the whole carousel. The bot then sends the same page as a plain text list instead (section 15) and logs `Catalog template failed, text fallback used`. That keeps ordering possible but is not what customers should normally see.
- A product with a missing or non-HTTPS `imageUrl`, or with a price that is not a positive whole number, cannot become a card. The page is then sent as the plain text list instead, and the log has `[SendAPI] Catalog template failed, text fallback used` with `"reason":"invalid_input"` (section 20). `pnpm test` also catches such data.

Meta may change image size or ratio guidance; check Messenger's current *generic template* documentation if cards look cropped.

## 15. The Messenger conversation

The whole conversation is a small state machine in `orderpilot/src/services/conversationService.js`. There is one session per customer per Page. The bot always answers what the customer sent; it never starts a conversation.

The normal path:

```
Hi  ->  welcome menu  ->  1 (🛍️ পণ্য দেখুন)  ->  5 product cards + পরের / আগের / মেনু
  ->  🛒 অর্ডার করুন  ->  quantity?  ->  phone?  ->  address?  ->  summary with ✅ নিশ্চিত করুন / ❌ বাতিল
  ->  ✅ নিশ্চিত করুন  ->  order saved, "অর্ডার আইডি: ORD-1001"
```

Every customer-facing text and button is Bangla (section "Customer texts" below); the bot still understands the English words listed here.

### What the customer can type

The whole message must match. Case, spaces and punctuation around it (`! . ? , ; : । ' " ~`) are ignored, and Bangla digits (১ ২ ৩) count as 1 2 3. `Hi!` and ` MENU ` match, `hello there` does not.

**In every step:**

| Customer sends | Result | `rule` |
| --- | --- | --- |
| `cancel`, `cancel order`, `delete`, `বাতিল`, `বাতিল করুন` (or the ❌ বাতিল button) | The order draft is dropped: "অর্ডার বাতিল করা হয়েছে" plus the menu | `order_cancelled` |
| `menu`, `মেনু`, `hi`, `hello`, `hey`, `start`, `হাই`, `হ্যালো` | Outside an order: back to the welcome message and menu. In the middle of an order: see below. | `welcome` / `order_resumed` |

**Only Cancel ends an order in progress.** In the steps `WAITING_FOR_QUANTITY` to `WAITING_FOR_CONFIRMATION`, anything that is not an answer to the current question (a greeting, `menu`, the Menu button, an old button, a catalog page button, a photo or sticker, My orders, Support) keeps the draft and asks the current question again with its buttons, under `⏳ আপনার অর্ডারটি এখনো চলছে। ...` (`order_resumed`). At the summary the same draft is shown again, so its ✅ নিশ্চিত করুন button keeps working. My orders and Support first send their answer, then the question. Choosing another product (🛒 অর্ডার করুন on a card, or a product link) starts a new draft for that product.

**At the menu and while browsing the catalog** (steps `IDLE` and `BROWSING_PRODUCTS`):

| Customer sends | Result | `rule` |
| --- | --- | --- |
| `1`, `products`, `product`, `catalog`, `পণ্য`, `পণ্য দেখুন`, `order`, `অর্ডার`, `view products` | The catalog, page 1 | `catalog` |
| `2`, `my order information`, `order information`, `my orders`, `my order`, `আমার অর্ডার` | The customer's own latest 3 orders (id, product, quantity, total, status in Bangla; no phone or address), or "no orders yet" | `order_info` |
| `3`, `support`, `help`, `সহায়তা` | Support text | `support` |
| `next`, `পরের`, `পরবর্তী` (only while browsing) | Next catalog page. On the last page: "this is the last page". | `catalog_page`, `catalog_edge` |
| `previous`, `prev`, `back`, `আগের`, `পূর্ববর্তী` (only while browsing) | Previous catalog page. On the first page: "this is the first page". | `catalog_page`, `catalog_edge` |
| a product code: `P001`, `p001`, `order P001` | Starts an order for that product | `order_start` |
| a code that does not exist, or a product that is not available | "Product not found", nothing changes | `product_not_found` |
| anything else | "Sorry, I did not understand" plus the menu | `fallback` |

**While an order is being collected:**

| Step | Customer sends | Result | `rule` |
| --- | --- | --- | --- |
| `WAITING_FOR_QUANTITY` | a whole number from 1 to 100 | Saved. A returning customer whose last order has a valid phone and address is offered both (`saved_details`); everyone else is asked for the phone number. | `saved_details`, `quantity_ok` |
| | anything else | Asks again, nothing changes | `quantity_invalid` |
| `WAITING_FOR_SAVED_DETAILS` | `1`, `yes`, `হ্যাঁ`, or **✅ হ্যাঁ, এই তথ্য** | Uses the last phone and address, shows the order summary | `order_summary` |
| | `2`, `no`, `না`, or **✏️ নতুন তথ্য দেব** | Asks for the phone number, with the last number as a **📱 01XXXXXXXXX** button | `new_details` |
| | a phone number | Takes it and asks for the address (with the 🏠 button below) | `phone_ok` |
| `WAITING_FOR_PHONE` | a valid Bangladesh mobile number, or the **📱** button (the last order's number) | Saved (normalized), asks for the address. A returning customer also gets a **🏠 আগের ঠিকানা** button with the last address shown. | `phone_ok` |
| | anything else | Asks again with the accepted formats | `phone_invalid` |
| `WAITING_FOR_ADDRESS` | 10 to 200 characters, or the **🏠 আগের ঠিকানা** button | Saved, shows the order summary with **✅ নিশ্চিত করুন** and **❌ বাতিল** buttons | `order_summary` |
| | anything else | Asks again | `address_invalid` |
| `WAITING_FOR_CONFIRMATION` | `1`, `confirm`, `yes`, `y`, `হ্যাঁ`, `হ্যা`, `নিশ্চিত` | **Creates the order** | `order_confirmed` |
| | `2`, `no`, `n`, `না` | Cancels | `order_cancelled` |
| | anything else | Asks to send 1 (নিশ্চিত) or 2 (বাতিল) | `confirm_invalid` |

So a returning customer can keep both details with one tap, or choose new details and still keep one of them: the 📱 button keeps the number and lets them type a new address, and typing a new number still offers the 🏠 button for the old address.

The numbers mean different things at different steps, which is why there is a single rule: *the current step decides*.

| Customer sends | At the menu | While asked for the quantity | At the order summary |
| --- | --- | --- | --- |
| `1` | পণ্য দেখুন (products) | quantity 1 | **নিশ্চিত** (confirm) |
| `2` | আমার অর্ডারের তথ্য (my orders) | quantity 2 | বাতিল (cancel) |
| `3` | সহায়তা (support) | quantity 3 | not an answer: asks for 1 or 2 again |

**Other messages and answers:**

| Customer does | Result | `rule` |
| --- | --- | --- |
| Sends a photo, sticker, like, file or other attachment without text | Outside an order: "I only understand text messages for now" plus the menu (`attachment`). In the middle of an order: "I can't read photos or stickers" and the current question again (`order_resumed`). The draft is never changed, and the attachment is never opened or downloaded. | `attachment`, `order_resumed` |
| Sends text together with an attachment | Answered by its text, like any other message | (the text's rule) |
| Taps a quick reply | The button's payload decides (next section); the title text is ignored | see payloads |
| Types anything after 30 minutes without progress | A "session timed out" notice plus the menu, once (see "Session expiry" below) | `session_expired` |
| Taps an old or foreign **Confirm** button | Outside an order: "This confirmation is no longer valid" plus a hint to type `মেনু`. In the middle of an order: the current question (or summary) again. | `confirm_stale`, `order_resumed` |
| Taps **Confirm** for an order that already exists | "Already confirmed" plus the Order ID, no new order | `order_duplicate` |

After an order is confirmed the session is clean again, so `1` means পণ্য দেখুন (products) once more. A product code typed in the middle of an order is treated as the answer to the current question (and rejected); use the **🛒 অর্ডার করুন** button of another card, or cancel first, to switch products. Tapping a catalog page button (`পরের ▶` or `◀ আগের` from an older message) in the middle of an order keeps that order and asks its current question again.

### Buttons and payloads

Buttons send a short payload back to the bot. Product cards and the order summary use **postback** buttons; the buttons under the catalog are **quick replies**. Both are processed the same way:

| Payload | Sent by | What the bot does |
| --- | --- | --- |
| `ORDER_PRODUCT:<id>` (for example `ORDER_PRODUCT:P001`) | **🛒 অর্ডার করুন** on a product card | Starts a new order draft and asks for the quantity. Works from any step (an old card can be tapped any time) and replaces a draft in progress. An unknown or unavailable id gives `product_not_found`. |
| `CATALOG_PAGE:<n>` | **◀ আগের** / **পরের ▶** quick replies | Shows page `n` (a number outside the range is moved to the nearest valid page). In the middle of an order: the current question again. |
| `CONFIRM_ORDER:<draftId>` | **✅ নিশ্চিত করুন** under the order summary | Creates the order if this is the customer's current draft. If that draft was already confirmed it replies "already confirmed" with the existing Order ID and creates nothing. Otherwise: in the middle of an order the current question again, else "this confirmation is no longer valid". |
| `CANCEL_ORDER` | **❌ বাতিল** under every order question | Same as typing `cancel`. |
| `USE_SAVED_DETAILS` / `NEW_DETAILS` | **✅ হ্যাঁ, এই তথ্য** / **✏️ নতুন তথ্য দেব** | Use the last phone and address / ask for new ones (see the table above). |
| `USE_SAVED_PHONE` | **📱 01XXXXXXXXX** under the phone question | Uses the last order's number and asks for the address. |
| `USE_SAVED_ADDRESS` | **🏠 আগের ঠিকানা** under the address question | Uses the last order's address and shows the summary. |
| `MENU` | **🏠 মেনু** quick reply | Welcome message and menu. In the middle of an order: the current question again. |
| `GET_STARTED` | Messenger's Get Started button | Welcome message and menu (in the middle of an order: the current question again). |
| anything else | - | Welcome message and menu (in the middle of an order: the current question again). |

The `GET_STARTED` payload is understood, but this backend does not create the button on the Page (see "Product links for Facebook posts" below for the one-time setup). Quick replies normally disappear after they were used, so a customer who wants another page later types `1` or `next`.

### Product links for Facebook posts

Share one link per product in a post:

```
https://m.me/<PAGE_USERNAME>?ref=ORDER_PRODUCT:P001
```

`<PAGE_USERNAME>` is the Page's username (the part after `facebook.com/`). When a customer taps the link, Messenger opens the chat with the Page and the bot answers as if **🛒 অর্ডার করুন** had been tapped on that product, with one difference: the customer never saw the product's card, so the bot first sends the product photo, then asks for the quantity. It replaces a draft in progress. An unknown or unavailable id gives `product_not_found`. If Meta cannot load the photo, the question is sent without it and the log shows `[SendAPI] Product photo failed, text sent without it`.

- **A customer who already chatted with the Page**: Messenger sends a `messaging_referrals` event as soon as the chat opens. Subscribe that field (section 8).
- **A new customer** first sees the Page's **Get Started** button. Tapping it sends the `GET_STARTED` postback together with the link's ref, and the linked product wins over the welcome menu. Without a Get Started button on the Page, new customers lose the ref.
- Only `ORDER_PRODUCT:<id>` is read from a ref, because anyone can edit a link. Any other ref, and an ad referral without one, is logged as ignored with `"reason":"unsupported_referral"` and never answered. Get Started with such a ref gets the welcome menu as usual.

Add the Get Started button once (uses the Page access token from section 10):

```bash
curl -X POST "https://graph.facebook.com/v26.0/me/messenger_profile" -H "Content-Type: application/json" -H "Authorization: Bearer $PAGE_ACCESS_TOKEN" -d '{"get_started":{"payload":"GET_STARTED"}}'
```

### State diagram

```
 From ANY step:
   cancel / বাতিল / CANCEL_ORDER    ->  IDLE, "order cancelled" + menu (draft dropped)
   🛒 অর্ডার করুন (ORDER_PRODUCT)   ->  WAITING_FOR_QUANTITY (new draft)
   menu / hi / MENU / GET_STARTED   ->  IDLE + welcome, but in a WAITING step: same step,
   old buttons, photos, stickers         the current question asked again (draft kept)

   IDLE ---- 1 / পণ্য দেখুন ----> BROWSING_PRODUCTS --+
     |                                    |   ^          | next, previous,
     |                                    |   +----------+ Next / Previous buttons
     | P001                               | P001
     v                                    v
   WAITING_FOR_QUANTITY  (quantity 1..100)
     |                \  returning customer
     |                 v
     |               WAITING_FOR_SAVED_DETAILS --- 1 / ✅ (last phone + address) ---+
     |                 | 2 / ✏️ new details                                        |
     v                 v                                                           |
   WAITING_FOR_PHONE  (valid Bangladesh mobile number, or 📱 last number)          |
     v                                                                             |
   WAITING_FOR_ADDRESS  (10-200 characters, or 🏠 last address)                    |
     v                                                                             |
     +<----------------------------------------------------------------------------+
     v
   WAITING_FOR_CONFIRMATION  (order summary shown)
     |                         |
     | 1 / yes / ✅ নিশ্চিত     | 2 / no / ❌ বাতিল
     v                         v
   ORDER CREATED -> IDLE     IDLE

 A wrong answer in a WAITING step keeps the same step and asks again.
 30 minutes without progress: the session is forgotten (back to IDLE).
```

### Validation rules

| Answer | Accepted | Rejected |
| --- | --- | --- |
| Quantity | A whole number from **1 to 100**, written with ASCII or Bangla digits (`5`, `05`, `৫`) | `0`, `101`, `2.5`, `-1`, `+3`, words such as `five`, anything with other text |
| Phone | A Bangladesh mobile number as `017XXXXXXXX`, `+88017XXXXXXXX` or `88017XXXXXXXX`. Spaces, dashes, dots and parentheses inside the number are allowed. The operator code must be `013` to `019`. The bot stores it as `01XXXXXXXXX` (11 digits) whichever way it was typed. | Wrong length, operator codes `010`, `011`, `012`, other country codes, letters |
| Address | **10 to 200 characters** after extra spaces are collapsed. It is kept exactly as typed otherwise. | Shorter than 10 or longer than 200 characters |

A rejected answer never changes the order draft: the bot says what was wrong and asks the same question again.

### Orders are created only at confirmation

Choosing a product, the quantity, the phone number and the address only fill in a **draft** in the customer's session. **An order is created only when the customer confirms** (typing `1` / `confirm` / `yes`, or tapping ✅ নিশ্চিত করুন). At that moment the order copies the product's name and price (a snapshot) and the customer gets `✅ আপনার অর্ডার নিশ্চিত হয়েছে!` with the Order ID and total. Delivery charge is not calculated (the texts say so).

**What a duplicate confirm does:** each order summary has its own one-time draft id, and the order store refuses to create a second order for the same draft id. If the customer taps ✅ নিশ্চিত করুন twice, confirms by text and then by button, or Meta delivers the same tap twice, there is exactly one order. Every extra confirm gets `এই অর্ডারটি ইতিমধ্যে নিশ্চিত করা হয়েছে।` and the same Order ID. A Confirm button that belongs to a cancelled, replaced, expired or unknown draft (or someone else's) answers "this confirmation is no longer valid" and creates nothing. If the product disappeared or became unavailable before the customer confirmed, the order is cancelled with an apology.

### Session expiry (30 minutes)

A session is forgotten after **30 minutes without progress**. Every accepted step (a new draft, a valid quantity, phone or address, a catalog page) restarts the 30 minutes; rejected answers do not. The first typed message after that gets a short notice (`session_expired`: your previous session timed out, start again) followed by the menu, and the session is back at `IDLE`, so the draft is gone. `menu`, `hi`, `cancel` and the buttons work immediately without the notice. A Confirm button on an expired draft answers "no longer valid" and creates no order. Expired sessions are cleaned up every 5 minutes, and at most 10,000 sessions are kept (the least recently used go first).

### One customer at a time

Messenger can deliver two events of the same customer almost together (a double tap, or two quick messages), and Meta's webhook requests are independent. Without protection both could read the same session before either updated it. The server therefore puts the events of one customer (the pair of Page ID and customer ID) in a queue: the next event starts only after the previous one has been fully handled **and** its replies have been sent. Replies of one customer arrive in the order they were triggered. Different customers do not wait for each other, and one customer's slow Send API call cannot hold up anybody else. The queue lives in memory in one process (section 12).

### If Meta rejects the product cards

If Meta refuses the carousel (typically a product image URL it cannot load), the bot sends the same page as a **plain text list** instead:

```
🛍️ পণ্য তালিকা – পৃষ্ঠা 1/10

P001 – Red Banarasi Style Silk Saree – ৳6200
...

অর্ডার করতে পণ্যের কোড লিখুন (যেমন: P001)।
```

The customer orders by typing a product code. The text list carries the same পরের / আগের / মেনু buttons, and the log gets `[SendAPI] Catalog template failed, text fallback used`. This fallback happens only when Meta rejected the template itself. After a timeout, a network error, an invalid or expired token, a rate limit, an expired messaging window or an unavailable recipient, the failure is simply logged: the first attempt may already have been delivered, or the text would fail the same way, so a fallback could only create duplicates or more errors. The order summary has the same rule: if the button template is rejected it is sent as plain text, and the customer answers `1` or `2`. A summary longer than 640 characters (a very long address) is also sent as plain text.

### Language (বাংলা / English)

The bot speaks **Bangla by default** and **English** for customers who want it. The language belongs to the customer, not to a session: it is kept (in Redis, for a year) after orders, cancels and expired sessions.

- **Detected once.** On a customer's first message the server reads their Facebook language through the User Profile API (`GET /<PSID>?fields=locale`, 3-second timeout). An English locale (`en_US`, `en_GB`, ...) gives English; `bn_IN` and everything else give Bangla. The result is stored, so later messages make no extra call. The log shows `[AutoReply] Language detected` with the language and `"source":"locale"`, or `"source":"default"` plus the Graph error when Meta did not answer.
- **Meta's permission.** Meta answers this lookup for people with a role on the app (Development mode). For the public, the app needs **Advanced Access to user profiles** (App Review); until then the lookup fails, is logged once per customer, and they get Bangla. Accounts created with a phone number never have a profile. Set `DETECT_LANGUAGE=false` to skip the lookup entirely.
- **The customer can switch** any time: the menu has a **🌐 English** button (**🌐 বাংলা** in English), and typing `english`, `ইংরেজি`, `bangla` or `বাংলা` does the same (`language_changed`). In the middle of an order the order is kept and the current question is asked again in the new language (`order_resumed`). A chosen language is never overwritten by detection.
- **Everything follows the language:** every text, quick reply, product card button and catalog button. Product names, prices and order ids stay as stored. English and Bangla words are both understood in either language.

### Customer texts

All wording lives in `orderpilot/src/services/replyTexts.js`, one complete set per language (`textsFor('bn', shopName)`, `textsFor('en', shopName)`, with the same keys; the shop name, `Tangail Botiques`, is set in `src/bot.js`). Button labels are there too; the card and catalog buttons are in `messengerService.js`. Product names, prices and order ids are shown as stored. If you edit it, keep each text under 2000 characters (the Send API limit), each button label under 20, and keep the words the bot understands (`1`, `2`, `3`, `মেনু`, `বাতিল`, `পরের`, `আগের`) in the texts that mention them. `orderpilot/test/replyTexts.test.js` checks the approved wording and will tell you when a text changed.

## 16. Orders API (admin)

Orders hold customers' **phone numbers and addresses**, so this API is protected. Every request needs the admin key in the `X-Admin-Key` header (header names are case-insensitive). The key is the `ADMIN_API_KEY` from your `.env` (section 2); the server compares it in constant time and never logs or echoes it.

> **Without Redis, orders are kept in memory only.** Orders, conversation sessions and the duplicate-protection memory (message ids and draft ids) live in the server process's RAM. **Restarting the server deletes all of them**: a crash, a deploy, `pm2 restart`, a nodemon restart after you saved a file under `pnpm dev`, or stopping and starting `pnpm start`. Order numbers also start again at `ORD-1001` after a restart. Running two instances would split orders between them. This phase is meant for testing the flow. Set the Upstash Redis variables to keep orders across restarts; Vercel requires them (see "Deploying to Vercel").

Load the key into your shell (section 2). The commands below use `$ADMIN_API_KEY` and never print it:

```bash
set -a; source .env; set +a
```

**Without a key, or with a wrong one**, every route answers `401`, including paths that do not exist under `/api/orders`. The answer is the same for a missing key, a wrong key and a repeated header, so it reveals nothing about which part was wrong:

```bash
curl -i http://localhost:3000/api/orders
```

```json
{"success":false,"message":"Unauthorized"}
```

Never send the key as a query parameter (URLs end up in logs and history); only the header is accepted. Use HTTPS whenever the request leaves your machine (the ngrok URL is HTTPS).

### `GET /api/orders`

Lists all orders, newest first. Optional `?status=pending|confirmed|cancelled` filters; any other value is a `400`.

```bash
curl -i -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:3000/api/orders
```

```bash
curl -i -H "X-Admin-Key: $ADMIN_API_KEY" "http://localhost:3000/api/orders?status=pending"
```

Expected: `200 OK` with `{"success":true,"count":<number>,"data":[ ...orders... ]}`. With no orders it is `{"success":true,"count":0,"data":[]}`. A sample order (fake data):

```json
{
  "id": "ORD-1001",
  "productId": "P001",
  "productName": "Red Banarasi Style Silk Saree",
  "quantity": 2,
  "unitPrice": 6200,
  "subtotal": 12400,
  "currency": "BDT",
  "customerPsid": "1111111111",
  "phone": "01712345678",
  "address": "House 12, Road 3, Tangail Sadar",
  "status": "pending",
  "createdAt": "2026-10-22T06:14:49.109Z"
}
```

`customerPsid` is the customer's Page-scoped ID (it is what you reply to; treat it as personal data). `unitPrice` is the price at the moment of confirmation, so later catalog edits do not change old orders. There is no delivery charge field. Statuses:

| Status | Meaning |
| --- | --- |
| `pending` | Every new order starts here (created when the customer confirms) |
| `confirmed` | You accepted the order |
| `cancelled` | The order was cancelled |

### `GET /api/orders/:id`

```bash
curl -i -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:3000/api/orders/ORD-1001
```

Expected: `200 OK` with `{"success":true,"data":{...the order...}}`. An unknown id returns `404 {"success":false,"message":"Order not found"}`.

### `PATCH /api/orders/:id/status`

Changes the status of an order. The body is JSON, so send the `Content-Type` header too:

```bash
curl -i -X PATCH -H "X-Admin-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' -d '{"status":"confirmed"}' http://localhost:3000/api/orders/ORD-1001/status
```

Expected: `200 OK` with the updated order in `data`. Any status can be set to any other (there are no transition rules). The customer is **not** notified: the bot never sends a message because of a status change (section 13). The customer sees the new status the next time they send `2`.

| Problem | Answer |
| --- | --- |
| Missing or wrong `X-Admin-Key` | `401 {"success":false,"message":"Unauthorized"}` |
| Status is not `pending`, `confirmed` or `cancelled` (or missing) | `400 {"success":false,"message":"status must be one of: pending, confirmed, cancelled"}` |
| Body is not a JSON object, or the `Content-Type: application/json` header is missing | `400 {"success":false,"message":"Request body must be a JSON object"}` |
| Malformed JSON | `400 {"success":false,"message":"Bad request"}` |
| Body larger than 10 KB | `413 {"success":false,"message":"Payload too large"}` |
| Unknown order id | `404 {"success":false,"message":"Order not found"}` |

There is no `POST` and no `DELETE`: orders can only be created by a customer confirming in Messenger, and are never deleted through the API.

## 17. Test with a Tester account

Prerequisites:

- Sections 7, 8, 10 and 11 are done, `.env` has `ENABLE_AUTO_REPLY=true`, a real `PAGE_ACCESS_TOKEN`, the real `FACEBOOK_PAGE_ID` and a valid `ADMIN_API_KEY`.
- The app is subscribed to **both** `messages` and `messaging_postbacks` (section 8).
- Backend (section 3) and ngrok (section 6) are running, and the startup log says `Auto-reply: enabled`. Use `pnpm start` (not `pnpm dev`) so a saved file does not restart the server in the middle of the test and delete your orders.
- The Facebook account you test with has a role on the app (for example Tester, added under **App roles > Roles** and accepted). You test by writing to your Page from that account in Messenger. For step 18 you need a second account with a role.
- A shell where `.env` is loaded for the `curl` steps (`set -a; source .env; set +a`).

Checklist:

1. **`/health` still works** (section 4):

   ```bash
   curl -i http://localhost:3000/health
   ```

   Expect `200` and `{"success":true,"message":"OrderPilot backend is running"}`.

2. **GET verification still works** (section 5):

   ```bash
   curl -i "http://localhost:3000/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=CHALLENGE_ACCEPTED"
   ```

   Expect `200` and the body `CHALLENGE_ACCEPTED`. A request with a wrong signature must still give `403` (section 9) and must never cause a `[Messenger]` or `[SendAPI]` line.

3. **Welcome.** From the Tester account send `Hi`. Within a few seconds the Page replies with the welcome message and the three-line menu. The log shows the five lines from section 12 with `"rule":"welcome"`.
4. **Product cards.** Send `1`. You get a carousel of **5 product cards** (image, `Name – ৳Price`, a short description and an **🛒 অর্ডার করুন** button), then a message `🛍️ পণ্য তালিকা – পৃষ্ঠা 1/10` with the quick replies `পরের ▶` and `🏠 মেনু` (no Previous on page 1). Rule: `catalog`.

   ```
   [AutoReply] Matching reply rule {"rule":"catalog","step":"BROWSING_PRODUCTS"}
   [SendAPI] Reply sent successfully {"senderId":"…1111","rule":"catalog","messageId":"m_FAKE_REPLY_ID_2","mode":"template"}
   ```

5. **Next page.** Tap `পরের ▶` (or type `next`). Page 2 of 10 appears, now with `◀ আগের`, `পরের ▶` and `🏠 মেনু`. Rule: `catalog_page`. `◀ আগের` returns to page 1.
6. **🛒 অর্ডার করুন.** Tap **🛒 অর্ডার করুন** on a card. The bot names the product and price and asks `কয়টি পিস অর্ডার করবেন?`. Rule: `order_start`. **No order exists yet**: `GET /api/orders` (step 12) is still empty. The log shows the button tap as a postback, never its payload value:

   ```
   [webhook] event {"type":"postback","pageId":"1234567890","senderId":"…1111","mid":"m_FAKE_POSTBACK_ID_4","hasPayload":true,"timestamp":1700000000003}
   [Messenger] Incoming customer message {"pageId":"1234567890","senderId":"…1111","mid":"m_FAKE_POSTBACK_ID_4","kind":"postback","payloadType":"ORDER_PRODUCT","textLength":0,"attachmentCount":0}
   [AutoReply] Matching reply rule {"rule":"order_start","step":"WAITING_FOR_QUANTITY"}
   ```

7. **Quantity.** Send `2`. The bot asks for your mobile number. Rule: `quantity_ok`.
8. **Phone.** Send `01712345678` (any valid Bangladesh mobile format). The bot asks for the delivery address. Rule: `phone_ok`.
9. **Address and summary.** Send an address such as `House 12, Road 3, Tangail Sadar`. The bot shows the summary (product, quantity 2, unit price, subtotal, phone, address, `ডেলিভারি চার্জ: এখনো যোগ করা হয়নি`) with the buttons **✅ নিশ্চিত করুন** and **❌ বাতিল**. Rule: `order_summary`. Still no order.
10. **Confirm.** Tap **✅ নিশ্চিত করুন** (or send `1`). You get `✅ আপনার অর্ডার নিশ্চিত হয়েছে!` with `অর্ডার আইডি: ORD-1001` and the total. Rule: `order_confirmed`.
11. **Order saved (logs).** The server log has exactly one `[Order] Order created` line with the order id, product id, quantity and subtotal. The line has no phone number, address or customer ID:

    ```
    [Messenger] Incoming customer message {"pageId":"1234567890","senderId":"…1111","mid":"m_FAKE_POSTBACK_ID_9","kind":"postback","payloadType":"CONFIRM_ORDER","textLength":0,"attachmentCount":0}
    [AutoReply] Matching reply rule {"rule":"order_confirmed","step":"IDLE"}
    [Order] Order created {"orderId":"ORD-1001","productId":"P006","quantity":2,"subtotal":2900}
    [SendAPI] Reply sent successfully {"senderId":"…1111","rule":"order_confirmed","messageId":"m_FAKE_REPLY_ID_12"}
    ```

12. **`GET /api/orders` shows it** (section 16):

    ```bash
    curl -i -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:3000/api/orders
    ```

    On a freshly started server expect `count` 1 and your order with the phone number normalized to `01712345678`, status `pending`. Optional: change it with the `PATCH` command from section 16, then send `2` to the Page: the bot lists your latest orders with the new status.

13. **Duplicate confirm creates one order.** Scroll up in Messenger and tap **✅ নিশ্চিত করুন** on the same summary again (tap it several times if you like). Each tap is answered with `এই অর্ডারটি ইতিমধ্যে নিশ্চিত করা হয়েছে।` and the same Order ID, with rule `order_duplicate`. Run the command of step 12 again: `count` is still 1. (Sending `1` as text is not a repeat: once the order is done, `1` means পণ্য দেখুন (products).)

    ```
    [AutoReply] Matching reply rule {"rule":"order_duplicate","step":"IDLE"}
    ```

14. **Duplicate protection on replay.** In the ngrok inspector (<http://127.0.0.1:4040>) open the `POST /api/webhooks/facebook` request of your first **Confirm** tap and click **Replay** twice. Both replays return `200` and log `[Messenger] Ignored event {"reason":"duplicate"}`; nothing new arrives in Messenger and `count` stays 1. (Replaying the *same tap* after a server restart would find no draft and no order, because everything is in memory, and the bot would answer that the confirmation is no longer valid.)
15. **Invalid quantity.** Tap **🛒 অর্ডার করুন** on a card and answer the quantity question with `abc`, then `0`, then `101`, then `2.5`. Each time the bot says to enter a number from 1 to 100 (rule `quantity_invalid`) and the step does not change. Then send `3` to continue.
16. **Invalid phone and address.** At the phone question send `12345` and `01212345678` (operator code 012 is not allowed): rejected with the accepted formats (rule `phone_invalid`). Send `+8801712345678`: accepted. At the address question send `Dhaka` (too short): rejected (rule `address_invalid`). No order is created by any of this.
17. **Cancel resets.** During an unfinished order send `cancel` (or tap **❌ বাতিল** on a summary). The bot answers `❌ অর্ডার বাতিল করা হয়েছে।` with the menu (rule `order_cancelled`). Send `1` and pick a product again: the questions start from the quantity, nothing from the cancelled draft remains, and `GET /api/orders` shows no new order.
18. **Two testers are isolated.** Use a second account with a role on the app. Put tester A at the phone question and tester B at the quantity question, then answer alternately. Each one is asked only their own next question, B's phone number never shows up in A's summary, and when both confirm there are two separate orders (check `GET /api/orders`). Sending `2` shows each tester only their own orders.
19. **Echo filtering prevents loops.** The Page's reply must not be answered again, so you see exactly one reply per message you send. If `message_echoes` is subscribed (section 8), each reply comes back to the webhook as an echo: the log shows a `[webhook] event` line with `"type":"echo"` followed by `[Messenger] Ignored event` with `"reason":"self_sender"` (or `"echo"`), and no new `[SendAPI]` line. If `message_echoes` is not subscribed, echoes never arrive at all, which is also fine.
20. **Session expiry (optional, takes 30 minutes).** Start an order, stop after the quantity, wait 30 minutes, then send anything other than `menu`. You get the `session_expired` notice (`⏳ আপনার আগের সেশনের সময় শেষ হয়ে গেছে।`) and the menu, and the draft is gone. Server logs show rule `session_expired`.

Extra checks from Phase 2:

- **Switch auto-reply off.** Set `ENABLE_AUTO_REPLY=false` in `.env` and restart. The startup log says `Auto-reply: disabled`. Send `Hi` again: the webhook still answers `200` and logs `[webhook] event`, but no `[Messenger]` line appears and no reply is sent. Set it back to `true` and restart afterwards (this also clears orders and sessions).
- **Wrong token.** Set `PAGE_ACCESS_TOKEN=wrong_token_for_testing` in `.env` and restart (the server still starts, because the value is not a placeholder). Send `Hi`: the log shows `[SendAPI] Reply failed` with `"hint":"invalid_access_token"`, the webhook still returns `200` (check in the ngrok inspector), and the server keeps running. Restore the real token and restart.

If a step does not behave like this, use sections 19 and 20.

## 18. Automated tests

```bash
pnpm test
```

This runs the tests in `test/` with Node's built-in test runner (`node --test`). The bot's own tests are in the package: run `pnpm test` in `../packages/orderpilot` as well. No extra test libraries are needed. The Meta Graph API is fully mocked (`fetch` is replaced), so the tests make **no real Meta calls**, use no real token and no `.env` file: they set fake environment values themselves and restore them afterwards. The HTTP tests start the app on a random local port and close it again. Time-dependent code (the 30 minute session expiry, the 10 minute duplicate cache) uses an injected clock, so no test waits. Nothing is left running when they finish, and they take a few seconds.

To run one file:

```bash
pnpm test test/webhook.test.js
```

What is covered:

| File | Covers |
| --- | --- |
| `test/orders.api.test.js` | `/api/orders` over HTTP: 401 without the key on every route, list, filter, get, `PATCH`, 400, 404 and 413 answers |
| `test/adminAuth.test.js` | The `X-Admin-Key` check, constant-time comparison, the key never echoed or logged |
| `test/config.test.js` | `ADMIN_API_KEY` startup validation (missing, placeholder, shorter than 16 characters) |
| `test/productService.test.js` | Product lists, pagination, category and search filters, lookup by id |
| `test/products.api.test.js` | `/api/products` over HTTP: defaults, paging, filters, all 400 cases, `404` for an unknown product |
| `test/products.data.test.js` | The bundled catalog: 50 products, ids `P001` to `P050`, 8 categories, full schema, HTTPS image URLs, a mix on page 1 |
| `test/webhook.test.js` | The mounted webhook: GET verification, signature checks (a bad signature sends nothing), `200` before the Send API finishes, one reply per message, duplicates, disabled auto-reply, Send API failures still returning `200` |
| `test/conversationFlow.test.js` | A whole order end to end through the webhook, the bot and the admin orders API |
| `orderpilot/test/messengerService.test.js` | Send API request (URL, `Authorization` header, body, version, `RESPONSE` type), quick replies, generic and button templates (exact payloads, truncation, the 10-card cap), the product catalog and order confirmation senders, the text fallback (only for rejected templates, never after a timeout or an invalid token), navigation failures, mapping of Graph errors to `reason` and `hint`, timeout and network failures, bad input rejected before any call, the token never appearing in results |
| `orderpilot/test/dedupeCache.test.js` | First time seen versus duplicate, 10 minute expiry, size limit, invalid keys, clearing |
| `orderpilot/test/autoReplyService.test.js` | The filters of section 12 (page mismatch, self, echo, unsupported events, duplicates), text, quick-reply and postback events, attachments, per-customer ordering, sending several replies, log lines that contain no customer text, phone, address or token |
| `orderpilot/test/conversationService.test.js` | The whole ordering conversation: every step, every keyword and payload, validation, confirm, duplicate confirm, cancel, expiry, two customers kept apart, nothing logged |
| `orderpilot/test/replyTexts.test.js` | The approved customer-facing texts |
| `orderpilot/test/validators.test.js` | Quantity, Bangladesh phone number and address rules |
| `orderpilot/test/sessionStore.test.js` | Steps, 30 minute expiry (reported once), isolation, size limit, cleanup timer |
| `orderpilot/test/keyedQueue.test.js` | Same-key tasks run in order, different keys run together, a failing task does not block the next, no leftover entries |
| `orderpilot/test/orderStore.test.js` | Orders `ORD-1001` onwards, price snapshot, one order per draft id, copies, listing and filtering, status updates |
| `orderpilot/test/orderPilot.test.js` | `createOrderPilot()` options, the webhook on `node:http` and as a fetch handler, a whole order with `onOrder`, Redis, `connect()` |
| `orderpilot/test/catalog.test.js` | Products from an array or a function, defaults, Messenger catalog pages |

## 19. Common webhook configuration errors and solutions

For problems with replies once events do arrive, see section 20.

First stop: read the reason code in your server log (`[webhook] ... rejected: <reason>`) and the request list in the ngrok inspector at <http://127.0.0.1:4040>.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Meta says "The URL couldn't be validated" or "callback verification failed" | Any of the rows below | Check in order: backend running, ngrok running, URL is `https://<current-ngrok-domain>/api/webhooks/facebook`, token matches. Then retry. |
| Server log: `verification rejected: token_mismatch` (403) | The Verify token in Meta differs from `META_VERIFY_TOKEN` (typo, stale value, extra space) | Copy the value from `.env` again. If you changed `.env`, restart the server. |
| `verification rejected: invalid_mode` or `missing_challenge` | Manual request without `hub.mode=subscribe` or `hub.challenge` | Use the full curl from section 5. Real Meta requests always include them. |
| `404 {"success":false,"message":"Not found"}` | Wrong path | The Callback URL must end exactly with `/api/webhooks/facebook` (no `/webhook`, no extra suffix). |
| Meta rejects the URL, or nothing reaches the server | `http://` used instead of `https://`, ngrok not running, or the free random ngrok URL changed after a restart | Use the https Forwarding URL from the running ngrok. Update the Callback URL if it changed, or use your free static dev domain (section 6). |
| ngrok error page `ERR_NGROK_8012` (connection refused to localhost) | Backend is not running, or ngrok points at the wrong port | Start the backend. The port in `ngrok http <port>` must equal `PORT` in `.env`. |
| Server exits immediately at startup | `META_VERIFY_TOKEN`, `META_APP_SECRET` or `ADMIN_API_KEY` is missing, empty or still a `replace_with_...` placeholder, or `ADMIN_API_KEY` is shorter than 16 characters. With `ENABLE_AUTO_REPLY=true` the same applies to `PAGE_ACCESS_TOKEN` and `FACEBOOK_PAGE_ID` (digits only), and a malformed `META_GRAPH_API_VERSION` also stops it. `ENABLE_AUTO_REPLY` itself must be `true` or `false` (`yes`, `1`, `on` are rejected). | The error names the variable (never the value). For `ADMIN_API_KEY` put a generated key in `.env` (`openssl rand -hex 24`, section 2). Fix `.env` and start again, or set `ENABLE_AUTO_REPLY=false` until the token and Page ID are ready. |
| `Port 3000 is already in use` (`EADDRINUSE`) | Another instance (or another app) is using the port | Stop the old process (for example `lsof -i :3000` to find it), or set a different `PORT` and run `ngrok http` with that port. |
| `POST` returns 403, log: `event rejected: signature_mismatch` | Wrong `META_APP_SECRET` (it must be the **App secret** from App settings > Basic, not the Page access token and not the verify token), whitespace or quotes in `.env`, the secret of a different app, or the body was altered by a proxy/middleware | Re-copy the App secret, remove extra characters, restart. Make sure nothing rewrites the body between Meta and the server. |
| `POST` returns 403, log: `missing_signature` or `malformed_signature` | Header absent (manual curl) or not in the form `sha256=<64 hex characters>`. A request without `Content-Type: application/json` is also treated as having an empty body. | Send both headers as shown in section 9. |
| `400` (`invalid_json`, `invalid_entry`, `invalid_payload`) with a valid signature | Body is not valid JSON, or `entry` is not an array | Fix the payload. Meta's own payloads are always valid. |
| `404` (`unsupported_object`) with a valid signature | `object` is not `page` (for example the app is subscribed to another product) | Subscribe the **Page** object. This backend handles Page events only. |
| `413` `{"success":false,"message":"Payload too large"}` | Body is larger than 1 MB (webhook) or 10 KB (`/api/orders`) | Not expected from Meta. Check what is sending the request. |
| Verification works, but no events arrive | The Page is not connected to the app, fields are not subscribed, the sender has no role on the app (Development mode), or you messaged a different Page | Connect and subscribe the Page (section 8), subscribe `messages` and `messaging_postbacks`, message the Page from an admin/developer/tester account, and check the ngrok inspector to see whether Meta's request arrives at all. |
| Typed messages work, but **🛒 অর্ডার করুন**, **Confirm** or **Cancel** do nothing (no `"type":"postback"` line in the log, and no postback `POST` in the ngrok inspector) | The app is not subscribed to `messaging_postbacks` for the Page | Subscribe the `messaging_postbacks` field (section 8; the dashboard labels may differ) and tap the button again. Meanwhile customers can type a product code such as `P001`, and `1` to confirm. |
| Events arrive (`[webhook] event` lines) but the Page does not reply | Auto-reply is off, the event is filtered, or the Send API call failed | Follow the last `[Messenger]` / `[SendAPI]` line in section 20. |
| Meta retries or disables the webhook | Meta expects a quick `200` response. After repeated failures it retries, sends alerts, and can stop delivering events or unsubscribe the app from the Page. | Fix the cause, then re-subscribe the Page and fields in the dashboard. |
| Visiting the ngrok URL in a browser shows an ngrok warning page | ngrok's browser interstitial on free accounts | It only affects browsers. Meta's server calls and `curl` are not affected. Click through, or test with `curl`. |
| `pnpm install` seems to freeze (no output, no CPU use) | A stalled network connection to the npm registry, often while Corepack downloads pnpm itself for the first time | Press Ctrl+C and run it again. Use `pnpm install --reporter=append-only` to see the step it stops on. The version is pinned by `packageManager` in `package.json`, so Corepack downloads it only once. |
| Changed `.env` but nothing changed | Env vars are read at startup, and nodemon does not watch `.env` by default. Also, variables already exported in your shell (for example by `set -a; source .env; set +a`) win over `.env`; this includes `ENABLE_AUTO_REPLY`, `PAGE_ACCESS_TOKEN` and `ADMIN_API_KEY`. | Restart: type `rs` in the nodemon terminal, or press Ctrl+C and run `pnpm dev` again. If it still uses the old value, start the server from a fresh terminal. |

## 20. Common Send API errors and troubleshooting

Find the last log line for the message you sent, then use the matching row.

| Last log line | Meaning | Go to |
| --- | --- | --- |
| No `[webhook]` line at all | Meta is not calling your server | Section 19 and the ngrok inspector |
| `[webhook] event`, but no `[Messenger]` line | Auto-reply is off, or `.env` was not reloaded | "No reply" rows below |
| `[Messenger] Ignored event {"reason":...}` | The event was filtered on purpose | Reason codes in section 12 and the first table below |
| `[SendAPI] Reply failed {...}` | The Send API call failed | Hint and reason tables below |
| `[SendAPI] Catalog template failed, text fallback used {...}` | Meta rejected the product cards; the customer got a text list | "Catalog, ordering and Orders API problems" below |
| `[SendAPI] Catalog navigation failed {...}` | The cards arrived, but the Next / Previous message did not | Same table; the customer can type `next` |
| `[Order] Order created {...}` | An order was saved in memory | Section 16 |
| `[SendAPI] Reply sent successfully` | Meta accepted the message | Check the conversation of the account you test with, and that you wrote to the right Page |

**No reply at all:**

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Startup log says `Auto-reply: disabled`, no `[Messenger]` lines | `ENABLE_AUTO_REPLY` is not `true`, or you changed `.env` and did not restart | Set `ENABLE_AUTO_REPLY=true`, restart (see "Changed `.env`" in section 19). |
| Server refuses to start with `ENABLE_AUTO_REPLY=true` | `PAGE_ACCESS_TOKEN` or `FACEBOOK_PAGE_ID` is missing, empty or still a `replace_with_...` placeholder, or `META_GRAPH_API_VERSION` is malformed. The message names the variables, never the values. | Fill them in (sections 10 and 11), or set `ENABLE_AUTO_REPLY=false`. |
| Server refuses to start and names `ENABLE_AUTO_REPLY` | Only `true` and `false` are accepted. `yes`, `1` or `on` are rejected on purpose, so a typo cannot silently switch replies on or off. | Use `true` or `false`. |
| Server refuses to start and names `ADMIN_API_KEY` | The key is missing, empty, a `replace_with_...` placeholder, or shorter than 16 characters | Generate one with `openssl rand -hex 24` and put it in `.env` (section 2). |
| `[Messenger] Ignored event {"reason":"page_mismatch"}` | `FACEBOOK_PAGE_ID` differs from the `pageId` in the `[webhook] event` line | Copy the `pageId` from the log into `FACEBOOK_PAGE_ID`, restart. |
| No `[webhook]` lines for the message | The Page is not subscribed to `messages`, or the sender has no role on the app while the app is in Development mode (Meta then sends no events and the Page cannot answer) | Section 8. Add the person under **App roles > Roles**, or test with an account that has a role. |
| `[Messenger] Ignored event` with `unsupported_event`, `echo`, `self_sender`, `no_content`, `no_payload` | Deliveries, reads, reactions, the Page's own messages, empty messages and postbacks without a payload are never answered | Expected. Send a normal text message or tap a button. |
| `[Messenger] Ignored event {"reason":"duplicate"}` | That message or button tap was already answered in the last 10 minutes (a Meta retry or an ngrok replay) | Expected. Send a new message. |
| Customer receives the same reply twice | Two server instances, or a restart between a message and Meta's retry (the cache is in memory) | Run one instance, and add persistent deduplication for production (section 12). |

**Catalog, ordering and Orders API problems:**

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Product cards have no pictures, or the customer got a text list and the log says `Catalog template failed, text fallback used` | Meta rejected the carousel, usually because a product `imageUrl` is not a public HTTPS image (404, needs a login, redirects to a web page, hotlink-protected, or not an image) | Open each `imageUrl` of the page in a private browser window, fix `src/data/products.js` (section 14) and restart. You can list the URLs with `curl http://localhost:3000/api/products`. |
| The catalog shows as a text list and the log has `[SendAPI] Catalog template failed, text fallback used` with `"reason":"invalid_input"` | A product on that page has bad data: a missing or non-HTTPS `imageUrl`, an empty name, or a price that is not a positive whole number, so no card could be built. | Fix the product in `src/data/products.js` and restart. `pnpm test` also catches it. |
| `401 {"success":false,"message":"Unauthorized"}` from `/api/orders` | The `X-Admin-Key` header is missing, misspelled or wrong. A common cause: `$ADMIN_API_KEY` is empty because `.env` was not loaded into this terminal, or `.env` was changed after the server started. | Run `set -a; source .env; set +a` in this terminal (section 2), restart the server after any key change, and send the header exactly as in section 16. Do not paste the key into chat to debug. |
| `400 Request body must be a JSON object` on `PATCH` | The `Content-Type: application/json` header is missing, or the body is not a JSON object | Use the exact command from section 16. |
| The bot says the session timed out (`⏳ আপনার আগের সেশনের সময় শেষ হয়ে গেছে।`) | 30 minutes passed without progress, or the server restarted (sessions are in memory) | Expected. Send `menu` and start again. |
| The bot answers `এই কনফার্মেশনটি আর বৈধ নয়` when you tap Confirm | The draft was cancelled, replaced by a newer one, expired, or the server restarted since the summary was shown | Start again with `menu`. This is why a button can never create a wrong or second order. |
| The bot says the quantity is invalid when you type `1` or `menu`-like words | You are in the middle of an order: at the quantity question `1` means quantity 1; `menu` and `cancel` always work | Type `menu` or `cancel` to leave the order, or answer the question. |
| Orders disappeared | The server restarted (a deploy, a crash, nodemon after a code change, or stopping and starting it). Orders and sessions are only in memory. | Expected in this phase. Use `pnpm start` for tests, and move orders to a database before going live. |
| **🛒 অর্ডার করুন** / **Confirm** do nothing | The app is not subscribed to `messaging_postbacks` | Section 8 and the postback row in section 19. |
| The customer was not told that their order status changed | By design: `PATCH /api/orders/:id/status` only changes the stored status. Nothing is sent proactively because of Meta's 24-hour window. | The customer sees the status when they send `2`. Contact them yourself (section 13 explains the rules). |

**`[SendAPI] Reply failed`:** `reason` says what kind of failure it is. For `graph_error` (Meta answered with an error) the log also has `code`, `subcode`, `hint` and `fbtraceId`.

| `hint` | Graph error code | Likely cause | Fix |
| --- | --- | --- | --- |
| `invalid_access_token` | 190 | The token is wrong, expired or revoked, has trailing characters or quotes, or belongs to another Page or app | Generate a new token for the right Page (section 10), update `.env`, restart. |
| `permission_denied` | 10 or 200 | `pages_messaging` is missing, the app has no Advanced Access and the person has no app role, or the app is not live for non-role users | Add the `pages_messaging` permission, test with an admin/developer/tester account (section 10), and request Advanced Access through App Review for the public. |
| `outside_messaging_window` | 10 with subcode 2018278 | The person's last message is older than the 24 hour window (section 13), for example when you replay an old request after a restart | Ask the person to write again. The bot only answers inside the window (section 13). |
| `invalid_parameter` | 100 | The recipient ID is not valid for this Page (for example the fake sender IDs from section 9), or the payload was rejected (for product cards, often an image URL Meta cannot load; the bot then falls back to the text list) | Test with a real message from a Tester account. Quote `fbtraceId` if it happens with real users. |
| `recipient_unavailable` | 551 | The person is unavailable: blocked the Page, deactivated the account, or cannot receive messages from it | Nothing to fix in the backend. |
| `rate_limited` | 4, 17, 32 or 613 | Too many Graph API calls in a short time | Wait and send fewer messages. The bot does not retry. |
| `null` | other | An error code without a dedicated hint | Read the `code` and `subcode`, search Meta's docs, and quote `fbtraceId` to Meta support. |

| `reason` | Meaning | Fix |
| --- | --- | --- |
| `graph_error` | Meta answered with an error object (see the `hint` table above) | See above. |
| `timeout` | No answer from the Graph API within 10 seconds | Check your internet connection and Meta's status page, then send another message. The server does not retry. |
| `network` | The request could not be made (DNS, connection, TLS) | Check the server's internet access and DNS. |
| `config` | `PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID` or `META_GRAPH_API_VERSION` is missing or malformed at send time | Check `.env` and restart. |
| `invalid_input` | The recipient ID is not a string of digits, a reply text is empty or longer than 2000 characters, or the page has no products, more than 10, or an invalid page number (a single bad product only triggers the text fallback) | Not expected with the built-in texts. If you edit `replyTexts.js`, keep each text under 2000 characters; if you edit products, follow section 14. |
| `http_error` | A non-2xx answer without a readable Graph error (for example an HTML page from a proxy) | Check for a proxy or firewall in front of `graph.facebook.com`. |
| `invalid_response` | A 2xx answer that is not valid JSON | Retry later; if it persists, contact Meta support with the time of the request. |

When you contact Meta support, give them the `fbtraceId` from the log line (and the time of the request). Never send the access token.

## Deploying to Vercel (free Hobby plan)

The backend runs on Vercel as one serverless function: Vercel's zero-config Express support serves the app exported by `src/app.js` (`src/server.js` is only used to listen locally or on a VPS). Serverless instances share no memory and are stopped at any time, so on Vercel **orders, chat sessions and duplicate filtering are stored in Upstash Redis**. Without it the app answers 503 to everything and logs the missing variable names.

1. Create a Vercel project from this repository with **Root Directory** set to `api`. The bot package lives outside it (`../packages/orderpilot`), so keep the option **Include source files outside of the Root Directory in the Build Step** (next to the Root Directory setting) switched on. It is on by default.
2. Add a Redis database: in the project, open Storage (or the Marketplace), pick **Upstash for Redis** on the free plan and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the app reads. A database made at upstash.com works too: set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Under Settings > Environment Variables add `META_VERIFY_TOKEN`, `META_APP_SECRET`, `ADMIN_API_KEY`, and for auto-reply `ENABLE_AUTO_REPLY`, `PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `META_GRAPH_API_VERSION`. `DETECT_LANGUAGE` is optional (on when unset). `PORT` is not needed.
4. Deploy, then open `https://<project>.vercel.app/health`.
5. In Meta Developers set the Callback URL to `https://<project>.vercel.app/api/webhooks/facebook` (the production domain: preview URLs are behind Vercel's login). ngrok is no longer needed.

Locally nothing changes: with no Redis variables in `.env`, `pnpm dev` keeps everything in memory. Fill in the two `UPSTASH_REDIS_REST_*` variables to use Redis locally too. The test suite always uses memory, even when those variables are exported in your shell.

The per-customer reply queue still runs inside one instance, so two messages from the same customer that reach two different instances at the same moment are not ordered against each other. That is rare at test traffic.

## Deploying to a VPS later

Run the same code on the server with real environment variables (`PORT`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, `ADMIN_API_KEY`, and for auto-reply `ENABLE_AUTO_REPLY`, `PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `META_GRAPH_API_VERSION`) instead of a committed `.env`, and restart the process after changing any of them. **Set `ADMIN_API_KEY` to a fresh generated value on the server** (the server will not start without it); do not reuse the one from your laptop. Install with `pnpm install --frozen-lockfile --prod` (nodemon is a dev-only tool), start it with `pnpm start` under a process manager such as pm2 or systemd, and put a reverse proxy with HTTPS (nginx or Caddy) in front of it. The proxy must pass the request body through unchanged. Then set the Meta Callback URL to `https://<your-domain>/api/webhooks/facebook` and drop ngrok.

**In-memory data does not survive restarts and does not work with several instances.** Orders, conversation sessions, the per-customer queue and the duplicate cache all live inside one Node.js process. Every restart, deploy, crash or `pm2 reload` deletes every order and forgets every customer's progress, and a second instance behind a load balancer would keep its own separate orders and sessions (so a customer's next message could land on a server that does not know them). Run exactly one instance while that is the case. Before real customers use it, move **orders** to a database (Postgres, MySQL or similar), **sessions** and **deduplication** to Redis or the same database (with a TTL and a unique key), and add a job queue for retries. Keep the Page access token and the admin key in the process manager's secret or environment store, not in the repository, and expose `/api/orders` only over HTTPS (ideally also restricted by IP or a VPN).

## Security notes

- Secrets live only in environment variables. Never commit `.env` (it is in `.gitignore`); commit `.env.example` with placeholders only.
- The `POST` signature is always validated against the **raw** request body before any JSON is parsed. A request with an invalid signature never reaches the reply code.
- Signatures, the verify token and the admin key are compared in constant time.
- **`/api/orders` is protected by `ADMIN_API_KEY`** (the `X-Admin-Key` header). The check runs before anything else on every path under `/api/orders`, answers one identical `401` for every failure, and never logs or echoes the key. The server refuses to start without a strong key (16 characters or more). Generate it with `openssl rand -hex 24`, keep it only in `.env` or the server's environment, and rotate it by changing the value and restarting. The product API is public by design and holds no private data.
- Logs never contain message text, button payload values (only the type prefix), phone numbers, addresses, tokens, secrets or the admin key. Sender IDs are masked to their last 4 characters. Reply logs contain only the rule name, step, message IDs, counts and Meta's error codes; order logs contain only the order id, product id, quantity and total. Customer phone numbers and addresses exist only in the in-memory orders and are shown only to callers with the admin key.
- Customers only ever see their own orders (and only id, product, quantity, total and status), never other customers' data and never phone numbers or addresses.
- The Page access token is used only in the `Authorization` header of the Send API call. It is never put in a URL, a query string or a log, and any occurrence of it in an error message from Meta is replaced with `[redacted]`.
- Calls to the Graph API have a 10 second timeout, so a slow Meta response cannot hold resources forever. The webhook answers `200` before any reply is sent, so a slow or failing Send API never makes Meta retry the delivery.
- Auto-reply is opt-in: it only runs with `ENABLE_AUTO_REPLY=true`, and the server refuses to start if that is set without a real token and Page ID.
- Loop prevention: the Page's own messages and echoes are never answered, and the Page ID of every event must match `FACEBOOK_PAGE_ID`.
- The bot sends **no proactive messages**: every message answers a customer message or button tap, so everything stays inside Meta's 24-hour window. Changing an order's status through the API does not notify the customer.
- Replies never retry automatically, to avoid sending a customer the same message twice. A one-time draft id per order summary keeps a repeated Confirm from creating a second order.
- If the App secret, verify token, Page access token or admin key leaks, rotate it (for the Page token see section 10), update your environment, and restart.
