# Bounded forward paper observation

This is a resumable research process using real, completed candles from Binance's [public market-data-only API](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only). It reads public prices and writes a local JSON report. It does not load environment files, broker credentials, account APIs, or execution adapters, and cannot place orders.

Completed observation: 6 September 2026, 11:43:57–12:13:57 UTC, 30 minutes. The committed `forward-study.json` contains 93 observations across BTCUSDT, ETHUSDT and SOLUSDT, zero trades, zero open positions and no data warnings. Startup warmup observations are included in that count. No win rate or profit factor can be inferred from this empty trade sample.

Compile and run from the repository root:

```sh
./node_modules/.bin/tsc --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck --outDir .test-build/forward scripts/forward-study.ts
node .test-build/forward/scripts/forward-study.js --minutes 30 --output research/forward-study.json
```

`--minutes` defaults to 30 and accepts finite values from 1 through 1,440. Each invocation ends after its observation window, allowing an in-flight public-data request to settle. `--help` reads no market data. Run the same command with the same output path to resume the portfolio. Use another explicit output path to start a separate study. SIGINT/SIGTERM saves the current state after any in-flight request and exits; open positions remain open for the next invocation.

The report is replaced atomically after each cycle using a flushed temporary file and rename. An exclusive adjacent `.lock` prevents concurrent writers. A stale lock belonging to a nonexistent local process can be recovered automatically. Malformed or foreign-host locks require inspection or a different output path. Existing reports must match the model hash and schema; incompatible reports are not silently reset.

## Fixed method

- BTCUSDT, ETHUSDT, and SOLUSDT; one-minute closed candles. The pair order is fixed and breaks ties when simultaneous setups qualify.
- The shared EVO-IILF engine uses `CLIENT_DEFAULTS`. **The sole strategy override is an all-day session, 00:00–00:00.** Asia/Kolkata remains the timezone for VWAP and portfolio daily limits; 1H/50 remains the higher-timeframe confirmation.
- One shared portfolio starts at 100,000 USDT, with at most one open position across all three pairs. Risk is 1% of realized portfolio equity, planned reward/risk is 3:1, and cooldown is ten one-minute bars from the previous entry signal.
- At most three entries per Asia/Kolkata civil day. New entries stop when that day's sum of realized losing trades reaches 3% of equity at the start of that day; winning trades do not offset this gross-loss counter. This is an entry lock, not a guaranteed maximum loss.
- Absolute entry notional is capped at available portfolio equity. Quantity is floored to a fixed 0.0001 base-unit increment, never increased to meet a minimum. This is a generic research increment, not an instrument-specific exchange filter.
- Each cycle obtains 2,000 completed base candles and 100 completed HTF candles for indicator warmup. The larger base window covers a whole civil day for VWAP. No settings are fitted or changed in response to observed performance.

## Forward entries and replayed exits

The first launch and every resumed invocation use already-closed candles for warmup only. A new entry is eligible only on the latest completed candle, once, when that candle closes **after that invocation began**. Missed historical setups are never entered retrospectively. Signals observed more than 90 seconds after their close are blocked. A failed pair data request blocks new entries for that cycle, while available data may still protect an existing simulated position.

An eligible entry is modeled at the actual signal candle's close, with the engine's stop and target. The report preserves the original `observedAt`, `signalCloseTime`, complete signal candle, engine snapshot, input-data hash, decision, and rejection reasons. `observedAt` is the local time the fetched dataset became available; it does not claim the order could have filled at that earlier close. Repeated observations do not overwrite prior records.

Existing positions replay every newly available candle in chronological order, up to 500 per cycle, using the shared `evaluatePaperBar` simulator. Stops take precedence if both levels are touched within a candle. Adverse stop gaps fill at the observed open; favorable target gaps conservatively retain the target. Each processed bar and its eventual observation time are saved, including bars fetched during recovery after a pause. The actual intrabar hit time remains unknown; the report uses the candle's exclusive close timestamp.

A missing position candle leaves the position unresolved and permanently halts new entries in that report. A backlog above 500 bars also records a persistent entry halt while exit replay continues in bounded batches. This avoids silently discarding unknown price paths. Inspect the warning and unresolved position; start a separate output file for a fresh study rather than treating a broken path as clean evidence. Other data outages are recorded as warnings and retried on subsequent minute-aligned cycles.

The process does not force-close a position at the observation window's end. The JSON summary therefore separates realized capital from marked unrealized PnL, and reports null profit factor when there are no realized losses. Marks may be stale during an outage. Full observations, processed position bars, trades, warnings, invocation times, and model parameters remain in the same report.

## Interpretation and model differences

A 30-minute run tests data intake, signal decisions and persistence. Position handling is exercised only if trades occur. It is **not strategy validation**; a small or empty sample cannot establish win rate, profit factor, or drawdown targets.

Fees, spreads, slippage, funding, and borrow costs are excluded. Shorts on Binance Spot candles are hypothetical research positions, not executable spot short orders. The no-leverage notional cap applies to both directions, and hypothetical short-sale proceeds do not expand the portfolio's capital.

This model intentionally differs from the historical backtester, which enters at the next open and can liquidate at end of data. The forward study models signal-close entry observed later and preserves open positions across invocations. It also differs from broker execution, which reconciles actual fills, commissions, exchange quantity filters, latency, and available balances. Stops here are candle simulations, not resting broker orders. An all-day session suppresses session-end exits for this study only.

EMAs are SMA-seeded over finite rolling warmup histories, so their values can differ slightly from a chart with a longer history. Public Binance candles do not validate TradingView feed parity, Indian equities, or a forex broker's prices. Retain the reports and evaluate longer out-of-sample periods, costs, data gaps, and actual broker acceptance separately before drawing conclusions.
