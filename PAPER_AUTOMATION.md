# Paper automation deployment

## Dedicated controls — 7 September 2026

Paper Trading (`/backtest`) owns **Start paper trading** and **Stop paper trading**. The switch is persisted in Supabase, survives browser closure/reload, and is independent of the broker switch. Native Binance scanning has its own one-to-five-symbol watchlist and timeframe. Shared strategy parameters, session and risk limits still apply. Starting native paper trading does not change broker watchlists or incoming broker signal delivery.

The minute worker reads actual Binance closed candles and saves its latest observation per symbol/timeframe, including price, candle time, score and reasons. It can report market checks outside the entry session; it submits new entries only inside that session. The page shows dated waiting/blocked/error results even when no trade qualifies. Paper logs contain only persisted simulations; historical research is collapsed separately and never populates paper logs.

Stopping rejects new native, webhook and manual paper entries at the database boundary. The same settings-row lock serializes entry creation with Stop. Open positions continue marks and SL/TP/session exits. TradingView positions still require confirmed-candle delivery. The global Risk pause blocks both paper and broker entries; neither Start button releases it.

Migration `017_trading_controls.sql` adds the switches, transition timestamps and protected observation table. Existing paper delivery choices are preserved without inventing a historical start time. Apply it before deploying the new worker. Rollback tests in `tests/sql/trading-controls.sql`, `paper-automation.sql` (wrap in BEGIN/ROLLBACK) and `ledger-alerts.sql` verify independent controls, rejection after stopping, continuing exits, accounting and privileges. Test fixtures are never persisted in the owner's ledger.


Target: https://evo-iilf.vercel.app · GitHub GrindX-Technologies/EVO-IILF · Supabase project itvcmfvvfemzykwtzvqd.

## Implemented

- Shared EVO-IILF strategy and generated Pine strategy/indicator.
- Opt-in, scheduled Binance USDT paper scanning without an open browser.
- TradingView BAR alerts with an optional entry for India cash equities and forex. One alert call per completed candle supplies entry and subsequent exit prices.
- Atomic account risk checks and paper entries; quote-currency equity starts at 100,000 and includes realized PnL. One open paper position per user, cooldown, daily limits and entry kill switch.
- Completed-candle SL/TP/session exits, conservative gap handling, idempotent marks and closes, recovery cursors, worker leases and error visibility. Entry kill switch does not stop protection.
- Manual closes are explicitly marked MANUAL. Direct client writes to paper history are denied. Two users cannot access each other's trades.
- Paper dashboard worker health, prices, unrealized PnL, last candle, monitoring errors and currency-separated sample statistics.

## Hosting

The existing Vercel project is linked to GitHub main. Vercel Hobby cannot schedule minute-level cron, so Supabase pg_cron invokes the authenticated Vercel paper job through pg_net. The credential and target URL are in Supabase Vault. No credential is stored in this repository. LIVE_TRADING_ENABLED is explicitly false in production.

Migrations 005–010 were applied on 6 September 2026 after a rollback test against the actual database. Existing accounts were preserved; there were no active live or paper positions at migration time. The application was deployed to production that day. Supabase cron job `evo-paper-worker` (job 1) is active every minute. Its first scheduled invocation at 10:54 UTC returned HTTP 200, with no timeout and a completed worker heartbeat reporting zero errors.

## Checks

