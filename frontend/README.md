# DTD Store Frontend — Next.js 14 (App Router)

## Setup
```bash
cd frontend
npm install
```

## Environment variables
Create `.env.local`:
```
NEXT_PUBLIC_API_URL=https://your-api.domain.com
```

## Run
```bash
npm run dev   # http://localhost:3000
npm run build
npm run start
```

## Pages
- `/` — Storefront landing + product grid
- `/dtdshopcc` — Gated catalog (requires verified $5+ deposit)
- `/payment` — Checkout flow (email → payment method → crypto hash / Paystack → delivery)
- `/chat` — Store chat feed + callback requests
- `/trade` — Spot Desk trading console
- `/smtp` — SMTP Vault admin console

## Integration notes
- All API calls go through `frontend/lib/api.ts` with `credentials: 'include'` for HttpOnly cookies.
- Zustand stores in `frontend/lib/store.ts` manage cart, checkout step state, and UI.
- Telegram WebApp integration in `frontend/lib/tma.ts` + `TelegramTheme`, `BackButton`, `MainButton` components.
- WebSocket / long-poll helper in `frontend/lib/websocket.ts` for live chat + ticker.
- Validation with Zod in `frontend/lib/validation.ts`.

## Deploy to Cloudflare Pages
```bash
npx wrangler pages deploy frontend/out --project-name=dtdpaymentsbot
```
Or connect your GitHub repo to Cloudflare Pages with build command `npm run build` and output directory `.next`.
