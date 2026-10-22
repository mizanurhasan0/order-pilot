# OrderPilot Dashboard

An admin dashboard for testing the OrderPilot Messenger bot, locally or on Vercel. It lists the orders the bot collects, lets you confirm or cancel them, and lets you browse the product catalog. Built with Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript and axios.

## Architecture

```
Browser
  └─ components/            UI only
       └─ hooks/            React data hooks (loading, errors, polling)
            └─ services/    axios calls to same-origin /api/* and /health
                 └─ proxy.ts   local-only checks, adds X-Admin-Key on /api/orders
                      └─ Express API (../api) on http://127.0.0.1:3000
```

- **Components never call services directly; they use hooks.** Services are plain axios functions with no React; hooks wrap them with state.
- The browser only talks to the Next.js origin. `proxy.ts` rewrites `/api/orders*`, `/api/products*` and `/health` to Express and attaches the admin key on the server, so the key never reaches the browser and Express needs no CORS. Any other `/api/*` path gets a 404.
- Responses are Express's own JSON (`{ success, data, ... }`). Proxy errors add a `code` (`{ success: false, code, message }`) that `services/http.ts` turns into an `ApiError`.

## Folder structure

```
app/                 routes: /orders, /products, layouts, error and not-found pages
components/
  orders/            orders screen (table, cards, drawer, status actions)
  products/          catalog screen (search, category chips, cards, drawer)
  shell/             sidebar, top bar, backend connection pill
  ui/                shared primitives (drawer, alert, status pill, empty state, product image)
hooks/               useOrders, useOrder, useUpdateOrderStatus, useHealth, useOrdersUrlState,
                     useProducts, useProduct, useProductsUrlState, useCatalog
services/            http.ts (axios instance, ApiError), order.service.ts,
                     product.service.ts, health.service.ts
lib/
  types.ts           shared types for Express payloads
  orders.ts          order helpers (catalog index, image enrichment, status counts)
  format.ts          money, date and relative-time formatting
proxy.ts             same-origin gateway to Express (Next 16 proxy, formerly middleware)
```

## Setup

Requirements: Node.js 20.9 or newer, pnpm, and the Express API from `../api` running on port 3000.

```bash
pnpm install
cp .env.example .env.local   # then set ADMIN_API_KEY to the backend's value
pnpm dev
```

Open http://127.0.0.1:3001. The dashboard runs on port 3001; Express stays on 3000.

| Variable          | Default                 | Purpose                                                          |
| ----------------- | ----------------------- | ---------------------------------------------------------------- |
| `BACKEND_API_URL` | `http://127.0.0.1:3000` | Base URL of the Express API. Read by `proxy.ts` only.            |
| `ADMIN_API_KEY`   | none                    | Must equal `ADMIN_API_KEY` in the Express `.env`. Server-only.   |

Both are read on every request, so edits to `.env.local` apply without a restart. Never prefix them with `NEXT_PUBLIC_`. On Vercel, set them in the project settings (see "Deploying to Vercel").

## Express endpoints used

| Endpoint                                       | Admin key | Used by                                                                                                |
| ---------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/orders?status=`                      | yes       | Orders screen: list, status counts, 5-second polling                                                   |
| `GET /api/orders/:id`                          | yes       | Orders screen: order drawer                                                                            |
| `PATCH /api/orders/:id/status` `{ status }`    | yes       | Orders screen: confirm, cancel or reopen an order                                                      |
| `GET /api/products?page&limit&category&search` | no        | Products screen: search, category filter, pagination; full catalog for order images and category chips |
| `GET /api/products/:id`                        | no        | Products screen: product drawer                                                                        |
| `GET /health`                                  | no        | Shell: backend connection pill                                                                         |

## Security model

This dashboard is for testing. It has no login, so anyone who has its URL can see customer phone numbers and addresses and change order status. Use test data only, and do not share a deployed URL.

- **Same-origin, JSON-only writes.** Any method other than GET/HEAD needs an `Origin` matching the `Host` (else 403) and `Content-Type: application/json` (else 415), which blocks cross-site request forgery.
- **Admin key stays on the server.** `proxy.ts` drops any client-sent `X-Admin-Key` and `Cookie` header and adds the real key only to `/api/orders` requests. The key is never sent to the browser or logged.
- **No caching, hardening headers.** Proxied responses are `Cache-Control: no-store`; every page sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy` (see `next.config.ts`).

## Deploying to Vercel

Create a Vercel project from this repository with **Root Directory** set to `web` (Next.js is detected automatically). Under Settings > Environment Variables set:

- `BACKEND_API_URL`: the backend project's production URL, for example `https://orderpilot-api.vercel.app`. Use the production domain: preview URLs are behind Vercel's login.
- `ADMIN_API_KEY`: the same value as in the backend project.

Redeploy after changing either value.

## Limitations

- Without Redis configured on the backend, orders live in the Express process's memory and disappear when Express restarts.
- Customer names are not collected. The bot stores a phone number, an address and the Messenger PSID only.
- Updates arrive by polling every 5 seconds, not by push.
