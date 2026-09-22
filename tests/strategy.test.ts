import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLIENT_DEFAULTS, configFromSettings, configToSettings, StrategyConfigSchema, validateStrategy, STRATEGY_VERSION } from '../lib/strategy/config'
import { evaluateStrategy } from '../lib/strategy/engine'
import { generatePine } from '../lib/strategy/pine'
import { parseDelivery, tokenDigest, verifyDeliveryToken } from '../lib/strategy/delivery'
import type { Candle } from '../lib/strategy/indicators'

const token = 'a'.repeat(64)
const time = Date.parse('2026-09-06T06:00:00Z')
const payload = { token, strategy_version: STRATEGY_VERSION, symbol: 'NSE:RELIANCE-EQ', action: 'LONG', price: 100, sl: 95, tp: 115, rr: 3, confluence: 5, tf: '15m', timestamp: new Date(time).toISOString(), factors: { trend: true, vwap: true, delta: true, volume: true, sweep: false, fvg: true, ob: false } }
function candles(): Candle[] {
  return Array.from({ length: 45 }, (_, i) => ({ time: time + i * 60000, closeTime: time + (i + 1) * 60000 - 1, open: 100, close: i === 40 ? 104 : 100, high: i === 40 ? 106 : 101, low: i === 40 ? 95 : 99, volume: i === 40 ? 1000 : 100, takerBuyVolume: 50 }))
}
const config = StrategyConfigSchema.parse({ trendEmaLength: 3, fastEmaLength: 2, htfEmaLength: 2, htfTimeframe: '1H', adxLength: 2, atrLength: 2, minConfluenceScore: 1, sessionStart: '00:00', sessionEnd: '00:00' })

test('strategy settings round-trip without credentials and use client defaults for new fields', () => {
  assert.deepEqual(configFromSettings(configToSettings(CLIENT_DEFAULTS)), CLIENT_DEFAULTS)
  assert.equal(configFromSettings({ webhook_secret: 'do-not-export' }).trendEmaLength, 200)
  assert.equal(configFromSettings({ session_start: '09:30:00' }).sessionStart, '09:30')
  assert.match(validateStrategy({ ...CLIENT_DEFAULTS, vwapEnabled: false, deltaEnabled: false, fvgEnabled: false, obEnabled: false })!, /Only 3/)
})

test('exact seven factors include sweep and independent FVG/OB; volatility/ADX are gates', () => {
  const bars = candles(), snapshot = evaluateStrategy(config, bars, bars, true)[40]
  assert.equal(snapshot.qualified, true)
  assert.deepEqual(Object.keys(snapshot.factors), ['trend', 'vwap', 'delta', 'volume', 'sweep', 'fvg', 'ob'])
  assert.equal(snapshot.factors.sweep, true)
  assert.equal(snapshot.longScore, Object.values(snapshot.longFactors).filter(Boolean).length)
  assert.equal(snapshot.sl, 95 - snapshot.atr! * 1.5)
  assert.equal(snapshot.tp, 104 + (104 - snapshot.sl!) * 3)
})

test('disabled delta length cannot delay a setup or contribute a point', () => {
  const bars = candles(), a = evaluateStrategy({ ...config, deltaEnabled: false, deltaLength: 50 }, bars, bars, true)[40]
  const b = evaluateStrategy({ ...config, deltaEnabled: false, deltaLength: 1 }, bars, bars, true)[40]
  assert.equal(a.qualified, true); assert.equal(a.qualified, b.qualified)
  assert.equal(a.factors.delta, false); assert.equal(a.longScore, b.longScore)
})

test('ADX equality is rejected and delta ignores taker-buy volume', () => {
  const bars = candles(), base = evaluateStrategy(config, bars, bars, true)[40]
  assert.equal(evaluateStrategy({ ...config, adxThreshold: base.adx! }, bars, bars, true)[40].qualified, false)
  const changed = bars.map(c => ({ ...c, takerBuyVolume: c.volume }))
  assert.deepEqual(evaluateStrategy(config, changed, changed, true)[40], base)
})

test('FVG requires same-candle displacement; OB also requires high volume', () => {
  const bars = candles()
  bars[39] = { ...bars[39], open: 101, close: 100, high: 102, low: 99 }
  bars[40] = { ...bars[40], open: 104, close: 110, high: 111, low: 103 }
  const withVolume = evaluateStrategy(config, bars, bars, true)[40]
  assert.equal(withVolume.factors.fvg, true); assert.equal(withVolume.factors.ob, true)
  bars[40].volume = 10
  bars[40].takerBuyVolume = 0
  assert.equal(evaluateStrategy(config, bars, bars, true)[40].factors.ob, false)
  bars[40].open = 107.99
  assert.equal(evaluateStrategy(config, bars, bars, true)[40].factors.fvg, false)
})

