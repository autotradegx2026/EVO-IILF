import { z } from 'zod'
import { timeframeMilliseconds } from '../trading/session'

/** close_time is exclusive: Binance's inclusive kline close timestamp needs +1ms. */
export const PaperBarSchema = z.object({
  symbol: z.string().max(50).regex(/^[A-Z0-9_!.-]+:[A-Z0-9_!./&-]+$/),
  tf: z.enum(['1m', '5m', '15m', '1h', '60m']),
  time: z.string().datetime({ offset: true }),
  close_time: z.string().datetime({ offset: true }),
  open: z.number().finite().positive(),
  high: z.number().finite().positive(),
  low: z.number().finite().positive(),
  close: z.number().finite().positive(),
}).superRefine((bar, context) => {
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid OHLC range' })
  }
  const duration = Date.parse(bar.close_time) - Date.parse(bar.time)
  // Exchange sessions may finish with a shorter candle than the chart interval.
  if (duration <= 0 || duration > timeframeMilliseconds(bar.tf)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['close_time'], message: 'Bar duration must be positive and no longer than its timeframe' })
  }
})

export type PaperBar = z.infer<typeof PaperBarSchema>
export type PaperExitTrade = {
  direction: 'LONG' | 'SHORT'
  entry_price: number
  stop_loss: number
  take_profit: number
  signal_time: string
  last_bar_at: string | null
  session_start: string
  session_end: string
  session_timezone: string
}
export type PaperExit = { closePrice: number; reason: 'SL_HIT' | 'TP_HIT' | 'SESSION_END' }

// Find the first exit from the original session, rather than testing only the
// newest bar: after an outage that bar may belong to a later, open session.
function sessionDeadline(trade: PaperExitTrade, through: number): number | null {
  const start = trade.session_start.slice(0, 5), end = trade.session_end.slice(0, 5)
  if (![start, end].every(value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new Error('Invalid paper session')
  if (start === end) return null
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: trade.session_timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const inside = (time: number) => {
    const parts = formatter.formatToParts(time)
    const clock = `${parts.find(part => part.type === 'hour')!.value}:${parts.find(part => part.type === 'minute')!.value}`
    return start < end ? clock >= start && clock < end : clock >= start || clock < end
  }
  const signal = Date.parse(trade.signal_time)
  if (!inside(signal)) return signal
  // Sessions have minute boundaries. Scanning actual instants also handles DST
  // skipped/repeated hours, unlike subtracting civil clock strings. The first
  // exit is within two civil days for the supported timezones, including a
  // short closed window skipped completely by a spring DST transition.
  const limit = Math.min(through, signal + 51 * 3_600_000)
  for (let time = Math.floor(signal / 60_000) * 60_000 + 60_000; time <= limit; time += 60_000) {
    if (!inside(time)) return time
  }
  return null
}

/** Deterministic conservative fill model for a completed bar; no external effects. */
export function evaluatePaperBar(trade: PaperExitTrade, input: PaperBar): PaperExit | null {
  const bar = PaperBarSchema.parse(input)
  const signal = Date.parse(trade.signal_time), previous = trade.last_bar_at === null ? null : Date.parse(trade.last_bar_at)
  if (!Number.isFinite(signal) || (previous !== null && !Number.isFinite(previous))) throw new Error('Invalid paper trade timestamp')
  const openTime = Date.parse(bar.time), closeTime = Date.parse(bar.close_time)
  if (openTime < signal || (previous !== null && closeTime <= previous)) return null
  const deadline = sessionDeadline(trade, closeTime)
  // A missed close is filled at the next observable open, never at a fabricated
  // historical price or after intrabar levels in a later session.
  if (deadline !== null && openTime >= deadline) return { closePrice: bar.open, reason: 'SESSION_END' }
  const long = trade.direction === 'LONG'
  if (long ? bar.low <= trade.stop_loss : bar.high >= trade.stop_loss) {
    return { closePrice: long ? Math.min(bar.open, trade.stop_loss) : Math.max(bar.open, trade.stop_loss), reason: 'SL_HIT' }
  }
  if (long ? bar.high >= trade.take_profit : bar.low <= trade.take_profit) {
    return { closePrice: trade.take_profit, reason: 'TP_HIT' }
  }
  if (deadline !== null && closeTime >= deadline) return { closePrice: bar.close, reason: 'SESSION_END' }
  return null
}
