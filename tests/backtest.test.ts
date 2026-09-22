import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BacktestParamsSchema, backtestCandles, calculateADX, runBacktest, type Candle } from '../lib/trading/backtest'
import { evaluateStrategy } from '../lib/strategy/engine'

const hour = 3600000
function fixture(): Candle[] {
  return Array.from({ length: 60 }, (_, i) => {
    const time = Date.UTC(2020, 0, 1) + i * hour
    const open = i <= 40 ? 100 : 103
    const close = i < 40 ? 100 : i === 40 ? 102 : i === 59 ? 104 : 103
    return { time, closeTime: time + hour - 1, open, high: i === 40 ? 103 : Math.max(open, close) + 0.2, low: i === 40 ? 99 : Math.min(open, close) - 0.2, close, volume: 100, takerBuyVolume: 60 }
  })
}
const params = () => BacktestParamsSchema.parse({ interval: '1h', limit: 60, fastEmaLength: 2, trendEmaLength: 3, htfEmaLength: 2, htfTimeframe: '1H', adxThreshold: 0, volumeMultiplier: 0, minConfluenceScore: 1, atrMultiplier: 1.5, cooldownBars: 0, sessionStart: '00:00', sessionEnd: '00:00', sessionTimezone: 'Etc/UTC' })
const firstTrade = (candles: Candle[]) => [...backtestCandles(params(), candles, candles).trades].reverse()[0]

test('client defaults and valid zeros survive validation; invalid or impossible settings fail', () => {
  const defaults = BacktestParamsSchema.parse({})
  assert.deepEqual([defaults.trendEmaLength, defaults.htfEmaLength, defaults.htfTimeframe, defaults.adxThreshold, defaults.rrRatio, defaults.cooldownBars, defaults.sessionStart], [200, 50, '1H', 20, 3, 10, '09:30'])
  const p = params()
  assert.equal(p.cooldownBars, 0); assert.equal(p.adxThreshold, 0); assert.equal(p.volumeMultiplier, 0)
  for (const patch of [{ interval: 'invalid' }, { sessionEnd: '24:70' }, { riskPct: 0 }, { limit: -1 }, { deltaEnabled: 'false' }, { fastEmaLength: 100 }, { minConfluenceScore: 0 }, { minConfluenceScore: 8 }, { minConfluenceScore: 7, vwapEnabled: false }, { sessionTimezone: 'invalid' }, { interval: '2h', htfTimeframe: '1H' }]) {
    assert.equal(BacktestParamsSchema.safeParse({ ...p, ...patch }).success, false)
  }
})

test('ADX starts after the correct Wilder warmup for a directional series', () => {
  const candles = fixture().slice(0, 31).map((c, i) => ({ ...c, open: 100 + i, close: 101 + i, high: 102 + i, low: 99 + i }))
  const adx = calculateADX(candles, 14)
  assert.equal(adx[26], null)
  assert.equal(adx[27], 100)
  assert.equal(adx[30], 100)
})

test('shared engine gates quiet candles and fills qualified signals at next open with structural risk', () => {
  const candles = fixture(), p = params(), result = backtestCandles(p, candles, candles)
  assert.deepEqual(result.analysis.market, { symbol: p.symbol, interval: p.interval, candles: candles.length, from: new Date(candles[0].time).toISOString(), through: new Date(candles[candles.length - 1].closeTime).toISOString() })
  assert.equal(result.trades.length, 1)
  const trade = result.trades[0], snapshots = evaluateStrategy(p, candles, candles, true)
  assert.ok(snapshots[39].reasons.includes('Volatility below average'))
  assert.equal(trade.entryTime, new Date(candles[41].time).toISOString())
  assert.equal(trade.entryPrice, candles[41].open)
  assert.equal(trade.sl, snapshots[40].sl)
  assert.ok(trade.sl < candles[40].low)
  assert.equal(trade.tp, trade.entryPrice + (trade.entryPrice - trade.sl) * p.rrRatio)
  assert.equal(trade.reason, 'END_OF_DATA')
  assert.equal(trade.exitPrice, 104)
  assert.ok(trade.pnl > 0)
  assert.equal(result.summary.profitFactor, null)
  assert.ok(Math.abs(result.summary.avgRR - trade.pnl / 100) < 1e-10)
  assert.deepEqual(trade.confluenceFactors, Object.entries(snapshots[40].factors).filter(([, yes]) => yes).map(([key]) => key))
})

test('opening gaps through an existing stop use the open and can exceed planned risk', () => {
  const candles = fixture(), sl = firstTrade(candles).sl
  candles[42] = { ...candles[42], open: sl - 5, close: sl - 5, high: sl - 4, low: sl - 6 }
  const first = firstTrade(candles)
  assert.equal(first.reason, 'SL')
  assert.equal(first.exitPrice, sl - 5)
  assert.ok(first.pnl < -100)
})

