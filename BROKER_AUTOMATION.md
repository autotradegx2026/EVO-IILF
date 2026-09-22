# Broker automation operations

The dashboard's **Broker API Settings** (`/broker`) accepts encrypted, per-user Angel One or Binance Spot credentials. Binance defaults to **testnet**. Credentials are entered at runtime; adding an account does not authorize orders. Missing or invalid credentials produce a connection notice. A verified selected account, signal mode/watchlist, running worker, environment gate and explicit saved enable action are all required for automatic entries. Manual entries use the same durable execution ledger.

## Worker deployment

Vercel hosts the dashboard and authenticated APIs. For **Binance testnet**, Supabase runs `invoke_testnet_execution_worker()` every five seconds through the authenticated Vercel endpoint. Migration 013 records HTTP request IDs for verification. It skips invocations while a worker holds a fresh lease. This endpoint only processes testnet accounts, even if the live environment flag is later enabled. The existing one-minute paper scheduler remains separate.

For real execution, use a persistent Node 22 host with the broker's required egress. Stop the Supabase testnet execution job before switching to this worker, because both intentionally share one execution lease:

```sh
npm ci
npm run execution:build
npm run execution:worker
```

Or build `docker build -f Dockerfile.execution -t evo-execution .` and run with a private environment file and restart policy:

```sh
docker run -d --name evo-execution --restart unless-stopped --env-file /secure/evo-worker.env evo-execution
```

Set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the existing `ENCRYPTION_KEY` to the same project values as Vercel. Set `BROKER_TESTNET_ENABLED=true` on worker and Vercel for testnet use. Keep `LIVE_TRADING_ENABLED=false` until broker acceptance is complete. Broker credentials come from the dashboard/database, not worker environment variables. Do not rotate the encryption key without migrating encrypted accounts.

The standalone worker polls after each pass, renews a database lease, and publishes health. New entries require a heartbeat within 15 seconds. Deploy only one intended worker; the database lease excludes overlapping workers. Restart monitoring is necessary. The HTTP `/api/jobs/execution` endpoint authenticates with `EXECUTION_WORKER_SECRET` when configured, otherwise the existing `CRON_SECRET` stored in Vercel and Supabase Vault. The installed Supabase invoker uses that existing Vault secret. Updating the HTTP secret also requires updating its scheduler credential. No secret is embedded in cron command text.

The scheduled testnet setup is subject to Supabase/Vercel availability and quotas. Five-second dispatch is a cadence, not a guaranteed fill or recovery latency. Stale worker health prevents new entries; native Binance OCO protection remains at the exchange after acceptance. A persistent worker is still the required deployment for real execution. Retain seven days of request IDs and scheduler run history with the installed daily retention job. The Docker recipe is supplied but was not image-built in this workspace, which has no Docker runtime.

Angel One requires eligible hosting with registered static egress and configured local/public IP headers. Maintain `ANGEL_TRADING_DATES` as a comma-separated allowlist of actual exchange trading dates. `ANGEL_SQUARE_OFF_TIME` defaults to `15:00` India time, before the broker cutoff. All-day strategy sessions have a maximum holding window of 24 hours.

## Order recovery and accounting

Migrations 011–013 add a service-only credential store, execution settings, worker lease, execution ledger, audit events and native scanner observations. The previous synchronous reservation function is revoked. Entry intent is persisted before any submission. Unknown outcomes are reconciled by permanent IDs and are never blindly retried. A rejected order is distinct from a timeout. Partial entries cancel unfilled remainder before protecting confirmed fills. Cancellation acknowledgement alone does not authorize another exit: terminal broker state is required.

Binance Spot is long-only and uses the selected environment's market data and native OCO protection. Angel One uses a broker stop and a worker-monitored target. Stops, targets, session exits, close requests and pending-order cancellation continue while new entries are disabled. Lost credentials/network access can prevent reconciliation; broker-held protection and visible ATTENTION records are not proof that the account is flat. Inspect the broker account before resolving unknown orders. External manual orders are not imported into this ledger.

The Broker Automation ledger contains actual fills, fees, gross PnL, outstanding intents and residual inventory. Risk, Analytics, Journal and Alerts now read this ledger with separate paper/testnet/live and currency views. Legacy records remain separately labeled. See [LEDGER_REPORTING.md](LEDGER_REPORTING.md). Binance commissions in other assets are disclosed without invented quote-currency conversions; subminimum residual inventory is explicitly retained and displayed. Angel One fee totals are unavailable and labeled accordingly; use broker contract notes for net accounting. `CLOSED` with residual inventory means the executable order workflow ended, not zero inventory.

## Verification and acceptance

Verified on 6 September 2026: production build, strict worker compilation, lint and all 105 automated tests passed. Database ownership/risk/lease assertions passed before migrations were applied. Authenticated tests against the production Vercel site passed for two-user isolation, credential non-disclosure, explicit enable, disconnected-account rejection and blocked credential replacement during unresolved execution. The active five-second Supabase job produced at least 15 HTTP 200 responses; a separate acceptance check observed 10 changing fresh heartbeats and confirmed that a live-account fixture remained untouched. No broker orders were placed. The normal paper scheduler remains active.

Run `npm run check`, `npm run build`, and `npm run execution:build`. SQL assertions in `tests/sql/broker-execution.sql` run inside a transaction with rollback. Fault-injection tests cover ambiguous submissions, partial fills, overfills, cancellation races, restart recovery, session closing, pre-entry revocation and fee/dust accounting. These do not replace exchange acceptance.

Once an administrator connects a Binance Spot testnet account in API Settings, pause `evo-testnet-execution` in Supabase Cron (or stop the standalone worker) temporarily and use its account UUID with the explicit acceptance command:

```sh
npx tsc --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck --outDir .test-build/broker-acceptance scripts/verify-broker-testnet.ts
node .test-build/broker-acceptance/scripts/verify-broker-testnet.js --place-testnet-orders --account-id=ACCOUNT_UUID
```

This places virtual orders only, capped at 100 USDT notional and a 1 USDT planned risk budget. It verifies market fill, native OCO, confirmed cancellation, close and commission accounting. It creates an isolated application fixture and retains its ledger if recovery is incomplete. Resume the scheduled job or standalone worker afterward. Credentials can be supplied later through the dashboard. No testnet account was supplied during implementation, so actual exchange acceptance remains pending. Angel One acceptance also remains pending. MT5 is outside the selected Binance-first implementation.

Forward testing methodology and observations are in `research/FORWARD_TESTING.md` and `research/forward-study.json`. Short observation windows, zero trades, and passing software tests establish no profitability claim. The client's win rate, profit factor and drawdown targets are not validated.

References: [Binance order and OCO API](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/trade), [Binance Spot testnet](https://developers.binance.com/en/docs/products/spot/testnet), [SmartAPI](https://smartapi.angelone.in/docs), [Angel One static-IP announcement](https://www.angelone.in/news/market-updates/what-s-changing-in-angel-one-s-smartapi-access-from-april-1-2026).


## Dedicated user controls (7 September 2026)

- Live Dashboard `/`: select a saved broker account, review the explicit real-money/testnet authorization, then Start. Stop is a separate immediate server action and requires no working broker credentials or healthy worker. A Stop blocks new automatic entries and leaves reconciliation/protection running. Unknown in-flight submissions still require reconciliation; Stop cannot recall an order the exchange already accepted.
- Broker APIs `/broker`: credential entry, verification and replacement only, plus webhook endpoint settings. Connecting does not start orders.
- Broker Orders `/automation`: separate Live/Testnet views of persisted broker executions, fills and close requests. No credential form or duplicate enable switches.
- Paper Trading `/backtest`: independent paper switch and native Binance watchlist. It cannot enable broker execution.

Production live execution remains subject to `LIVE_TRADING_ENABLED`, a continuous live-capable worker, verified account credentials and strategy/risk gates. Dashboard controls do not change deployment environment gates. Actual broker acceptance remains pending valid account credentials; a successful UI or SQL test is not exchange acceptance.

## Signal-to-execution verification — 7 September 2026

The dashboard and Charts page now show authenticated, read-only analysis with LONG/SHORT/WAIT, actual closed candles, confluence, SL/TP, setup markers and current dispatch blockers. Native Binance analysis uses the same engine and history warmup as paper and broker scans. When a Binance account is selected, its testnet/live candle environment is used; a public spot preview is labelled explicitly. Chart setup markers never imply an exchange fill. Broker Orders and the paper ledger remain the execution records.

Angel One receives the exported TradingView strategy's alerts. Allowlisted candle-only deliveries are retained for chart context, including while flat. Standalone entries can be displayed without inventing OHLC candles. Saved changes apply immediately to native analysis; recreate the TradingView script/alert after changes to its inputs. The embedded TradingView drawing chart is an optional reference, not the order dispatcher. Hourly Pine entries (`60m`) are normalized to the saved `1h` execution timeframe.

Migration 018 separates actual execution configuration changes from paper scan/Start/Stop timestamps. Native intake and broker queueing fence the saved configuration revision under the settings lock. Operational paper updates no longer cancel valid queued broker entries. Automatic routing checks several recent eligible candidates so a Spot SHORT, other-account signal, changed configuration or incompatible market does not mask a valid candidate. Candidate dispatch results are retained on the signal; queued signals remain visible with a link to the execution ledger. Session/risk waits do not report the worker itself as failed.

Verification includes strategy LONG and SHORT fixtures, changed confluence, stale/future timestamps, account/market routing, one-hour TradingView delivery, Binance history pagination and Angel recovery spacing. Database assertions for paper entries/exits, broker reservation/ownership, Start/Stop, reporting alerts and configuration fencing run in rollback transactions. No fixture data is kept in the owner's account, and no exchange order is submitted by these tests.

Actual exchange acceptance remains pending administrator-provided credentials. Connecting credentials verifies authentication and keeps automatic entries off. Binance Spot supports long entries with sell exits, not opening short positions. Angel One needs valid chart alerts, approved execution hosting/calendar configuration and a continuous live-enabled worker; the deployed worker is currently testnet-only and the live environment gate is off. Paper automation uses its separate Start/Stop control and can run on the server while the browser is closed.

## Locked run setup — 7 September 2026

Migration 019 adds an atomic Start operation: choose a verified broker account, compatible symbol and 1m/5m/15m/1h candles, then authorize automatic orders. The server verifies instrument support and available funds; order sizing still rechecks available funds, lot/tick rules and configured risk at submission. Start rejects unresolved prior executions. Broker, symbol, timeframe and shared strategy settings remain locked until Stop, including edits from another browser tab.

TradingView entry alerts now carry all actual Pine inputs in `strategy_config`. Missing or changed inputs are rejected before entry persistence, with a reason in webhook logs. Re-download and recreate existing alerts. Candle-only alerts remain usable for protection of existing paper positions. Native Binance scanning does not require these alerts.

137 automated checks, production and standalone worker compilation pass. Database rollback suites cover locked runs, signal revision fencing, trading controls, broker recovery, paper accounting and ledger alerts. These are software acceptance results; actual Binance/Angel order acceptance remains pending credentials. The deployed testnet worker intentionally cannot trade real funds.
