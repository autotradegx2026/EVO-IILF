import { type StrategyConfig, validateStrategy, strategySession } from './config'
import { calculateEMA, calculateATR, calculateADX, calculateVWAP, validateCandles, BacktestDataError, type Candle } from './indicators'

export type Factors = Record<'trend' | 'vwap' | 'delta' | 'volume' | 'sweep' | 'fvg' | 'ob', boolean>
export type StrategySnapshot = {
  time: number; direction: 'LONG' | 'SHORT' | null; qualified: boolean; reasons: string[]
  longScore: number; shortScore: number; factors: Factors; longFactors: Factors; shortFactors: Factors
  price: number; sl: number | null; tp: number | null
  adx: number | null; atr: number | null; vwap: number | null; delta: number | null
}
const count = (f: Factors) => Object.values(f).filter(Boolean).length
const mean = (a: (number | null)[], end: number, length: number) => {
  const slice = a.slice(Math.max(0, end - length + 1), end + 1)
  return slice.length === length && slice.every(v => v != null) ? (slice as number[]).reduce((x, y) => x + y, 0) / length : null
}

// Closed candles only. Higher-timeframe values become usable at the NEXT base-bar open,
// matching Pine's expression[1] + lookahead_on convention. Equal TF uses local closed EMA.
export function evaluateStrategy(config: StrategyConfig, candles: Candle[], higher: Candle[], sameTimeframe = false): StrategySnapshot[] {
  const error = validateStrategy(config)
  if (error) throw new Error(error)
  validateCandles(candles); validateCandles(higher)
  if (!candles.length || !higher.length) throw new BacktestDataError('No completed market candles available')
  const closes = candles.map(c => c.close)
  const fast = calculateEMA(closes, config.fastEmaLength), trend = calculateEMA(closes, config.trendEmaLength)
  const ht = calculateEMA((sameTimeframe ? candles : higher).map(c => c.close), config.htfEmaLength)
  const atr = calculateATR(candles, config.atrLength), adx = calculateADX(candles, config.adxLength)
  const vwap = calculateVWAP(candles, config.sessionTimezone)
  const delta = calculateEMA(candles.map(c => c.close > c.open ? c.volume : c.close < c.open ? -c.volume : 0), config.deltaLength)
  const volumes = candles.map(c => c.volume)
  let h = -1
  return candles.map((c, i) => {
    while (h + 1 < higher.length && higher[h + 1].closeTime < c.time) h++
    const bias = sameTimeframe ? ht[i] : h >= 0 ? ht[h] : null
    const volumeAverage = mean(volumes, i, 20)
    const averageATR = mean(atr, i, 20)
    const highVolume = volumeAverage != null && c.volume > volumeAverage * config.volumeMultiplier
    const previous = candles[i - 1], twoBack = candles[i - 2]
    const swings = candles.slice(Math.max(0, i - config.swingLookback), i)
    const ready = bias != null && trend[i] != null && fast[i] != null && adx[i] != null && averageATR != null && (!config.deltaEnabled || delta[i] != null) && swings.length === config.swingLookback
    const bullish = ready && c.close > trend[i]! && fast[i]! > trend[i]! && c.close > bias!
    const bearish = ready && c.close < trend[i]! && fast[i]! < trend[i]! && c.close < bias!
    const displacementUp = atr[i] != null && c.close - c.open > atr[i]! * 0.8
    const displacementDown = atr[i] != null && c.open - c.close > atr[i]! * 0.8
    const longFactors: Factors = {
      trend: bullish, vwap: config.vwapEnabled && vwap[i] != null && c.close > vwap[i]!,
      delta: config.deltaEnabled && delta[i] != null && delta[i]! > 0, volume: highVolume,
      sweep: swings.length === config.swingLookback && c.low < Math.min(...swings.map(c => c.low)) && c.close > c.open,
      fvg: config.fvgEnabled && !!twoBack && c.low > twoBack.high && displacementUp,
      ob: config.obEnabled && !!previous && previous.close < previous.open && c.close > previous.high && displacementUp && highVolume,
    }
    const shortFactors: Factors = {
      trend: bearish, vwap: config.vwapEnabled && vwap[i] != null && c.close < vwap[i]!,
      delta: config.deltaEnabled && delta[i] != null && delta[i]! < 0, volume: highVolume,
      sweep: swings.length === config.swingLookback && c.high > Math.max(...swings.map(c => c.high)) && c.close < c.open,
      fvg: config.fvgEnabled && !!twoBack && c.high < twoBack.low && displacementDown,
      ob: config.obEnabled && !!previous && previous.close > previous.open && c.close < previous.low && displacementDown && highVolume,
    }
    const direction = bullish ? 'LONG' : bearish ? 'SHORT' : null
    const factors = direction === 'SHORT' ? shortFactors : longFactors
    const reasons: string[] = []
    if (!ready) reasons.push('Indicator warmup')
    if (!direction) reasons.push('Neutral trend')
    if (!(adx[i] != null && adx[i]! > config.adxThreshold)) reasons.push('ADX too low')
    if (!(averageATR != null && atr[i]! > averageATR)) reasons.push('Volatility below average')
    if (!strategySession(c.time, config) || !strategySession(c.closeTime, config)) reasons.push('Outside strategy session')
    if (count(factors) < config.minConfluenceScore) reasons.push('Low confluence')
    const sl = direction && atr[i] != null ? direction === 'LONG' ? c.low - atr[i]! * config.atrMultiplier : c.high + atr[i]! * config.atrMultiplier : null
    const risk = sl == null ? 0 : Math.abs(c.close - sl)
    const tp = sl == null ? null : c.close + (direction === 'LONG' ? 1 : -1) * risk * config.rrRatio
    if (!sl || !tp || sl <= 0 || tp <= 0 || !(risk > 0)) reasons.push('Invalid stop distance')
    return { time: c.closeTime, direction, qualified: reasons.length === 0, reasons, longScore: count(longFactors), shortScore: count(shortFactors), factors, longFactors, shortFactors, price: c.close, sl, tp, adx: adx[i], atr: atr[i], vwap: vwap[i], delta: delta[i] }
  })
}