test('entry gaps through the signal stop reject the entry', () => {
  const candles = fixture(), sl = firstTrade(candles).sl
  candles[41] = { ...candles[41], open: sl - 1, close: sl - 1, high: sl, low: sl - 2 }
  const result = backtestCandles(params(), candles, candles)
  assert.ok(result.analysis.filterReasons['Entry gap through stop'] >= 1)
  assert.ok(result.trades.every(t => t.entryTime !== new Date(candles[41].time).toISOString()))
})

test('strategy timezone sessions reject an otherwise qualified next open at session end', () => {
  const candles = fixture()
  // Signal opens 16:00 UTC and closes 16:59; the fill would be 17:00 UTC.
  const p = { ...params(), sessionStart: '16:00', sessionEnd: '17:00' }
  const result = backtestCandles(p, candles, candles)
  assert.equal(result.trades.length, 0)
  assert.ok(result.analysis.filterReasons['Next open outside strategy session'] > 0)
  const shifted = backtestCandles({ ...p, sessionStart: '21:30', sessionEnd: '22:30', sessionTimezone: 'Asia/Kolkata' }, candles, candles)
  assert.deepEqual(shifted.trades, result.trades)
  assert.equal(shifted.analysis.filterReasons['Next open outside strategy session'], result.analysis.filterReasons['Next open outside strategy session'])
})

test('higher-timeframe candles unavailable at the signal open cannot alter that entry', () => {
  const candles = fixture()
  const higher = Array.from({ length: 30 }, (_, i) => {
    const a = candles[i * 2], b = candles[i * 2 + 1]
    return { ...a, closeTime: b.closeTime, close: i < 20 ? 99 : b.close, high: Math.max(a.high, b.high), low: Math.min(99, a.low, b.low) }
  })
  const p = { ...params(), htfTimeframe: '2H' as const }
  const baseline = backtestCandles(p, candles, higher)
  const changed = higher.map(c => ({ ...c }))
  // The 40–41 HTF candle is still open throughout signal bar 40.
  changed[20] = { ...changed[20], close: 1000, high: 1001 }
  const altered = backtestCandles(p, candles, changed)
  assert.equal(baseline.trades.length, 1)
  assert.equal(altered.trades[0].entryTime, baseline.trades[0].entryTime)
  assert.equal(altered.trades[0].entryPrice, baseline.trades[0].entryPrice)
})

test('ambiguous intrabar stop and target touches resolve conservatively', () => {
  const candles = fixture(), trade = firstTrade(candles)
  candles[42] = { ...candles[42], low: trade.sl - 1, high: trade.tp + 1 }
  const first = firstTrade(candles)
  assert.equal(first.reason, 'SL')
  assert.equal(first.exitPrice, trade.sl)
})

test('cooldown elapses from entry signal while the position is open; persistent trends can reenter', () => {
  const candles = fixture(), trade = firstTrade(candles)
  for (let i = 50; i < candles.length; i++) {
    candles[i] = { ...candles[i], open: i === 50 ? 103 : trade.tp + 1, close: trade.tp + 1, high: trade.tp + 2, low: 102.5 }
  }
  const result = backtestCandles({ ...params(), cooldownBars: 10 }, candles, candles)
  const trades = [...result.trades].reverse()
  assert.ok(trades.length >= 2)
  assert.equal(trades[0].reason, 'TP')
  assert.equal(trades[1].entryTime, new Date(candles[51].time).toISOString())
})

test('short trades preserve the candle-high stop and risk quantity', () => {
  const candles = fixture().map(c => ({ ...c, open: 200 - c.open, close: 200 - c.close, high: 200 - c.low, low: 200 - c.high }))
  const result = backtestCandles(params(), candles, candles), trade = result.trades[0]
  assert.equal(trade.direction, 'SHORT')
  assert.ok(trade.sl > candles[40].high)
  assert.equal(trade.tp, trade.entryPrice - (trade.sl - trade.entryPrice) * params().rrRatio)
  assert.ok(trade.pnl > 0)
  const doubleRisk = backtestCandles({ ...params(), riskPct: 2 }, candles, candles)
  assert.ok(Math.abs(doubleRisk.trades[0].pnl - trade.pnl * 2) < 1e-10)
})

test('daily risk limits block additional entries after a stop loss', () => {
  const candles = fixture(), trade = firstTrade(candles)
  candles[42] = { ...candles[42], low: trade.sl - 1, high: trade.tp + 1 }
  for (let i = 43; i < 48; i++) candles[i] = { ...candles[i], high: 110, low: 102, close: 105 }
  const result = backtestCandles({ ...params(), maxDailyLossPct: 0.5 }, candles.slice(0, 48), candles.slice(0, 48))
  assert.equal(result.trades.length, 1)
  assert.equal(result.trades[0].reason, 'SL')
  assert.ok(result.analysis.filterReasons['Daily loss limit'] > 0)
})

test('market-data failure rejects rather than inventing profitable candles', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 })
  try { await assert.rejects(runBacktest(params()), /historical data unavailable/) }
  finally { globalThis.fetch = original }
})
