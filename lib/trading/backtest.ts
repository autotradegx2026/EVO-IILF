import { z } from 'zod'

import { StrategyConfigSchema, validateStrategy, strategySession, localParts, STRATEGY_VERSION, type StrategyConfig } from '../strategy/config'
import { evaluateStrategy } from '../strategy/engine'
import { validateCandles, BacktestDataError, type Candle } from '../strategy/indicators'
export { calculateADX, BacktestDataError, type Candle } from '../strategy/indicators'

const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'] as const
function warmupBar(params: StrategyConfig): number {
  return Math.max(params.trendEmaLength - 1, params.fastEmaLength - 1, params.adxLength * 2 - 1, params.atrLength + 19, params.deltaEnabled ? params.deltaLength - 1 : 0, params.swingLookback, 19)
}
export const BacktestParamsSchema = z.object({
  ...StrategyConfigSchema.shape,
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/).default('BTCUSDT'),
  interval: z.enum(INTERVALS).default('15m'),
  limit: z.number().int().min(50).max(1500).default(1000),
  maxTradesPerDay: z.number().int().min(1).max(100).default(3),
  maxDailyLossPct: z.number().positive().max(100).default(3),
}).strict().superRefine((p, ctx) => {
  const problem = validateStrategy(p)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
  if (p.limit <= warmupBar(p) + 1) ctx.addIssue({ code: 'custom', path: ['limit'], message: 'Request more candles than the indicator warmup' })
  if (intervalMs(p.htfTimeframe.toLowerCase()) < intervalMs(p.interval)) ctx.addIssue({ code: 'custom', path: ['htfTimeframe'], message: 'HTF must be at least the base interval' })
})
export type BacktestParams = z.infer<typeof BacktestParamsSchema>
export type BacktestSummary = {
  totalTrades: number; winRate: number; profitFactor: number | null; netPnL: number
  maxDrawdown: number; avgConfluence: number; totalLongs: number; totalShorts: number
  avgRR: number; bestTrade: number; worstTrade: number
}
export type BacktestAnalysis = {
  signalsGenerated: number; signalsFiltered: number; filterReasons: Record<string, number>
  equityCurve: { time: string; equity: number }[]
  dataSource: string; warnings: string[]
  market?: { symbol: string; interval: string; candles: number; from: string; through: string }
}
export type BacktestTrade = {
  id: string; symbol: string; direction: 'LONG' | 'SHORT'
  entryTime: string; entryPrice: number; exitTime: string; exitPrice: number
  sl: number; tp: number; pnl: number; pnlPercent: number
  confluenceScore: number; confluenceFactors: string[]
  status: 'CLOSED'; reason: 'TP' | 'SL' | 'END_OF_DATA'
}
export type BacktestResult = { run?: { startedAt: string; finishedAt: string }; trades: BacktestTrade[]; summary: BacktestSummary; analysis: BacktestAnalysis }
function intervalMs(interval: string): number {
  const unit = interval.slice(-1)
  return parseInt(interval, 10) * ({ m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit] ?? NaN)
}

