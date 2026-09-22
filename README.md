# AutotradeX

Hosting migration: the new repository is [autotradegx2026/EVO-IILF](https://github.com/autotradegx2026/EVO-IILF). Netlify build configuration is included. Follow [NETLIFY_DEPLOYMENT.md](NETLIFY_DEPLOYMENT.md) for environment setup, verification and scheduler cutover. The previously verified Vercel deployment below remains the fallback until Netlify acceptance is complete.

A Next.js dashboard for user-confirmed trading signals, an Angel One broker adapter, paper trading, trade journaling, and analytics. The client strategy is implemented in generated Pine v5 exports and a shared TypeScript analysis engine. Open Strategy & Screener to configure parameters, export Pine and monitor watchlist alerts. See [STRATEGY.md](STRATEGY.md) for exact rules, setup, model differences and remaining work.

**Status: paper automation deployed at [evo-iilf.vercel.app](https://evo-iilf.vercel.app), with a verified Supabase minute scheduler; real-money trading remains disabled.** See [PAPER_AUTOMATION.md](PAPER_AUTOMATION.md) for hosted acceptance, [historical research](research/RESULTS.md) for 36 untuned strategy runs, and [broker readiness](research/BROKER_READINESS.md) for remaining integrations. The original product intent is in [PRD.md](PRD.md); repository conventions are in [CLAUDE.md](CLAUDE.md).

Operational panel sources and refresh behavior are documented in [DATA_STATUS.md](DATA_STATUS.md).

## Run locally

Use Node.js 22 and npm. Dependencies are locked in `package-lock.json`.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Configure the Supabase URL, anon key, service-role key, and a 64-character hexadecimal `ENCRYPTION_KEY`. This is a private workspace for `autotradegx2026@gmail.com`. Provision that account through Supabase administration and disable public signups in Authentication → Sign In / Providers. Passwords belong only in Supabase Auth, never in source or environment files. The registration route redirects to login. The former `create_user.js` helper is retired and does not create accounts or reset passwords.

The local app uses the same authenticated data flow as production. Start with `npm run dev` and sign in with your Supabase account. There are no generated dashboard records or demo sign-in bypasses. Empty accounts show empty states. Keep `DEMO_MODE` and `NEXT_PUBLIC_DEMO_MODE` unset or false; legacy server guards still reject writes if either is accidentally enabled.

## Database setup

Apply migrations `001` through `016` in order for a new installation. Migrations 005–010 were applied to the linked Supabase project on 6 September 2026 after a transactional rollback test; existing accounts and trades were preserved.

- `005_execution_integrity.sql`: atomic signal intake/audit/alerts, webhook rate limiter, execution reservation, uniqueness constraints, restricted audit writes, auth-profile sync, realtime publication.
- `006_trade_screenshots.sql`: private screenshot bucket and trade attachment paths.
- `007_alert_email_delivery.sql`: claim/retry state for optional email delivery.
- `008_strategy_screener.sql`: client strategy defaults, parameter/watchlist settings, native TradingView inbox and delivery claims.
- `009_paper_automation.sql`: atomic paper risk checks and exits, quote-currency equity, candle cursors, monitoring status and worker leases.
- `010_paper_scheduler.sql`: Supabase cron/HTTP worker invocation with credentials in Vault.
- `011`–`013`: durable broker execution, native scanning and the testnet HTTP scheduler.
- `014_ledger_alerts.sql`: transactional, environment-scoped lifecycle alerts.
- `015_ledger_annotations.sql`: paper/broker journal notes and private attachments.
- `016_personal_workspace.sql`: restrict authenticated database access to the personal account and disable prior accounts/entry automation without deleting history. Prior authentication identities are retained but cannot access application data. Application middleware and API handlers enforce the same identity. The original EVO-IILF strategy version remains unchanged for webhook compatibility.

Existing duplicate executions or multiple open trades for a user will cause migration 005 to fail. Reconcile those records against the broker before migration; never delete audit records just to satisfy an index. The execution guard permits one unresolved broker workflow per user; paper has a separate open-position guard.

After reviewing the linked staging project, the existing `npm run supabase:migrate` command applies migrations. Do not run it against an unreviewed production project. The checked-in database types are handwritten; generating replacements requires preserving the domain aliases imported throughout the app.

## Signal intake

`POST /api/webhook?uid=<user UUID>` stores qualified signals; it **never places live orders**. Live execution requires the authenticated `/api/trades/execute` endpoint with `signal_id`, `broker_account_id`, and `confirm: true`.

`POST /api/webhook/paper?uid=<user UUID>` creates a simulated trade at the supplied price, using 100,000 starting units per quote currency, realized equity and the configured risk percentage. WAIT and COOLDOWN do not open paper positions. Paper trades use separate trade counts, losses and cooldown history from live trades. Manual closes are simulation inputs, not observed broker fills.

Both webhook endpoints require `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of exact raw body>`. The secret is the saved user setting, with `WEBHOOK_SECRET` as fallback. An absent secret fails closed. The raw body limit is 16 KiB; the database rate limiter allows 60 requests per minute per reported source IP. Deploy behind a trusted proxy that supplies `x-forwarded-for`.

Example payload:

```json
{
  "symbol": "NSE:INFY-EQ",
  "action": "LONG",
  "price": 100,
  "sl": 95,
  "tp": 115,
  "confluence": 5,
  "tf": "15m",
  "timestamp": "<current ISO-8601 timestamp with timezone>",
  "strategy_version": "evo-iilf-1.0",
  "factors": { "trend": true, "vwap": true, "delta": true, "volume": true, "sweep": false, "fvg": true, "ob": false }
}
```

Timestamps are required and must be no more than five minutes old or one minute in the future. Entries require directional SL/TP geometry and a score of 0–7. Duplicate detection includes the user and paper/live mode. Sessions and daily risk boundaries use the configured strategy timezone (Asia/Kolkata by default). Cooldown uses the incoming signal's timeframe. Session validation is a configured time window, not an exchange holiday calendar.

TradingView's alert form is not an HMAC signing client. The new `/api/webhook/tradingview` endpoint authenticates a private per-user delivery token, strips it, and queues alerts. The strategy job signs them internally for the existing HMAC pipeline. The paper worker dispatches this inbox and monitors exits. Configure its authenticated schedule using Supabase cron and Vault. See [STRATEGY.md](STRATEGY.md). Existing third-party signing relays can continue using the original endpoints.

The replacement test sender only permits localhost destinations and targets the paper endpoint:

```sh
node --experimental-strip-types scripts/test-signal.ts
```

Set `TEST_USER_ID`, `WEBHOOK_SECRET`, and optionally `TEST_APP_URL` in the invoking environment. It does not load `.env.local` automatically. It creates a simulated record if validation passes; use a staging database.

## Automatic paper trading

In Strategy & Screener, save paper mode and a watchlist. For Binance USDT pairs, enable **Automatic Binance paper scanning** (one to five pairs). The worker evaluates completed candles while the browser is closed. For India equities and forex, install the generated Pine indicator and create an alert on all `alert()` calls with your private token and webhook URL. Keep **Send candles for automatic paper exits** enabled; entry-only alerts cannot provide automatic exits.

The worker simulates SL, TP and session-end exits from completed candles. Stops take precedence when both levels occur in one bar, stop gaps use the adverse open, and target gaps are capped at the target. Missing candles are disclosed instead of inventing fills. Paper positions remain monitored when the entry kill switch is active. The paper page shows worker health, latest candle, marks, unrealized PnL and monitoring errors. Manual closing remains a user-entered simulation.

Paper sizing uses quote-currency units, not broker lots. Supported symbols are NSE/BSE cash equities ending `-EQ`, `OANDA:` six-letter FX pairs and Binance USDT pairs. Notional is capped at equity; fees, funding, slippage and FX conversion are not simulated. Separate currency balances and sample statistics must not be added together.

Schedule `POST /api/jobs/paper` each minute with the server-only `CRON_SECRET`. Supabase stores the credential and app URL in Vault under `evo_paper_cron_secret` and `evo_paper_app_url`; `invoke_paper_worker()` sends the request. Activate with `cron.schedule('evo-paper-worker','* * * * *','select public.invoke_paper_worker()')`. Do not activate a duplicate Vercel cron. Current worker capacity per pass: ten queued deliveries, twenty open positions, five scanner accounts, with a bounded runtime; monitor backlog before adding more users.

## Broker execution boundaries

`LIVE_TRADING_ENABLED=false` is the default. Keep it false until all live acceptance items in PROJECT_STATUS are complete.

Angel One cash equities and Binance Spot (testnet first) use the durable execution ledger, saved runtime credentials and an explicit automation enable setting. A five-second Supabase job runs the testnet-only worker; real execution requires a persistent host and broker acceptance. Recovery covers partial fills, uncertain submissions, protective exits, sibling cancellation and session closing. See [BROKER_AUTOMATION.md](BROKER_AUTOMATION.md) for deployment, operational limits and acceptance commands.

## Journal, analytics and email

Risk, Analytics, Journal and Alerts use the execution ledger with separate paper/testnet/live views, account filters and quote-currency accounting. Notes, private screenshots, filtered CSV and scoped alert updates are supported. Incomplete costs and residual inventory remain explicit; legacy currency is UNKNOWN. See [LEDGER_REPORTING.md](LEDGER_REPORTING.md) for accounting rules, API filters, capacity limits and verification.

Optional email delivery uses `POST /api/jobs/alerts`, `Authorization: Bearer <CRON_SECRET>`, `ALERT_EMAILS_ENABLED=true`, `RESEND_API_KEY`, and a verified `RESEND_FROM_EMAIL`. Configure an external scheduler only after testing the sender. The database claims recent undelivered alerts with bounded retries; successful delivery updates `delivered_email`. No scheduler or email delivery was activated during local development.

## Verification

```sh
npm run check  # TypeScript, ESLint, regression tests
npm run build
```

Tests use Node's built-in runner and existing TypeScript; no testing package is required. Build uses system fonts so it does not fetch Google Fonts. Unit tests exercise calculation, parsing and order-state behavior; they do not prove production broker or Supabase behavior.

Next.js was updated from 14.2.5 to 14.2.35 within the repository's explicit 14.x constraint. See the [December 2025 security patch](https://nextjs.org/blog/security-update-2025-12-11). Next 14 is outside the currently listed LTS releases; a supported-major upgrade remains a production readiness decision ([support policy](https://nextjs.org/support-policy)).

## Responsive workspace

The dashboard uses a floating shadcn/Radix sidebar with grouped icon navigation, a saved desktop collapse preference and a mobile navigation sheet. The header toggle and Cmd/Ctrl+B control it; selecting a mobile link closes the sheet. The content area expands as the sidebar collapses. Cards, forms and tables share rounded surfaces, and wide trade tables scroll within their containers. Browser checks covered all twelve dashboard routes at phone width, with additional tablet and desktop checks. No new runtime package was required.

Paper logs show saved simulations only, from the signed-in account. Generated examples, fictitious signals/positions and simulated save/execution responses have been removed from the dashboard. Paper records never imply real-money broker fills.


Trading controls: use the Live Dashboard for broker Start/Stop, Paper Trading for independent simulated Start/Stop and market checks, Broker APIs for credentials, and Broker Orders for filled-order history. Migration 017 is required for these dedicated controls. See [PAPER_AUTOMATION.md](PAPER_AUTOMATION.md) and [BROKER_AUTOMATION.md](BROKER_AUTOMATION.md).
