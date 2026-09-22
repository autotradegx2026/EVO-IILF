# EVO-IILF Institutional Hybrid Framework PRO

Implementation specification, 6 September 2026. Source: the client's PRD pasted into the project conversation. There was no pre-existing Pine script; the repository now generates it. This document supersedes older strategy defaults and crossover-based research logic in PRD.md/CLAUDE.md. The requested product direction is user-configured automatic trading, with Angel One for India and Binance Spot testnet first as the selected second broker. See BROKER_AUTOMATION.md for the implemented engine and remaining worker-host and exchange-acceptance requirements.

## Included deliverables

- `lib/strategy/config.ts`: validated parameters, client defaults and settings mapping.
- `lib/strategy/engine.ts`: deterministic closed-candle analysis shared by research backtests and Binance spot scans.
- `lib/strategy/pine.ts`: one generator for a Pine v5 strategy and screener indicator.
- `public/strategies/evo-iilf-strategy.pine`: Strategy Tester/chart export with simulated entry and bracket exits.
- `public/strategies/evo-iilf-indicator.pine`: indicator with numeric Pine Screener columns and LONG/SHORT alert conditions.
- `/screener`: strategy editor, watchlist, exports, delivery setup, received-signal table and optional Binance public-data analysis.
- `/api/webhook/tradingview`: authenticated native TradingView inbox, with a separate private delivery token.
- `/api/jobs/strategy`: service-side inbox worker feeding the existing HMAC/risk pipeline.

Regenerate the checked-in default exports with `npm run strategy:export`. The dashboard exports its visible parameters; authenticated `GET /api/strategy/script?kind=strategy` (or `indicator`) exports saved parameters. No credentials are embedded in exported files.

## Exact rule choices

| Component | Implemented rule / default |
| --- | --- |
| Trend | EMA 200, fast EMA 20, HTF EMA 50 on 60 minutes. Long: close > trend EMA, fast > trend EMA, close > HTF EMA; short is the inverse. No crossover required. Trend alignment is mandatory for direction and also earns one point. |
| HTF | Previous confirmed HTF EMA is used from the next base-bar open. Equal chart/HTF intervals use the current confirmed local EMA. Lower HTF is invalid. |
| VWAP | HLC3 × volume cumulative daily VWAP, reset at civil midnight in the chosen timezone. Above is bullish; below is bearish. |
| ADX | Wilder direction/trend strength, length and smoothing 14. Strictly > 20 is required; it is not a scoring factor. |
| Volume | Volume strictly > SMA(volume, 20) × 1.5. The average includes the current bar. Scores a point; also required for an order block. |
| Delta proxy | Bull candle: +volume; bear: -volume; doji: zero. EMA smoothing 14 (PRD left smoothing length unspecified). Not taker-volume or true bid/ask delta. |
| Liquidity sweep | Previous 10 highs/lows exclude the signal candle. A low below the prior minimum plus a bullish body supports long; a high above the prior maximum plus a bearish body supports short. No additional reclaim condition was specified. |
| Displacement | Current bullish or bearish candle body strictly > ATR × 0.8. |
| FVG | Current low > high two bars ago plus current bullish displacement, or current high < low two bars ago plus current bearish displacement. The PRD's current-candle wording is used rather than middle-candle displacement. |
| OB | Previous opposite-color candle, current close beyond its high/low, matching displacement and high volume. No persistent OB/FVG mitigation-zone model is implied. |
| Volatility | ATR(14) strictly > SMA(ATR,20), including the current ATR. |
| Session | 09:30–15:30 Asia/Kolkata. Start inclusive, end exclusive; entire signal candle must fit. Equal times mean all day. UTC, London and New York are also selectable; local DST is respected. A single session applies to the current user watchlist. |
| Scoring | Exactly trend, VWAP, delta, volume, sweep, FVG and OB, each +1. Default minimum 5. Disabled optional factors give zero points; an unattainable score is rejected. |
| Stop | Long: signal low − ATR × 1.5. Short: signal high + ATR × 1.5. This resolves the PRD's conflicting entry ± ATR shorthand in favor of its explicit candle-extreme rule. |
| Target | Entry ± actual stop risk × 3. Pine rounds stops/targets outward to the chart tick. TypeScript research does not yet apply exchange tick rules. |
| Size | Default 1% equity divided by stop risk. Pine includes `syminfo.pointvalue` and rounds down to a configurable quantity step. Broker execution independently calculates accepted units/lots; chart units are not MT5 lots. |
| Cooldown | From entry signal; another setup may occur after at least 10 bars. Open-position restrictions remain separate. |

