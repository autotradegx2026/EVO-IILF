import { requireAuth } from '@/lib/supabase/auth'
import { BacktestDataError, BacktestParamsSchema, runBacktest } from '@/lib/trading/backtest'

export async function POST(request: Request) {
  try {
    await requireAuth()
    let body: unknown
    try { body = await request.json() } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = BacktestParamsSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid backtest settings', details: parsed.error.flatten() }, { status: 400 })
    }
    const startedAt = new Date().toISOString()
    const result = await runBacktest(parsed.data)
    return Response.json({ ...result, run: { startedAt, finishedAt: new Date().toISOString() } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof Response) return error
    if (error instanceof BacktestDataError) return Response.json({ error: error.message }, { status: 502 })
    console.error('[Backtest API Error]', error)
    return Response.json({ error: 'Backtest failed' }, { status: 500 })
  }
}
