import type { Candle } from '../strategy/indicators'
import { validateCandles } from '../strategy/indicators'
import { timeframeMilliseconds } from '../trading/session'
import type { ExecutionDB } from './service'

export const MT5_TIMEFRAMES: Record<string, number> = { '1m':1, '5m':5, '15m':15, '30m':30, '1h':16385, '2h':16386, '4h':16388, '1d':16408, '1w':32769 }
export function decodeMt5Candles(rows: number[][], timeframe: string, now = Date.now()): Candle[] {
  const duration = timeframeMilliseconds(timeframe)
  if (!MT5_TIMEFRAMES[timeframe] || !duration) throw new Error('MT5_TIMEFRAME_UNSUPPORTED')
  const candles = rows.map(r => {
    if (r.length !== 6 || r.some(v => !Number.isFinite(v))) throw new Error('MT5_CANDLES_INVALID')
    return { time:r[0]*1000, closeTime:r[0]*1000+duration-1, open:r[1], high:r[2], low:r[3], close:r[4], volume:r[5], takerBuyVolume:0 }
  })
  if (candles.some(c => c.closeTime >= now)) throw new Error('MT5_OPEN_CANDLE_REJECTED')
  validateCandles(candles)
  return candles
}
export async function mt5Candles(db: ExecutionDB, accountId: string, symbol: string, timeframe: string, count: number) {
  const request = symbol.slice(symbol.indexOf(':')+1)
  const r = await db.from('mt5_candles').select('*').eq('account_id',accountId).eq('request',request).eq('timeframe',timeframe).maybeSingle()
  if (r.error) throw new Error('MT5_CANDLE_READ_FAILED')
  if (!r.data || Date.now()-Date.parse(r.data.updated_at)>120000) throw new Error('MT5_CANDLES_PENDING')
  const candles = decodeMt5Candles(r.data.bars as number[][],timeframe)
  if (candles.length < count) throw new Error('MT5_HISTORY_INCOMPLETE')
  return candles.slice(-count)
}