// Binance caps each kline page at 1,000. Fetch backwards, excluding unfinished candles.
export async function fetchBinanceData(symbol: string, interval: string, count: number, endTime: number): Promise<Candle[]> {
  let candles: Candle[] = [], cursor = endTime
  while (candles.length < count) {
    const pageSize = Math.min(1000, count - candles.length)
    const query = new URLSearchParams({ symbol, interval, limit: String(pageSize), endTime: String(cursor) })
    let response: Response
    try {
      response = await fetch(`https://data-api.binance.vision/api/v3/klines?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    } catch { throw new BacktestDataError('Historical data unavailable. Try again when Binance is reachable.') }
    if (!response.ok) throw new BacktestDataError(`Binance historical data unavailable (${response.status}). Use a valid Binance spot pair such as BTCUSDT.`)
    let data: unknown
    try { data = await response.json() } catch { throw new BacktestDataError('Historical provider returned invalid JSON') }
    if (!Array.isArray(data)) throw new BacktestDataError('Historical provider returned an invalid response')
    if (data.length === 0) break
    const page: Candle[] = data.map((row: unknown) => {
      if (!Array.isArray(row) || row.length < 10) throw new BacktestDataError('Historical provider returned an invalid candle')
      return { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), closeTime: Number(row[6]), takerBuyVolume: Number(row[9]) }
    })
    validateCandles(page)
    if (page[0].time > cursor) throw new BacktestDataError('Historical provider returned candles outside the requested range')
    candles = [...page.filter(c => c.closeTime <= endTime), ...candles]
    cursor = page[0].time - 1
    if (data.length < pageSize) break
  }
  validateCandles(candles)
  return candles.slice(-count)
}

export async function runBacktest(input: BacktestParams): Promise<BacktestResult> {
  const params = BacktestParamsSchema.parse(input)
  const symbol = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'].includes(params.symbol) ? `${params.symbol}USDT` : params.symbol
  const endTime = Date.now() - 1
  const candles = await fetchBinanceData(symbol, params.interval, params.limit, endTime)
  if (candles.length < params.limit) throw new BacktestDataError(`Only ${candles.length} closed candles available; request a shorter history.`)
  const htfInterval = params.htfTimeframe.toLowerCase()
  const htfCount = Math.ceil((candles[candles.length - 1].closeTime - candles[0].time) / intervalMs(htfInterval)) + params.htfEmaLength + 2
  const higherCandles = await fetchBinanceData(symbol, htfInterval, htfCount, endTime)
  return backtestCandles({ ...params, symbol }, candles, higherCandles)
}

// Deterministic core; callers must supply real, chronological closed OHLCV candles.
export function backtestCandles(params: BacktestParams, candles: Candle[], higherCandles: Candle[]): BacktestResult {
  params = BacktestParamsSchema.parse(params)
  validateCandles(candles); validateCandles(higherCandles)
  const startBar = warmupBar(params)
  if (candles.length <= startBar + 1) throw new BacktestDataError('Insufficient candles for indicator warmup')
  const snapshots = evaluateStrategy(params, candles, higherCandles, intervalMs(params.interval) === intervalMs(params.htfTimeframe.toLowerCase()))
  if (snapshots.slice(startBar, -1).every(snapshot => snapshot.reasons.includes('Indicator warmup'))) {
    throw new BacktestDataError('Insufficient higher-timeframe history for EMA warmup')
  }

  type Active = { direction: 'LONG' | 'SHORT'; entryPrice: number; entryTime: number; sl: number; tp: number; quantity: number; riskAmount: number; confluenceScore: number; confluenceFactors: string[] }
  const trades: BacktestTrade[] = []
  const realizedRR: number[] = []
  let active: Active | null = null, capital = 10000, peak = capital, drawdown = 0
  let day = '', dayTrades = 0, dayLoss = 0, dayStartingCapital = capital, lastEntrySignalBar = -Infinity
  let signalsGenerated = 0, signalsFiltered = 0
  const filterReasons: Record<string, number> = {}
  const equityCurve = [{ time: new Date(candles[startBar].time).toISOString(), equity: capital }]
  const filter = (reason: string) => { signalsFiltered++; filterReasons[reason] = (filterReasons[reason] ?? 0) + 1 }
  const recordEquity = (time: number, equity: number) => {
    peak = Math.max(peak, equity)
    drawdown = Math.max(drawdown, (peak - equity) / peak * 100)
    equityCurve.push({ time: new Date(time).toISOString(), equity })
  }
  const close = (position: Active, exitPrice: number, time: number, reason: BacktestTrade['reason']) => {
    const pnl = (exitPrice - position.entryPrice) * (position.direction === 'LONG' ? 1 : -1) * position.quantity
    const pnlPercent = pnl / capital * 100
    capital += pnl
    if (pnl < 0) dayLoss -= pnl
    realizedRR.push(pnl / position.riskAmount)
    trades.push({ id: `bt-${trades.length}`, symbol: params.symbol, direction: position.direction, entryTime: new Date(position.entryTime).toISOString(), entryPrice: position.entryPrice, exitTime: new Date(time).toISOString(), exitPrice, sl: position.sl, tp: position.tp, pnl, pnlPercent, confluenceScore: position.confluenceScore, confluenceFactors: position.confluenceFactors, status: 'CLOSED', reason })
    active = null
    recordEquity(time, capital)
  }

  // A signal on candle i-1 can first fill at candle i's open.
  for (let i = startBar + 1; i < candles.length; i++) {
    const c = candles[i], j = i - 1, snapshot = snapshots[j]
    const nextDay = localParts(c.time, params.sessionTimezone).day
    if (nextDay !== day) { day = nextDay; dayTrades = 0; dayLoss = 0; dayStartingCapital = capital }
    if (!active) {
      signalsGenerated++
      if (!snapshot.qualified || !snapshot.direction || snapshot.sl == null) { filter(snapshot.reasons[0] ?? 'Unqualified strategy signal'); continue }
      if (j - lastEntrySignalBar < params.cooldownBars) { filter('Cooldown'); continue }
      if (!strategySession(c.time, params)) { filter('Next open outside strategy session'); continue }
      if (dayTrades >= params.maxTradesPerDay) { filter('Max trades/day'); continue }
      if (capital <= 0 || dayLoss >= dayStartingCapital * params.maxDailyLossPct / 100) { filter('Daily loss limit'); continue }
      const long = snapshot.direction === 'LONG'
      const sl = snapshot.sl
      const stopDistance = long ? c.open - sl : sl - c.open
      // Keep the signal candle's structural stop. A gap through it invalidates entry.
      if (!(stopDistance > 0)) { filter('Entry gap through stop'); continue }
      const tp = c.open + (long ? 1 : -1) * stopDistance * params.rrRatio
      if (!(tp > 0) || !Number.isFinite(tp)) { filter('Invalid stop or target'); continue }
      const riskAmount = capital * params.riskPct / 100
      const factors = Object.entries(snapshot.factors).filter(([, confirmed]) => confirmed).map(([factor]) => factor)
      active = { direction: snapshot.direction, entryPrice: c.open, entryTime: c.time, sl, tp, quantity: riskAmount / stopDistance, riskAmount, confluenceScore: factors.length, confluenceFactors: factors }
      lastEntrySignalBar = j
      dayTrades++
    }
    if (active) {
      const position = active, long = position.direction === 'LONG'
      // Honor opening gaps; if both levels occur intrabar, conservatively stop first.
      if (long ? c.open <= position.sl : c.open >= position.sl) close(position, c.open, c.time, 'SL')
      else if (long ? c.open >= position.tp : c.open <= position.tp) close(position, position.tp, c.time, 'TP')
      else if (long ? c.low <= position.sl : c.high >= position.sl) close(position, position.sl, c.closeTime, 'SL')
      else if (long ? c.high >= position.tp : c.low <= position.tp) close(position, position.tp, c.closeTime, 'TP')
      else recordEquity(c.closeTime, capital + (c.close - position.entryPrice) * (long ? 1 : -1) * position.quantity)
    }
  }
  if (active) close(active, candles[candles.length - 1].close, candles[candles.length - 1].closeTime, 'END_OF_DATA')
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0)
  const gp = wins.reduce((sum, t) => sum + t.pnl, 0), gl = -losses.reduce((sum, t) => sum + t.pnl, 0)
  return {
    trades: [...trades].reverse(),
    summary: {
      totalTrades: trades.length, winRate: trades.length ? wins.length / trades.length * 100 : 0,
      profitFactor: gl ? gp / gl : gp > 0 ? null : 0, netPnL: capital - 10000, maxDrawdown: drawdown,
      avgConfluence: trades.length ? trades.reduce((sum, t) => sum + t.confluenceScore, 0) / trades.length : 0,
      totalLongs: trades.filter(t => t.direction === 'LONG').length, totalShorts: trades.filter(t => t.direction === 'SHORT').length,
      avgRR: trades.length ? realizedRR.reduce((a, b) => a + b, 0) / trades.length : 0,
      bestTrade: trades.length ? Math.max(...trades.map(t => t.pnl)) : 0, worstTrade: trades.length ? Math.min(...trades.map(t => t.pnl)) : 0,
    },
    analysis: { signalsGenerated, signalsFiltered, filterReasons, equityCurve, dataSource: 'Binance spot closed candles', market: { symbol: params.symbol, interval: params.interval, candles: candles.length, from: new Date(candles[0].time).toISOString(), through: new Date(candles[candles.length - 1].closeTime).toISOString() }, warnings: [
      `Signals use the shared ${STRATEGY_VERSION} engine and client confluence rules. Delta is a smoothed candle-direction volume proxy; Pine parity still requires validation against identical candles.`,
      'Initial capital is 10,000 quote-currency units. Fees, spread, slippage, funding, borrow costs and exchange lot sizes are excluded; short positions are hypothetical.',
      'Signals fill at the next candle open. Both stop and target in one candle resolve to the stop; exits at intrabar levels use candle-close timestamps. Remaining positions close at the end of the data.',
      `Sessions, daily risk counters and VWAP resets use ${params.sessionTimezone}. Equal session start and end means all day. Session hours restrict entries only. Cooldown starts at the entry signal bar. Drawdown uses realized and candle-close marked equity.`,
    ] },
  }
}
