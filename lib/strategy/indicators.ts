import { localParts } from './config'
export type Candle = { time: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number; takerBuyVolume: number }
export class BacktestDataError extends Error {}
export function calculateEMA(data: number[], length: number): (number | null)[] {
  const values: (number | null)[] = new Array(data.length).fill(null)
  if (data.length < length) return values
  values[length - 1] = data.slice(0, length).reduce((a, b) => a + b, 0) / length
  const k = 2 / (length + 1)
  for (let i = length; i < data.length; i++) values[i] = data[i] * k + values[i - 1]! * (1 - k)
  return values
}

export function calculateATR(candles: Candle[], period: number): (number | null)[] {
  const values: (number | null)[] = new Array(candles.length).fill(null)
  let sum = 0
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1]
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
    if (i <= period) sum += tr
    if (i === period) values[i] = sum / period
    else if (i > period) values[i] = (values[i - 1]! * (period - 1) + tr) / period
  }
  return values
}

export function calculateADX(candles: Candle[], period: number): (number | null)[] {
  const values: (number | null)[] = new Array(candles.length).fill(null)
  let trSum = 0, plusSum = 0, minusSum = 0, dxSum = 0
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1]
    const up = c.high - prev.high, down = prev.low - c.low
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
    const plus = up > down && up > 0 ? up : 0, minus = down > up && down > 0 ? down : 0
    if (i <= period) { trSum += tr; plusSum += plus; minusSum += minus }
    else { trSum += tr - trSum / period; plusSum += plus - plusSum / period; minusSum += minus - minusSum / period }
    if (i < period) continue
    const sum = plusSum + minusSum
    const dx = trSum > 0 && sum > 0 ? 100 * Math.abs(plusSum - minusSum) / sum : 0
    if (i <= 2 * period - 1) dxSum += dx
    if (i === 2 * period - 1) values[i] = dxSum / period
    else if (i > 2 * period - 1) values[i] = (values[i - 1]! * (period - 1) + dx) / period
  }
  return values
}

export function calculateVWAP(candles: Candle[], timezone: string): (number | null)[] {
  let day = '', volume = 0, weighted = 0
  return candles.map(c => {
    const nextDay = localParts(c.time, timezone).day
    if (day !== nextDay) { day = nextDay; volume = 0; weighted = 0 }
    volume += c.volume
    weighted += (c.high + c.low + c.close) / 3 * c.volume
    return volume > 0 ? weighted / volume : null
  })
}

export function validateCandles(candles: Candle[]): void {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (!Object.values(c).every(Number.isFinite) || c.time < 0 || c.closeTime < c.time ||
      Math.min(c.open, c.high, c.low, c.close) <= 0 || c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close) || c.volume < 0 || c.takerBuyVolume < 0 ||
      c.takerBuyVolume > c.volume || (i > 0 && candles[i - 1].closeTime >= c.time)) {
      throw new BacktestDataError('Historical provider returned invalid or unordered candles')
    }
  }
}

