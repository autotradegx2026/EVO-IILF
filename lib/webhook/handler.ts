import { readWebhookBody } from './body'
import { configFromSettings } from '../strategy/config'
import { strategyMatches } from '../strategy/identity'
import { z } from 'zod'
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySignature } from './validate'
import { WebhookPayloadSchema } from './schema'
import { runValidationPipeline } from './processor'
import type { WebhookStatus } from '@/types/database'

const fail = (code: string, status: number) => Response.json({ error: code, code }, { status })

export async function handleWebhook(request: Request, paper = false): Promise<Response> {
  try {
    if (process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return fail('DEMO_READ_ONLY', 403)
    const uid = z.string().uuid().safeParse(new URL(request.url).searchParams.get('uid'))
    if (!uid.success) return fail('INVALID_UID', 400)
    const userId = uid.data
    const rawBody = await readWebhookBody(request)
    if (Buffer.byteLength(rawBody, 'utf8') > 16_384) return fail('PAYLOAD_TOO_LARGE', 413)
    const supabase = createServiceClient()
    const ip = (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown').slice(0, 45)
    const { data: allowed, error: rateError } = await supabase.rpc('consume_webhook_rate', {
      p_key: createHash('sha256').update(ip).digest('hex'),
    })
    if (rateError) return fail('RATE_LIMIT_UNAVAILABLE', 503)
    if (!allowed) return fail('RATE_LIMITED', 429)
    const { data: settings, error: settingsError } = await supabase.from('settings').select('*').eq('user_id', userId).single()
    const secret = settings?.webhook_secret || process.env.WEBHOOK_SECRET
    // An absent secret must never turn this public endpoint into an unauthenticated one.
    if (settingsError || !secret || !verifySignature(rawBody, request.headers.get('x-webhook-signature'), secret)) return fail('INVALID_SIGNATURE', 401)
    let raw: unknown
    try { raw = JSON.parse(rawBody) } catch { return fail('INVALID_JSON', 400) }
    const parsed = WebhookPayloadSchema.safeParse(raw)
    if (!parsed.success) return Response.json({ error: 'INVALID_PAYLOAD', code: 'INVALID_PAYLOAD', details: parsed.error.flatten() }, { status: 400 })
    const payload = parsed.data
    const age = Date.now() - Date.parse(payload.timestamp)
    if (age > 300_000 || age < -60_000) return fail('STALE_TIMESTAMP', 400)
    const hash = createHash('sha256').update(JSON.stringify([userId, paper, payload.symbol, payload.action, payload.price, payload.timestamp])).digest('hex')
    const log = async (status: WebhookStatus, reason: string | null, signalId: string | null = null) => {
      const { error } = await supabase.from('webhook_logs').insert({
        user_id: userId, raw_payload: { ...payload, is_paper: paper }, status,
        rejection_reason: reason, signal_id: signalId, ip_address: ip, processed_at: new Date().toISOString(),
      })
      if (error) throw new Error('WEBHOOK_LOG_FAILED')
    }
    const table = paper ? 'paper_trades' : 'signals'
    if (!strategyMatches(payload.strategy_config, configFromSettings(settings))) {
      await log('REJECTED', 'STRATEGY_CONFIGURATION_MISMATCH')
      return Response.json({status:'REJECTED',reason:'STRATEGY_CONFIGURATION_MISMATCH',message:'Download the current strategy and recreate the TradingView alert.'},{status:409})
    }
    const existing = await supabase.from(table).select('id').eq('payload_hash', hash).maybeSingle()
    if (existing.error) return fail('DATABASE_UNAVAILABLE', 503)
    if (existing.data) return Response.json({ status: 'REJECTED', reason: 'DUPLICATE_SIGNAL' })
    const validation = paper ? { status: 'QUALIFIED' as const, state: payload.action === 'LONG' ? 'LONG_READY' : 'SHORT_READY', reason: undefined } : await runValidationPipeline(payload, userId, supabase)
    if (validation.status === 'REJECTED') {
      await log('REJECTED', validation.reason ?? 'UNKNOWN')
      return Response.json(validation)
    }
    const stored = await supabase.rpc('persist_webhook', {
      p_user_id: userId, p_paper: paper, p_payload: {...payload,_execution_config_updated_at:settings.execution_config_updated_at}, p_hash: hash,
      p_state: validation.state, p_quantity: null, p_risk: settings.risk_percent, p_ip: ip,
    })
    if (stored.error?.code === '23505') return Response.json({ status: 'REJECTED', reason: paper ? 'DUPLICATE_OR_OPEN_POSITION' : 'DUPLICATE_SIGNAL' })
    if (stored.error?.code === 'P0001') return Response.json({ status: 'REJECTED', reason: stored.error.message })
    if (stored.error) return fail('WEBHOOK_PERSISTENCE_FAILED', 503)
    return Response.json({ status: 'QUALIFIED', state: validation.state,
      ...(paper ? { paper_trade_id: stored.data } : { signal_id: stored.data }) })
  } catch (error) {
    if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') return fail('PAYLOAD_TOO_LARGE', 413)
    return fail('INTERNAL_ERROR', 500)
  }
}