test('delivery validates version, freshness, geometry and seven-factor arithmetic; strips token', () => {
  const parsed = parseDelivery(payload, time)
  assert.equal(parsed.token, token)
  assert.equal('token' in parsed.payload, false)
  assert.equal(JSON.stringify(parsed.payload).includes(token), false)
  for (const change of [{ strategy_version: 'unknown' }, { confluence: 7 }, { factors: { trend: true } }, { sl: 110 }, { timestamp: new Date(time - 300001).toISOString() }, { timestamp: new Date(time + 60001).toISOString() }]) {
    assert.throws(() => parseDelivery({ ...payload, ...change }, time))
  }
})

test('delivery token comparison rejects unknown, malformed and rotated credentials', () => {
  const hash = tokenDigest(token)
  assert.equal(verifyDeliveryToken(token, hash), true)
  assert.equal(verifyDeliveryToken('b'.repeat(64), hash), false)
  assert.equal(verifyDeliveryToken(token, undefined), false)
  assert.equal(verifyDeliveryToken(token, 'broken'), false)
})

test('Pine exports share calculations and separate strategy execution from screener columns', () => {
  const strategy = generatePine(CLIENT_DEFAULTS, 'strategy'), indicator = generatePine(CLIENT_DEFAULTS, 'indicator')
  for (const source of [strategy, indicator]) {
    assert.ok(source.startsWith('//@version=5'))
    assert.ok(source.includes('seededEMA(close, htfLength)[1], lookahead=barmerge.lookahead_on'))
    assert.ok(source.includes('adx > adxThreshold and atr > averageATR'))
    assert.ok(source.includes('input.string("60", "HTF timeframe"'))
    assert.ok(source.includes('bar_index - lastEntryBar >= cooldownBars'))
    assert.ok(source.includes('alert.freq_once_per_bar_close'))
    assert.ok(source.includes('\\"strategy_version\\"'))
    assert.ok(!source.includes(token))
  }
  assert.ok(strategy.includes('strategy.exit('))
  assert.ok(!indicator.includes('strategy.entry('))
  assert.ok(indicator.indexOf('"Signal", display') < indicator.indexOf('"Trend EMA", color'))
  assert.equal(strategy.slice(strategy.indexOf('trendEMA ='), strategy.indexOf('accountEquity =')), indicator.slice(indicator.indexOf('trendEMA ='), indicator.indexOf('accountEquity =')))
})

test('small supported positive inputs do not round to invalid Pine zero defaults', () => {
  const source = generatePine({ ...CLIENT_DEFAULTS, riskPct: 0.000001 }, 'strategy')
  assert.ok(source.includes('riskPercent = input.float(0.000001'))
  assert.equal(StrategyConfigSchema.safeParse({ riskPct: 1e-10 }).success, false)
})

test('Pine paper delivery uses one confirmed-bar envelope and exclusive entry alerts', () => {
  for (const kind of ['strategy', 'indicator'] as const) {
    const source = generatePine(CLIENT_DEFAULTS, kind)
    assert.ok(source.includes('sendPaperBars = input.bool(true, "Send candles for automatic paper exits")'))
    assert.ok(source.includes('entry = longSignal ? message(true) : shortSignal ? message(false) : "null"'))
    assert.ok(source.includes('if not sendPaperBars\n        alert(message(true), alert.freq_once_per_bar_close)'))
    assert.ok(source.includes('if not sendPaperBars\n        alert(message(false), alert.freq_once_per_bar_close)'))
    assert.ok(source.includes('if sendPaperBars and barstate.isconfirmed and deliveryToken != ""\n    alert(barMessage(), alert.freq_once_per_bar_close)'))
    assert.equal(source.match(/alert\(barMessage\(\)/g)?.length, 1)
    const envelope = source.slice(source.indexOf('barMessage() =>'), source.indexOf('\nif longSignal'))
    // Decode the emitted literals to verify JSON keys without claiming Pine compilation.
    const literals = envelope.match(/"(?:\\.|[^"\\])*"/g)!.map(value => JSON.parse(value) as string)
    assert.ok(literals.includes('{"kind":"BAR","token":"'))
    assert.ok(literals.includes('","strategy_version":"evo-iilf-1.0","bar":{"symbol":"'))
    for (const key of ['tf', 'time', 'close_time', 'open', 'high', 'low', 'close', 'entry']) {
      assert.ok(literals.some(value => value.includes(`"${key}":`)), `missing ${key}`)
    }
    assert.ok(envelope.includes('str.format_time(time, "yyyy-MM-dd\'T\'HH:mm:ss\'Z\'", "UTC")'))
    assert.ok(envelope.includes('str.format_time(time_close, "yyyy-MM-dd\'T\'HH:mm:ss\'Z\'", "UTC")'))
  }
})
