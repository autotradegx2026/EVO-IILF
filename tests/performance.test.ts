import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateMetrics, calculateMonthly, monthPeriodStart, MonthlyQuerySchema, periodStart, PerformanceQuerySchema, readAllPages, type PerformanceTrade } from '../lib/trading/performance'

function trade(id: string, pnl: number, closed_at: string, patch: Partial<PerformanceTrade> = {}): PerformanceTrade {
  return { id, status: 'CLOSED', closed_at, pnl, symbol: 'TEST', direction: 'LONG', entry_price: 100, stop_loss: 90, quantity: 10, confluence_score: 5, ...patch }
}

test('performance follows close chronology and includes losses in realized R', () => {
  const rows = [trade('c', -50, '2026-01-03T00:00:00Z'), trade('a', -100, '2026-01-01T00:00:00Z'), trade('b', 200, '2026-01-02T00:00:00Z')]
  const metrics = calculateMetrics(rows)
  assert.deepEqual(metrics.equityCurve.map(p => p.cumulative), [-100, 100, 50])
  assert.equal(metrics.maxDrawdownAmount, 100)
  assert.equal(metrics.maxDrawdown, null)
  assert.equal(metrics.avgRR, (-1 + 2 - 0.5) / 3)
  assert.equal(metrics.profitFactor, 200 / 150)
  assert.deepEqual(rows.map(t => t.id), ['c', 'a', 'b'])
})

test('breakeven trades neither inflate loss count nor extend streaks', () => {
  const rows = [-100, 0, -50, 100, 0, 100].map((pnl, i) => trade(String(i), pnl, `2026-01-0${i + 1}T00:00:00Z`))
  const metrics = calculateMetrics(rows)
  assert.equal(metrics.losingTrades, 2)
  assert.equal(metrics.winningTrades, 2)
  assert.equal(metrics.breakevenTrades, 2)
  assert.equal(metrics.maxLossStreak, 1)
  assert.equal(metrics.maxWinStreak, 1)
})

test('all-losing history has monetary drawdown and no fabricated equity percentage', () => {
  const metrics = calculateMetrics([trade('a', -100, '2026-01-01T00:00:00Z'), trade('b', -200, '2026-01-02T00:00:00Z')])
  assert.equal(metrics.maxDrawdownAmount, 300)
  assert.equal(metrics.maxDrawdown, null)
  assert.equal(metrics.avgRR, -1.5)
  assert.equal(metrics.profitFactor, 0)
})

test('missing risk basis is unavailable and no-loss profit factor is unbounded', () => {
  const metrics = calculateMetrics([trade('a', 100, '2026-01-01T00:00:00Z', { stop_loss: 100 })])
  assert.equal(metrics.avgRR, null)
  assert.equal(metrics.rrSampleSize, 0)
  assert.equal(metrics.profitFactor, null)
  assert.equal(calculateMetrics([]).avgRR, 0)
  assert.equal(calculateMetrics([]).profitFactor, 0)
})

test('open trades and rows without an actual close date are excluded', () => {
  const metrics = calculateMetrics([trade('a', 100, '2026-01-01T00:00:00Z', { status: 'OPEN' }), trade('b', 100, '', { closed_at: null })])
  assert.equal(metrics.totalTrades, 0)
})

test('monthly results group by close month in IST', () => {
  const months = calculateMonthly([trade('a', 100, '2026-01-31T18:29:59Z'), trade('b', -50, '2026-01-31T18:30:00Z')])
  assert.deepEqual(months.map(m => [m.month, m.net_pnl]), [['2026-01-01', 100], ['2026-02-01', -50]])
  assert.equal(months[0].profit_factor, null)
  assert.equal(months[1].profit_factor, 0)
})

test('period queries validate and use deterministic rolling and IST month boundaries', () => {
  const now = new Date('2026-03-31T20:00:00Z')
  assert.equal(periodStart('7d', now), '2026-03-24T20:00:00.000Z')
  assert.equal(periodStart('all', now), null)
  assert.equal(monthPeriodStart(1, now), '2026-03-31T18:30:00.000Z')
  assert.equal(monthPeriodStart(3, now), '2026-01-31T18:30:00.000Z')
  assert.equal(PerformanceQuerySchema.safeParse({ period: 'forever' }).success, false)
  for (const months of ['0', '-1', '25', 'abc', '1.5']) assert.equal(MonthlyQuerySchema.safeParse({ months }).success, false)
})

test('pagination continues beyond provider caps without dropping rows', async () => {
  const all = Array.from({ length: 1234 }, (_, i) => i)
  const calls: number[] = []
  const rows = await readAllPages<number>(async (from, to) => {
    calls.push(from)
    return { data: all.slice(from, Math.min(to + 1, from + 100)), error: null }
  })
  assert.deepEqual(rows, all)
  assert.equal(calls[calls.length - 1], 1234)
  await assert.rejects(readAllPages(async () => ({ data: null, error: new Error('database unavailable') })), /database unavailable/)
})
