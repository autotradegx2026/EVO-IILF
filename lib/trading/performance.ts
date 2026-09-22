import { z } from 'zod'
import type { Trade } from '../../types/database'

const PeriodSchema = z.enum(['7d', '30d', '90d', 'all'])
export const PerformanceQuerySchema = z.object({ period: PeriodSchema.default('30d') }).strict()
export const MonthlyQuerySchema = z.object({
  period: PeriodSchema.optional(),
  months: z.coerce.number().int().min(1).max(24).optional(),
}).strict()
export type PerformancePeriod = z.infer<typeof PeriodSchema>
export type PerformanceTrade = Pick<Trade, 'id' | 'status' | 'closed_at' | 'pnl' | 'symbol' | 'direction' | 'entry_price' | 'stop_loss' | 'quantity' | 'confluence_score'>
const IST_OFFSET = 330 * 60000

export function periodStart(period: PerformancePeriod, now = new Date()): string | null {
  return period === 'all' ? null : new Date(now.getTime() - parseInt(period, 10) * 86400000).toISOString()
}

// Calendar months including the current month, with boundaries in Asia/Kolkata.
export function monthPeriodStart(months: number, now = new Date()): string {
  const local = new Date(now.getTime() + IST_OFFSET)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - months + 1, 1) - IST_OFFSET).toISOString()
}

// Advance by actual rows returned: a server-side row cap may be smaller than our page size.
export async function readAllPages<T>(readPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  while (true) {
    const { data, error } = await readPage(rows.length, rows.length + 499)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data)
  }
}

function closedChronologically(trades: PerformanceTrade[]): PerformanceTrade[] {
  return trades.filter(t => t.status === 'CLOSED' && t.closed_at != null && Number.isFinite(Date.parse(t.closed_at)))
    .sort((a, b) => Date.parse(a.closed_at!) - Date.parse(b.closed_at!) || a.id.localeCompare(b.id))
}

export function calculateMetrics(trades: PerformanceTrade[]) {
  const closed = closedChronologically(trades)
  let grossProfit = 0, grossLoss = 0, cumulative = 0, peak = 0, maxDrawdownAmount = 0
  let winningTrades = 0, losingTrades = 0, breakevenTrades = 0
  let maxWinStreak = 0, maxLossStreak = 0, winStreak = 0, lossStreak = 0
  let rrSum = 0, rrSampleSize = 0, confluenceSum = 0, confluenceCount = 0
  const equityCurve = closed.map(trade => {
    cumulative += trade.pnl
    peak = Math.max(peak, cumulative)
    maxDrawdownAmount = Math.max(maxDrawdownAmount, peak - cumulative)
    if (trade.pnl > 0) {
      grossProfit += trade.pnl; winningTrades++; winStreak++; lossStreak = 0
      maxWinStreak = Math.max(maxWinStreak, winStreak)
    } else if (trade.pnl < 0) {
      grossLoss -= trade.pnl; losingTrades++; lossStreak++; winStreak = 0
      maxLossStreak = Math.max(maxLossStreak, lossStreak)
    } else { breakevenTrades++; winStreak = 0; lossStreak = 0 }
    const originalRisk = Math.abs(trade.entry_price - trade.stop_loss) * trade.quantity
    if (originalRisk > 0 && Number.isFinite(originalRisk)) { rrSum += trade.pnl / originalRisk; rrSampleSize++ }
    if (trade.confluence_score != null) { confluenceSum += trade.confluence_score; confluenceCount++ }
    return { date: trade.closed_at, pnl: trade.pnl, cumulative, symbol: trade.symbol, direction: trade.direction }
  })
  return {
    totalTrades: closed.length, winningTrades, losingTrades, breakevenTrades,
    winRate: closed.length ? winningTrades / closed.length * 100 : 0,
    grossProfit, grossLoss, netPnl: cumulative,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    avgRR: !closed.length ? 0 : rrSampleSize === closed.length ? rrSum / closed.length : null,
    rrSampleSize,
    // A P&L series has no verified starting account equity; a percentage is undefined.
    maxDrawdown: null,
    maxDrawdownAmount, maxWinStreak, maxLossStreak,
    avgConfluenceScore: confluenceCount ? confluenceSum / confluenceCount : 0,
    equityCurve,
  }
}

export function calculateMonthly(trades: PerformanceTrade[]) {
  const months = new Map<string, PerformanceTrade[]>()
  for (const trade of closedChronologically(trades)) {
    const month = new Date(Date.parse(trade.closed_at!) + IST_OFFSET).toISOString().slice(0, 7)
    const group = months.get(month) ?? []
    group.push(trade); months.set(month, group)
  }
  return Array.from(months.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, group]) => {
    const metrics = calculateMetrics(group)
    return {
      month: `${month}-01`, net_pnl: metrics.netPnl, total_trades: metrics.totalTrades,
      winning_trades: metrics.winningTrades, losing_trades: metrics.losingTrades, breakeven_trades: metrics.breakevenTrades,
      win_rate: metrics.winRate, gross_profit: metrics.grossProfit, gross_loss: metrics.grossLoss,
      profit_factor: metrics.profitFactor, avg_confluence: metrics.avgConfluenceScore,
    }
  })
}
