import { parsePaperDelivery } from '@/lib/paper/delivery'
import { timeframeMilliseconds } from '@/lib/trading/session'
import { z } from 'zod'
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { readWebhookBody } from '@/lib/webhook/body'
import { parseDelivery, verifyDeliveryToken } from '@/lib/strategy/delivery'

export const runtime = 'nodejs'
const fail = (code: string, status: number) => Response.json({ error: code, code }, { status })
export async function POST(request: Request) {
  try {
    if (process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return fail('DEMO_READ_ONLY', 403)
    const userId = z.string().uuid().parse(new URL(request.url).searchParams.get('uid'))
    const raw = JSON.parse(await readWebhookBody(request)) as unknown
    const isBar = typeof raw === 'object' && raw !== null && 'kind' in raw && raw.kind === 'BAR'
    const delivery = isBar ? parsePaperDelivery(raw) : parseDelivery(raw)
    const { token, payload } = delivery
    const symbol = 'bar' in payload ? payload.bar.symbol : payload.symbol
    const tf = 'bar' in payload ? payload.bar.tf : payload.tf
    const supabase = createServiceClient()
    const ip = (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown').slice(0, 45)
    const rate = await supabase.rpc('consume_webhook_rate', { p_key: createHash('sha256').update(`tv:${ip}`).digest('hex') })
    if (rate.error) return fail('RATE_LIMIT_UNAVAILABLE', 503)
    if (!rate.data) return fail('RATE_LIMITED', 429)
    const [settings, account] = await Promise.all([
      supabase.from('settings').select('*').eq('user_id', userId).single(),
      supabase.from('users').select('is_active').eq('id', userId).single(),
    ])
    if (settings.error || account.error || !account.data?.is_active || !verifyDeliveryToken(token, settings.data?.delivery_token_hash)) return fail('INVALID_DELIVERY_TOKEN', 401)
    if (!isBar && settings.data.kill_switch_active) return fail('KILL_SWITCH_ACTIVE', 403)
    // A saved watchlist is an allowlist. Empty lists receive no unattended alerts.
    const active = isBar ? await supabase.from('paper_trades').select('timeframe').eq('user_id', userId).eq('symbol', symbol).eq('status', 'OPEN').maybeSingle() : null
    if (active?.error) return fail('PAPER_STATE_UNAVAILABLE',503)
    // Retain allowlisted candle-only alerts for chart context even when no position is open.
    const exitAllowed = !!active?.data && timeframeMilliseconds(active.data.timeframe) === timeframeMilliseconds(tf)
    if (!exitAllowed && !settings.data.screener_symbols?.includes(symbol)) return fail('SYMBOL_NOT_IN_WATCHLIST', 400)
    if (!exitAllowed && timeframeMilliseconds(tf) !== timeframeMilliseconds(settings.data.screener_timeframe ?? '15m')) return fail('TIMEFRAME_MISMATCH', 400)
    const paper = settings.data.signal_delivery_mode === 'paper'
    const payload_hash = createHash('sha256').update(JSON.stringify([userId, paper, symbol, ...('bar' in payload ? ['BAR', payload.bar.close_time] : [payload.action, payload.price, payload.timestamp])])).digest('hex')
    const queued = await supabase.from('strategy_inbox').insert({ user_id: userId, payload, payload_hash, paper })
    if (queued.error?.code === '23505') return Response.json({ data: { status: 'DUPLICATE' } })
    if (queued.error) return fail('QUEUE_UNAVAILABLE', 503)
    return Response.json({ data: { status: 'QUEUED' } }, { status: 202 })
  } catch (error) {
    if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') return fail('PAYLOAD_TOO_LARGE', 413)
    return fail('INVALID_ALERT', 400)
  }
}
