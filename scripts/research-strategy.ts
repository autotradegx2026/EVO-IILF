/** Reproducible, untuned historical research. Public market data only; no orders. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { BacktestParamsSchema, backtestCandles, fetchBinanceData } from '../lib/trading/backtest'
import { CLIENT_DEFAULTS, STRATEGY_VERSION } from '../lib/strategy/config'

async function main() {
  const rows = []
  for (const ending of ['2026-01-01', '2026-04-01', '2026-07-01']) {
    for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
      for (const interval of ['15m', '1h'] as const) {
        const end = Date.parse(`${ending}T00:00:00Z`) - 1
        const candles = await fetchBinanceData(symbol, interval, 1500, end)
        const higher = await fetchBinanceData(symbol, '1h', interval === '1h' ? 1552 : 427, end)
        const hash = createHash('sha256').update(JSON.stringify({ candles, higher })).digest('hex')
        for (const session of ['client-hours', 'all-day'] as const) {
          const params = BacktestParamsSchema.parse({ ...CLIENT_DEFAULTS, symbol, interval, limit: 1500,
            ...(session === 'all-day' ? { sessionStart: '00:00', sessionEnd: '00:00' } : {}) })
          const result = backtestCandles(params, candles, higher)
          rows.push({ symbol, interval, ending, session, candles: candles.length,
            start: new Date(candles[0].time).toISOString(), end: new Date(candles.at(-1)!.closeTime).toISOString(),
            sha256: hash, params, summary: result.summary, filterReasons: result.analysis.filterReasons,
            trades: result.trades, warnings: result.analysis.warnings })
        }
        console.info(`Researched ${symbol} ${interval} ending ${ending}`)
      }
    }
  }
  mkdirSync('research', { recursive: true })
  writeFileSync('research/strategy-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), version: STRATEGY_VERSION, rows }, null, 2) + '\n')
  const table = rows.map(r => `| ${r.symbol} | ${r.interval} | ${r.ending} | ${r.session} | ${r.summary.totalTrades} | ${r.summary.winRate.toFixed(1)}% | ${r.summary.profitFactor == null ? 'No losses' : r.summary.profitFactor.toFixed(2)} | ${r.summary.netPnL.toFixed(2)} | ${r.summary.maxDrawdown.toFixed(2)}% |`).join('\n')
  writeFileSync('research/RESULTS.md', `# EVO-IILF historical research\n\nGenerated ${new Date().toISOString()}. Strategy ${STRATEGY_VERSION}.\n\n## Method\n\nThree spot pairs, two timeframes, three fixed historical endpoints, 1,500 completed candles per dataset. Each dataset is evaluated with unchanged client defaults and with only the session changed to all day; both retain Asia/Kolkata VWAP resets. No parameters were fitted to these results. Indicator warmup consumes the first 199 bars. Each run starts with 10,000 quote-currency units. Results from overlapping assets or timeframes are not independent portfolio returns.\n\nThe data source is Binance's [official public market-data API](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only). Dataset boundaries, SHA-256 hashes, full parameters, trades and filter counts are in [strategy-results.json](strategy-results.json). Run: compile scripts/research-strategy.ts with TypeScript (ES2022, CommonJS, esModuleInterop, skipLibCheck), then execute the generated script from the repository root.\n\n## Results\n\n| Pair | TF | Exclusive endpoint | Session | Trades | Win rate | Profit factor | Net PnL | Max drawdown |\n|---|---|---|---|---:|---:|---:|---:|---:|\n${table}\n\n## Interpretation\n\nThese are diagnostic backtests, not evidence of a profitable live system. Fees, spreads, slippage, borrow costs and funding are excluded. Shorts on spot data are hypothetical. Low or zero trade counts cannot establish the client's win-rate, profit-factor or drawdown targets. End-of-data liquidations count in the reported results. The two session choices are sensitivity checks, not an optimized recommendation.\n\nThe historical and paper execution models differ: historical entries fill at the next open with a recalculated target; paper entries use the delivered signal close. Historical sizing has no cash notional cap, whereas paper sizing is capped and rounded. Paper capital starts at 100,000 per currency. Backtests restrict entry hours but can hold overnight; paper exits at session end when candles are available. Cooldown, daily-loss equity bases and opening-gap precedence also differ. This report therefore evaluates signal behavior under the historical model and does not forecast the paper ledger.\n\nBefore any live rollout, align fill/risk models, add instrument-specific costs and lot rules, validate Pine and TypeScript against identical candles, and forward-test on the actual broker feed. Binance data does not validate Indian equities or an MT5 broker's forex prices.\n`)
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Research failed'); process.exitCode = 1 })