- 56 automated tests, TypeScript, lint and production build passed.
- Transactional PostgreSQL assertions verify duplicate-entry rejection, marks, stale cursor rejection, TP accounting, repeated close safety, equity compounding and restricted client privileges.
- Updated Pine strategy and indicator compiled and ran on an AAPL 15-minute TradingView chart. This establishes compilation, not market-data parity or performance.
- Hosted HTTP acceptance passed with two temporary authenticated users: token validation, queue delivery, entry deduplication, automatic take-profit accounting, continued exit protection under the entry kill switch, duplicate exits, ownership isolation, forbidden direct paper writes and authenticated worker access. Test users and their fixture records are removed by the verification script.
- The production-hosted Binance scanner fetched and evaluated real BTCUSDT candles for an opted-in temporary account. Cleanup was checked directly: no verification users, queued fixtures or paper trades remained. One earlier verification attempt hit a network failure; a rerun with bounded requests passed all checks.
- Browser checks covered paper-mode scanner controls, demo settings save, watchlist rendering, paper monitoring fields and the manual-close dialog. An unsupported default intraday chart and inconsistent demo PnL examples were corrected.
- [36 historical strategy runs](research/RESULTS.md) were completed without parameter fitting. Twenty runs lost money before costs, fifteen gained, and one generated no trades; each had at most twelve trades. The client KPIs are not consistently achieved or statistically established.

## Model boundaries

This is a completed-candle simulator, not a broker fill model. Fees, funding, slippage, exchange tick/lot rules and cross-currency conversion are excluded. Quantities are shares or base-currency units, not MT5 lots. Paper shorts are hypothetical and do not imply Binance spot can place shorts.

Binance recovery reads up to 500 bars per fetch and resumes from the last persisted cursor. India/forex require a running TradingView BAR alert: an unavailable feed produces an explicit monitoring error; a missed price is never invented. A session exit after an outage uses the next observed open. If SL and TP are both touched in one candle, SL wins. A partial session-end candle is accepted.

Per worker invocation: ten inbox records, twenty open trades and five scanner accounts within a bounded runtime. Increase/test capacity before a larger rollout. Webhook token proves possession of the user's credential, not the truth of supplied market data.

## User setup

1. Open Strategy & Screener, select paper mode, enter supported symbols and save.
2. For Binance USDT, opt into automatic scanning for one to five pairs. For 24-hour markets, choose an appropriate session; equal start/end means all day.
3. For India/forex, download the updated Pine indicator, install it in TradingView, enter your private delivery token and execution-symbol override, and create a webhook alert on all alert() calls. Leave candle delivery enabled and keep the alert running while a position is open.
4. Open Paper Trading to inspect worker freshness and trades. A quiet strategy can correctly produce no entries; the PRD's performance targets are not established by compilation or these tests.

Angel One recovery is implemented in the execution adapter but awaits actual broker acceptance and live hosting. MT5 is outside the selected Binance-first scope. No live broker orders were placed during verification.


Hosted verification on 7 September 2026: the dedicated Start persisted the owner's explicit Binance BTCUSDT / 15m paper configuration. The scheduled production worker saved an actual market check at 02:39 IST, including the 02:30 closed candle, score 3/7 and session/strategy rejection reasons. No paper entry was fabricated or forced to qualify. Navigation/reload preserved the switch. Stop was exercised afterward. The automated suite had 127 passing tests; database rollback suites verified accounting, lifecycle alerts and independent control semantics. Real broker credentials were absent, and no broker orders were submitted.

## Explanation and history — 7 September 2026

Migration 019 locks shared strategy/risk settings while paper or broker automation is on. Stop the relevant runs before editing shared inputs. Native paper source/symbols/timeframe are locked until paper Stop. Stops do not disable position protection.

The latest check offers a factor-by-factor explanation with long/short scores, ADX, ATR and the required score. Paper analysis history keeps the first evaluation of each completed candle per configuration; repeated minute polling does not create duplicate history. It begins at this release and is separate from fills. The latest observation can show a later dispatch status; the trade ledger is authoritative for entries/exits. History is paginated to the latest 100 checks in the UI with its total count.

The owner's screenshot showed a legitimate WAIT rather than failed signal dispatch: 47 completed BTCUSDT 15m candles from Start through 14:45 IST yielded no qualifying setup. The replay and exact factor explanation are in [the diagnosis](research/PAPER_DIAGNOSIS_2026-09-07.md). No settings were loosened, owner trades inserted, or historical checks backfilled.
