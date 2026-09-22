# EVO-IILF historical research

Generated 2026-09-06T10:52:15.150Z. Strategy evo-iilf-1.0.

## Method

Three spot pairs, two timeframes, three fixed historical endpoints, 1,500 completed candles per dataset. Each dataset is evaluated with unchanged client defaults and with only the session changed to all day; both retain Asia/Kolkata VWAP resets. No parameters were fitted to these results. Indicator warmup consumes the first 199 bars. Each run starts with 10,000 quote-currency units. Results from overlapping assets or timeframes are not independent portfolio returns.

The data source is Binance's [official public market-data API](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only). Dataset boundaries, SHA-256 hashes, full parameters, trades and filter counts are in [strategy-results.json](strategy-results.json). Run: compile scripts/research-strategy.ts with TypeScript (ES2022, CommonJS, esModuleInterop, skipLibCheck), then execute the generated script from the repository root.

## Results

| Pair | TF | Exclusive endpoint | Session | Trades | Win rate | Profit factor | Net PnL | Max drawdown |
|---|---|---|---|---:|---:|---:|---:|---:|
| BTCUSDT | 15m | 2026-01-01 | client-hours | 2 | 0.0% | 0.00 | -199.00 | 2.49% |
| BTCUSDT | 15m | 2026-01-01 | all-day | 10 | 10.0% | 0.32 | -590.77 | 8.29% |
| BTCUSDT | 1h | 2026-01-01 | client-hours | 3 | 33.3% | 1.46 | 95.03 | 2.50% |
| BTCUSDT | 1h | 2026-01-01 | all-day | 9 | 33.3% | 1.72 | 382.16 | 4.95% |
| ETHUSDT | 15m | 2026-01-01 | client-hours | 2 | 0.0% | 0.00 | -199.00 | 2.57% |
| ETHUSDT | 15m | 2026-01-01 | all-day | 7 | 14.3% | 0.49 | -302.75 | 4.83% |
| ETHUSDT | 1h | 2026-01-01 | client-hours | 0 | 0.0% | 0.00 | 0.00 | 0.00% |
| ETHUSDT | 1h | 2026-01-01 | all-day | 3 | 66.7% | 3.44 | 251.39 | 1.91% |
| SOLUSDT | 15m | 2026-01-01 | client-hours | 1 | 0.0% | 0.00 | -100.00 | 1.00% |
| SOLUSDT | 15m | 2026-01-01 | all-day | 8 | 12.5% | 0.41 | -399.73 | 8.05% |
| SOLUSDT | 1h | 2026-01-01 | client-hours | 1 | 0.0% | 0.00 | -100.00 | 1.40% |
| SOLUSDT | 1h | 2026-01-01 | all-day | 8 | 25.0% | 0.63 | -222.47 | 6.43% |
| BTCUSDT | 15m | 2026-04-01 | client-hours | 3 | 66.7% | 5.88 | 502.91 | 1.74% |
| BTCUSDT | 15m | 2026-04-01 | all-day | 9 | 22.2% | 0.96 | -22.83 | 4.30% |
| BTCUSDT | 1h | 2026-04-01 | client-hours | 1 | 0.0% | 0.00 | -100.00 | 1.00% |
| BTCUSDT | 1h | 2026-04-01 | all-day | 5 | 0.0% | 0.00 | -490.10 | 5.91% |
| ETHUSDT | 15m | 2026-04-01 | client-hours | 1 | 100.0% | No losses | 300.00 | 0.29% |
| ETHUSDT | 15m | 2026-04-01 | all-day | 12 | 33.3% | 1.17 | 141.13 | 4.76% |
| ETHUSDT | 1h | 2026-04-01 | client-hours | 2 | 0.0% | 0.00 | -199.00 | 3.42% |
| ETHUSDT | 1h | 2026-04-01 | all-day | 5 | 0.0% | 0.00 | -490.10 | 5.52% |
| SOLUSDT | 15m | 2026-04-01 | client-hours | 4 | 25.0% | 0.98 | -5.92 | 2.39% |
| SOLUSDT | 15m | 2026-04-01 | all-day | 7 | 28.6% | 0.60 | -196.10 | 5.21% |
| SOLUSDT | 1h | 2026-04-01 | client-hours | 1 | 0.0% | 0.00 | -100.00 | 1.69% |
| SOLUSDT | 1h | 2026-04-01 | all-day | 6 | 0.0% | 0.00 | -585.20 | 6.49% |
| BTCUSDT | 15m | 2026-07-01 | client-hours | 2 | 50.0% | 2.97 | 197.00 | 1.32% |
| BTCUSDT | 15m | 2026-07-01 | all-day | 7 | 28.6% | 0.70 | -151.32 | 5.41% |
| BTCUSDT | 1h | 2026-07-01 | client-hours | 2 | 50.0% | 2.97 | 197.00 | 1.09% |
| BTCUSDT | 1h | 2026-07-01 | all-day | 10 | 40.0% | 1.94 | 596.44 | 5.64% |
| ETHUSDT | 15m | 2026-07-01 | client-hours | 2 | 50.0% | 2.91 | 197.00 | 1.13% |
| ETHUSDT | 15m | 2026-07-01 | all-day | 7 | 28.6% | 1.17 | 89.05 | 3.94% |
| ETHUSDT | 1h | 2026-07-01 | client-hours | 2 | 50.0% | 2.91 | 197.00 | 2.52% |
| ETHUSDT | 1h | 2026-07-01 | all-day | 9 | 44.4% | 1.81 | 417.10 | 5.34% |
| SOLUSDT | 15m | 2026-07-01 | client-hours | 3 | 33.3% | 1.47 | 95.03 | 2.69% |
| SOLUSDT | 15m | 2026-07-01 | all-day | 7 | 14.3% | 0.49 | -302.75 | 3.59% |
| SOLUSDT | 1h | 2026-07-01 | client-hours | 1 | 0.0% | 0.00 | -100.00 | 1.00% |
| SOLUSDT | 1h | 2026-07-01 | all-day | 6 | 50.0% | 2.86 | 602.72 | 4.72% |

## Interpretation

These are diagnostic backtests, not evidence of a profitable live system. Fees, spreads, slippage, borrow costs and funding are excluded. Shorts on spot data are hypothetical. Low or zero trade counts cannot establish the client's win-rate, profit-factor or drawdown targets. End-of-data liquidations count in the reported results. The two session choices are sensitivity checks, not an optimized recommendation.

The historical and paper execution models differ: historical entries fill at the next open with a recalculated target; paper entries use the delivered signal close. Historical sizing has no cash notional cap, whereas paper sizing is capped and rounded. Paper capital starts at 100,000 per currency. Backtests restrict entry hours but can hold overnight; paper exits at session end when candles are available. Cooldown, daily-loss equity bases and opening-gap precedence also differ. This report therefore evaluates signal behavior under the historical model and does not forecast the paper ledger.

Before any live rollout, align fill/risk models, add instrument-specific costs and lot rules, validate Pine and TypeScript against identical candles, and forward-test on the actual broker feed. Binance data does not validate Indian equities or an MT5 broker's forex prices.
