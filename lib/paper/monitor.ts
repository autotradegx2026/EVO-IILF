import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, PaperTrade } from '@/types/database'
import { evaluatePaperBar, PaperBarSchema, type PaperBar } from './exit'
import { timeframeMilliseconds } from '../trading/session'

export async function applyPaperBar(db: SupabaseClient<Database>, userId: string, raw: PaperBar) {
  const bar = PaperBarSchema.parse(raw)
  const current = await db.from('paper_trades').select('*').eq('user_id', userId).eq('symbol', bar.symbol).eq('status', 'OPEN').maybeSingle()
  if (current.error) throw new Error('PAPER_READ_FAILED')
  if (!current.data) return { status: 'NO_OPEN_TRADE' }
  const trade = current.data as PaperTrade
  if (timeframeMilliseconds(trade.timeframe) !== timeframeMilliseconds(bar.tf)) return { status: 'TIMEFRAME_MISMATCH' }
  if (Date.parse(bar.time) < Date.parse(trade.signal_time) || (trade.last_bar_at && Date.parse(bar.close_time) <= Date.parse(trade.last_bar_at))) return { status: 'OLD_BAR' }
  // Do not infer a TP/SL from an unknown interval. A visible gap is recorded.
  const gap = Date.parse(bar.time) > Date.parse(trade.last_bar_at ?? trade.signal_time)
  const exit = evaluatePaperBar(trade, bar)
  const result = await db.rpc('apply_paper_mark', { p_user_id: userId, p_trade_id: trade.id, p_expected_bar: trade.last_bar_at,
    p_bar_time: bar.close_time, p_price: bar.close, p_close_price: exit?.closePrice ?? null, p_reason: exit?.reason ?? null })
  if (result.error) throw new Error('PAPER_MARK_FAILED')
  if (gap) await db.from('paper_trades').update({ monitor_error: 'DATA_GAP: unseen candles were not simulated' }).eq('id', trade.id).eq('last_bar_at', bar.close_time)
  return result.data as { status: string; reason?: string }
}

export async function fetchPaperBars(symbol: string, tf: string, from: number, now = Date.now()): Promise<PaperBar[]> {
  if (!/^BINANCE:[A-Z0-9]+USDT$/.test(symbol)) throw new Error('TRADINGVIEW_BARS_REQUIRED')
  const interval = tf === '60m' ? '1h' : tf
  // This market-data-only host also works in regions where the trading API is restricted.
  const query = new URLSearchParams({ symbol: symbol.slice(8), interval, startTime: String(from), endTime: String(now - 1), limit: '500' })
  const response = await fetch(`https://data-api.binance.vision/api/v3/klines?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`MARKET_DATA_HTTP_${response.status}`)
  const raw: unknown = await response.json()
  if (!Array.isArray(raw)) throw new Error('INVALID_MARKET_DATA')
  return raw.filter((row): row is unknown[] => Array.isArray(row) && Number(row[6]) < now).map(row => PaperBarSchema.parse({ symbol, tf: interval,
    time: new Date(Number(row[0])).toISOString(), close_time: new Date(Number(row[6]) + 1).toISOString(),
    open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) }))
}
