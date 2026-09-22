# AutotradeX client handoff

The dashboard is at https://evo-iilf.vercel.app. Use the existing personal account. Enter broker credentials privately in **Broker APIs**; credentials are encrypted and are not included in browser account listings. Connecting an account verifies access and leaves order automation off.

## What the client controls

1. Save strategy, risk limits and trading session in **Strategy & Screener / Risk & Controls**. Stop active paper and broker runs before changing their shared inputs. Equal session start/end permits all-day entries; the default 09:30–15:30 Asia/Kolkata session does not trade overnight.
2. For paper testing, choose Binance symbols and candle timeframe in **Paper Trade**, then **Start paper trading**. Background scans use actual completed market candles; fills and capital are simulated. **Stop** blocks new entries and keeps existing position exit checks running.
3. For broker trading, select a verified account, compatible trading symbol and candle timeframe in **Dashboard**. Review the real-money/testnet authorization and press **Start**. These settings lock while running. **Stop** blocks new entries; existing orders continue reconciliation and protection.
4. Read **Broker Orders** for confirmed exchange fills and outstanding orders. Chart LONG/SHORT markers are strategy setups, not proof of fills. Risk, Journal, Analytics and Alerts have separate paper/testnet/live and currency views.

Paper testing is optional in the product. Live Start requires working live infrastructure and broker access; it does not require a paper-trial result or a claimed performance target.

## Required live infrastructure — operator setup still pending

The current Supabase/Vercel execution job is intentionally **testnet-only**, with the live gate off. It cannot process real orders just by connecting a live API key.

- Deploy the included `Dockerfile.execution` or Node 22 standalone worker on a persistent host with restart monitoring. See [worker deployment](BROKER_AUTOMATION.md#worker-deployment) for commands.
- Use the same Supabase project, service-role key and encryption key as Vercel. Never put these values into the repository or client-side variables.
- Set the appropriate execution environment gates on both the worker and Vercel. Stop the Supabase `evo-testnet-execution` job when switching to the standalone worker because they share one lease. Leave the independent paper job running.
- For Angel One, configure registered static egress and IP headers, maintain the actual exchange trading-date allowlist, and verify session square-off settings. Its signal source is TradingView: install the latest generated script with the saved inputs and create the private webhook alert. Recreate alerts after changing inputs. Old/missing configurations are rejected; candle-only delivery remains available for paper exits.
- Verify actual order, stop/target, cancellation, partial-fill, reconnect and closing behavior with the connected broker. A Binance Spot testnet acceptance command is supplied in [broker operations](BROKER_AUTOMATION.md#verification-and-acceptance). It has not been run against an actual exchange account because none is connected.

## Supported scope and accounting

Binance Spot supports BUY entries and SELL exits, with exchange OCO protection. It does not open short positions or trade forex/margin/futures. Angel One supports the implemented India cash-equity workflow with broker stops and worker-monitored targets. MT5 and derivatives are not implemented.

Entry sizing is constrained by configured risk, available funds, instrument rules and price drift; this is not a leverage/margin-loan product. Actual fills, fees, unknown orders and residual inventory are kept in the execution ledger. Paper simulations exclude fees/slippage and are not an estimate of guaranteed broker results. Historical backtests are separate research runs; they never populate paper trade logs.

## Verification included in this release

137 automated checks, TypeScript, lint, production build and standalone worker compilation passed. Database rollback suites covered run locks, signal revisions, Start/Stop, paper accounting, broker execution and ledger alerts. Both current Pine exports compiled in TradingView. No artificial trades were retained in the owner account and no exchange orders were placed during these checks.

The screenshot's 3/7 is explained by actual market factors. Replaying 47 completed candles through 7 September 14:45 IST found zero qualifying setups. See [the paper diagnosis](research/PAPER_DIAGNOSIS_2026-09-07.md). This verifies the observed wait, not future profitability. A live-capable host and actual broker acceptance remain outstanding; software tests cannot certify a bug-free or profitable system.