EMA uses an explicit SMA seed in both implementations. ATR seeds the first 14 true ranges requiring a previous close; Pine uses `ta.rma(ta.tr(false), length)` for this convention. These choices make finite-history seeds explicit. Pine compilation passed; exported market-data comparison remains necessary before claiming bar-for-bar parity.

## Differences between research, screening and execution

Pine strategy simulation uses signal-close processing (`process_orders_on_close=true`), a single position and simulated bracket orders. The TypeScript backtest deliberately uses the next candle's open, preserves the structural stop, recalculates size/target using the actual simulated entry, rejects gaps through the stop, and resolves ambiguous stop/target touches to the stop. Its initial capital is 10,000 quote-currency units; Pine starts at 100,000. Thus their P&L and trade counts are not expected to match exactly. Neither establishes broker fills or guarantees target KPIs.

The Pine indicator has no account/position state. It reports score/gate/cooldown setups and can emit another setup while a real position exists. The server independently checks account risk and open trades. The Binance scan button is stateless analysis, not an always-running scanner or an order command; it does not model account cooldown. India and forex watchlist rows use received TradingView alerts rather than invented OHLCV data.

Forex volume may be tick volume or absent. Missing/zero volume does not fabricate participation or VWAP. Feed-specific symbol prices and volume can change results. Conversion between MT5 account currency, tick value, contract size and lot step still requires the MT5 adapter. Current paper trading uses the existing simplified 100,000-unit model, not a validated forex-account simulator.

The PRD's win rate >50%, PF >1.5 and drawdown <15% are evaluation targets, not achieved results. Fees, spread, slippage, financing, borrow, exchange calendars, partial profit-taking, news filters and AI optimization have not been added by this strategy pass. Session filtering restricts entries; live session-end square-off and automatic paper exits remain separate unfinished work.

## TradingView setup

1. Sign in to the application, open **Strategy & Screener**, and load the client defaults if replacing an older configuration. Review risk controls and save. Existing accounts' numeric choices are preserved by migration.
2. Add exact delivery symbols and select the chart/scan timeframe. For example, a `NSE:RELIANCE` chart uses delivery override `NSE:RELIANCE-EQ` for the current narrow Angel One cash adapter. An index is not automatically mapped to a futures/options contract. Forex display symbols remain distinct from MT5 broker symbols.
3. Export the strategy for a chart/Strategy Tester, or the indicator for Pine Screener. Paste it into Pine Editor, compile and add to the appropriate chart. The built-in dashboard chart widget does not run Pine.
4. For Pine Screener, favorite the indicator, select a watchlist and filter **Signal** to 1 or -1. Use Long score/Short score for ranking. Pine Screener runs indicators, not strategies; it uses only 500 chart bars and supports restricted request/timeframe inputs. This export uses one `request.security` call and an `input.string` HTF selector.
5. For webhook delivery, save an allowlist and mode, then create a private delivery token. Set that token in the private chart script input; never publish it. Rotation invalidates the previous token. The token is stored as a SHA-256 hash by the app and shown once.
6. Create a chart alert on **alert() function calls only**, with the generated JSON supplied by the script and the dashboard's TradingView URL. Do not select broker-emulator order fills or create live exit actions from simulated fills. Optional popup/mobile/email choices belong to TradingView's alert configuration.
7. Recreate alerts after changing any script inputs/settings; TradingView alerts retain a snapshot. A Pine Screener scan does not itself install per-symbol chart alerts.

