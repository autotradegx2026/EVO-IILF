# Project status — 7 September 2026

The implemented platform includes the client EVO-IILF strategy engine and Pine exports, configurable screener and risk settings, scheduled paper trading, durable Angel One/Binance execution adapters, dynamic broker credentials and explicit automation controls. Binance Spot testnet was selected as the second broker implementation; MT5 is not implemented.

Risk, Analytics, Journal and Alerts now share the execution ledger with separate paper/testnet/live views and correct quote-currency separation. Notes, private screenshots, filtered CSV and durable lifecycle alerts are implemented. Migrations 001–019 are applied. Read [LEDGER_REPORTING.md](LEDGER_REPORTING.md) for accounting rules and reporting capacity limits.

Vercel hosts the dashboard/APIs. Supabase schedules paper work every minute and the testnet-only execution worker every five seconds. Real-money execution remains disabled. Credentials are entered and verified in Broker API Settings; saving credentials alone never enables orders. See [BROKER_AUTOMATION.md](BROKER_AUTOMATION.md) and [PAPER_AUTOMATION.md](PAPER_AUTOMATION.md).

## Verification

- 137 automated regression tests cover strategy, risk, ownership helpers, execution recovery, fee/residual accounting, reporting and alerts.
- TypeScript, ESLint and production build checks pass.
- Database alert assertions pass in a rollback transaction.
- Authenticated reporting acceptance against both the local production build and live Vercel site passed: two-user isolation, multi-currency totals, pagination/CSV, note protection, alert read scope and private screenshot uploads.
- Browser acceptance confirmed production analytics totals, environment/currency filters, journal draft preservation and saving, risk kill-switch persistence, and scoped alert read updates. Temporary fixture users and attachments were removed after verification.
- Reporting release `506b619` deployed successfully to the production alias. The post-release execution heartbeat was fresh, error-free and testnet-only.
- Previously recorded hosted execution acceptance verified configuration isolation, explicit enable controls, disconnected-account rejection, repeated fresh testnet worker heartbeats and an untouched live fixture. No actual broker orders were placed.

## Remaining external acceptance and scale work

- Connect an administrator's Binance Spot testnet credentials and run actual exchange order/OCO/cancel/close acceptance. Mocked recovery and database tests do not substitute for this.
- Angel One requires approved static egress, exchange trading dates and actual broker acceptance before real-money enablement. Derivatives and MT5 are outside the selected implementation.
- Accept the client's TradingView alert subscription and identical-feed Pine/TypeScript parity. Both Pine exports compile; no client chart subscription was created.
- Continue forward testing. The 36-run historical study and short forward observation do not validate the client's profitability targets. See [research/RESULTS.md](research/RESULTS.md) and [research/FORWARD_TESTING.md](research/FORWARD_TESTING.md).
- Verify the optional email sender and scheduler before enabling delivery. In-app alerts work independently.
- Plan supported-framework upgrade, broader load testing and SQL reporting aggregation before reaching the documented history/worker capacity limits.
- The account owner must rotate credentials exposed in historical commits or conversation. Existing Git history was not rewritten.

These external acceptance items do not require replacement of the implemented dashboard reporting. They remain prerequisites for claiming verified real-money trading or profitability.

## Workspace presentation update

The responsive shadcn sidebar and shared card/form/table styling are implemented, including mobile navigation and saved desktop collapse state. All twelve dashboard routes passed phone-width fit checks, with additional tablet/desktop checks. Generated demo data and the local authentication bypass have subsequently been removed: both local and deployed dashboards require sign-in and use account records. Missing saved settings are reported as unavailable.

## Signal and broker audit

Read-only strategy analysis, chart setup markers, hourly TradingView normalization and configuration revision fences are implemented. Routing now considers compatible fresh candidates and records bot dispatch outcomes. Broker credential fields and missing-connection Start blocking were checked in the browser. See [the latest verification details](BROKER_AUTOMATION.md#signal-to-execution-verification--7-september-2026) for the tested boundaries and the remaining exchange acceptance requirements.

## Locked run release — 7 September 2026

Start now atomically binds a verified broker, one compatible symbol and timeframe. It performs read-only instrument/balance checks, requires the intended worker environment and leaves all entry risk checks in force. Stop is required before changing a running strategy or instrument; the database enforces this across tabs and API clients. Existing unresolved executions block a new run. Paper Start/Stop stays independent.

TradingView entries must report all actual strategy inputs and match saved settings. Download current exports and recreate existing entry alerts; old entry payloads are rejected. Candle-only delivery continues exit monitoring. Native Binance analysis reads the same saved engine configuration.

Paper observations now include the seven real factor results and append a dated history of first checks per completed candle/configuration. No past trades or checks are invented. The screenshot investigation replayed 47 actual BTCUSDT candles and found no qualified entries; see [evidence](research/PAPER_DIAGNOSIS_2026-09-07.md).

The live deployment still requires a persistent live worker and broker acceptance. A client cannot start real orders with API credentials alone on the current testnet-only worker. Paper testing is optional in the product; operational live hosting and broker prerequisites remain required.

Both regenerated Pine exports compiled and updated successfully on the TradingView chart on 7 September (strategy 15:13 IST, indicator 15:14 IST). No alert or real order was created by compiler verification.

Production release `0a1e54c` reached Ready on Vercel. The 15:18 IST scheduled paper pass completed with zero errors, persisted actual factor/ADX/ATR data and created the first dated history row. Paper remained on with its original Start time and zero trades; the broker worker heartbeat was fresh and testnet-only. Hosted controls require broker/symbol/timeframe and disable Start with no connected account.

Client setup and the outstanding live-host/broker acceptance requirements are collected in [CLIENT_HANDOFF.md](CLIENT_HANDOFF.md).
