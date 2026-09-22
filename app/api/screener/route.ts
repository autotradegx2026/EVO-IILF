import { requireAuth } from '@/lib/supabase/auth'
import { configFromSettings } from '@/lib/strategy/config'
import { analysisHistorySize } from '@/lib/strategy/analysis'
import { evaluateStrategy } from '@/lib/strategy/engine'
import { fetchBinanceData } from '@/lib/trading/backtest'
import { timeframeMilliseconds } from '@/lib/trading/session'

export async function GET() {
  try {
    const { user, supabase } = await requireAuth()
    const inbox = await supabase.from('strategy_inbox').select('id, payload, status, result, received_at, paper').eq('user_id', user.id).order('received_at', { ascending: false }).limit(200)
    if (inbox.error) throw inbox.error
    return Response.json({ data: inbox.data }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: 'SCREENER_UNAVAILABLE', code: 'SCREENER_UNAVAILABLE' }, { status: 503 })
  }
}

// Optional public-data analysis for saved Binance spot symbols. No order dispatch.
export async function POST() {
  try {
    const { user, supabase } = await requireAuth()
    const current = await supabase.from('settings').select('*').eq('user_id', user.id).single()
    if (current.error || !current.data) throw new Error('Settings unavailable')
    const settings = current.data, config = configFromSettings(settings)
    const symbols = (settings.screener_symbols ?? []).filter(s => /^BINANCE:[A-Z0-9]{2,20}$/.test(s))
    if (!symbols.length || symbols.length > 5) return Response.json({ error: 'Save between one and five Binance spot symbols to run public-data analysis.', code: 'INVALID_SCAN_SIZE' }, { status: 400 })
    const interval = settings.screener_timeframe ?? '15m'
    const endTime = Date.now() - 1, count = analysisHistorySize(config,interval)
    const data = await Promise.all(symbols.map(async symbol => {
      try {
        const candles = await fetchBinanceData(symbol.slice(8), interval, count, endTime)
        const htfInterval = config.htfTimeframe.toLowerCase()
        const higherCount = Math.ceil(count * timeframeMilliseconds(interval) / timeframeMilliseconds(htfInterval)) + config.htfEmaLength + 100
        const higher = await fetchBinanceData(symbol.slice(8), htfInterval, higherCount, endTime)
        if (candles.length < count) throw new Error('Insufficient completed candle history')
        const snapshots = evaluateStrategy(config, candles, higher, interval === htfInterval)
        const snapshot = snapshots[snapshots.length - 1]
        if (endTime - snapshot.time > timeframeMilliseconds(interval) * 2) throw new Error('Market data is stale')
        return { symbol, snapshot, error: null }
      } catch (error) { return { symbol, snapshot: null, error: error instanceof Error ? error.message : 'Market data unavailable' } }
    }))
    return Response.json({ data, message: 'Closed-candle analysis only; account risk, cooldown and broker eligibility are checked separately before execution.' })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: 'SCAN_FAILED', code: 'SCAN_FAILED' }, { status: 503 })
  }
}