See [Pine Screener requirements](https://www.tradingview.com/support/solutions/43000742436-tradingview-pine-screener-key-features-and-requirements/), [Pine alerts](https://www.tradingview.com/pine-script-docs/v5/concepts/alerts/), and [confirmed HTF requests](https://www.tradingview.com/pine-script-docs/concepts/repainting/).

## Deployment and inbox acceptance

Apply migration 008 after 005–007 in the selected staging project. It adds parameter/watchlist/delivery settings, an RLS inbox and a service-only claim function. No remote migration or schedule was activated during implementation.

The native TradingView endpoint checks the private token, active user, bounded body, rate limit, version, timestamp, exact factor arithmetic, symbol allowlist, timeframe and kill switch before queueing. It strips the token before any application persistence. HTTPS and trusted proxy headers are deployment requirements. A token authorizes signal submission; it does not prove the sender is TradingView or prove the supplied market calculations. Treat it as a credential and avoid request-body logging at the proxy.

Configure Supabase cron to POST `/api/jobs/paper` every minute with `Authorization: Bearer <CRON_SECRET>` from Vault. This job also dispatches the strategy inbox; do not run a duplicate strategy schedule. This is a deployment requirement, not a Codex reminder/automation. The worker claims at most 10 records, uses per-claim tokens, rechecks account/mode/watchlist/timeframe, signs the stripped JSON internally with the user's HMAC key, and invokes the existing webhook pipeline. Expired signals are rejected. Failed transient attempts retry up to three times; expired exhausted leases are terminalized. Capacity, HTTP acknowledgement within TradingView's time limit, and concurrency must be tested in staging. [TradingView webhook transport requirements](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/)

`QUEUED` means persisted for processing. `DONE` means a terminal pipeline response, which can still be a risk rejection. Read the recorded result. Paper mode opens simulated entries and the paper worker monitors completed candles for SL, TP and session-end exits; signals mode displays qualified signals for confirmation. Neither mode automatically submits live orders.

Staging acceptance must cover two-user isolation, token rotation, wrong/missing token, allowlist/timeframe changes, duplicate deliveries, expired timestamps, concurrent claims, crashes after downstream persistence, exhausted attempts, database failures and every risk rejection. The inbox is not a broker order reconciliation worker.

## Broker completion

- **Angel One / India:** existing cash adapter; live default-off. Still needs durable broker fill recovery, protective-order recovery, sibling cancellation, session-end closing, tick rules and acceptance in the intended broker environment.
- **MT5 / forex:** chosen integration target; no working bridge is claimed. Need the actual MT5 broker/server, terminal host, broker symbol/lot/tick specifications and an isolated practice account. Implement terminal-side order acknowledgements, idempotency/recovery, attached protection and account-currency sizing before activation. [Official MT5 integration](https://www.mql5.com/en/docs/python_metatrader5)
- **Binance / crypto:** current public spot analysis/backtest provider. No Binance execution adapter, API-key connection or futures/short capability has been implemented. [Official Binance API catalog](https://developers.binance.com/en/docs/catalog)

## Verification

56 persisted automated tests and a production build passed. Browser checks verified the dashboard, watchlist editing, demo saving and impossible-score errors. The export button produced its prepared-file confirmation without browser console errors; browser download-event capture timed out, so file-save behavior needs confirmation in the target browser. Both default Pine files were generated on disk.

After TradingView sign-in, both generated Pine v5 files compiled and ran on the AAPL 15-minute chart, including the updated BAR delivery versions. The strategy correctly rejected a daily chart with the default 1-hour HTF. The AAPL check used the default India session and produced no trades; it validates compilation and basic runtime, not performance. Pine Screener scanning, market-data parity and performance acceptance remain unverified. No script was published, no alert subscription was installed, and no real trade was placed. Migrations 005–010 passed transactional SQL assertions and were applied to the linked Supabase project. Deployed HTTP acceptance is recorded in PAPER_AUTOMATION.md. Historical research covers 36 untuned runs in research/RESULTS.md and does not establish the client KPIs.

## Paper automation release

See PAPER_AUTOMATION.md for deployment and acceptance results. Generated Pine now sends one BAR envelope per completed candle, with an optional entry. Keep this mode enabled for India/forex exits and keep the alert running after disabling entries. Binance USDT paper scans are opt-in, server-scheduled, and use public market data. Sizing starts with 100,000 units per quote currency plus realized PnL, caps notional at equity, and floors quantities to one share or 0.0001 base units. The model excludes broker contract multipliers, fees, slippage and FX conversion.
