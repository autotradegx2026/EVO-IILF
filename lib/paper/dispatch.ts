import { createHmac } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { handleWebhook } from '../webhook/handler'
import { timeframeMilliseconds } from '../trading/session'
import { applyPaperBar } from './monitor'
import { PaperBarSchema } from './exit'

export async function dispatchStrategyInbox(db: SupabaseClient<Database>) {
  const claim = await db.rpc('claim_strategy_inbox', {})
  if (claim.error || !Array.isArray(claim.data)) throw new Error('QUEUE_CLAIM_FAILED')
  const rows = claim.data as { id: string; claim_id: string; user_id: string; paper: boolean; payload: Record<string, unknown>; attempts: number }[]
  const results = []
  // Claim order is not guaranteed by UPDATE RETURNING. Preserve bar chronology.
  rows.sort((a, b) => {
    const time = (r: typeof a) => String((r.payload.bar as {close_time?: string} | undefined)?.close_time ?? r.payload.timestamp)
    return time(a).localeCompare(time(b))
  })
  for (const row of rows) {
    let result: Record<string, unknown> = {}, status = 'DONE'
    try {
      const [settings, account] = await Promise.all([
        db.from('settings').select('*').eq('user_id', row.user_id).single(),
        db.from('users').select('is_active').eq('id', row.user_id).single(),
      ])
      if (settings.error || account.error) throw new Error('DELIVERY_SETTINGS_UNAVAILABLE')
      let payload = row.payload
      if (payload.kind === 'BAR') {
        const bar = PaperBarSchema.parse(payload.bar)
        // Protection continues even when entries/watchlists/mode/kill switch change.
        result = { exit: await applyPaperBar(db, row.user_id, bar) }
        if (!payload.entry) payload = {}
        else payload = payload.entry as Record<string, unknown>
      }
      if (payload.action) {
        if ((row.paper && !settings.data.paper_trading_enabled) || !account.data?.is_active || settings.data.kill_switch_active || !settings.data.screener_symbols?.includes(String(payload.symbol)) ||
          timeframeMilliseconds(String(payload.tf)) !== timeframeMilliseconds(settings.data.screener_timeframe ?? '15m') || (settings.data.signal_delivery_mode === 'paper') !== row.paper) {
          result = { ...result, error: 'DELIVERY_CONFIGURATION_CHANGED' }; status = 'FAILED'
        } else {
          const key = settings.data.webhook_secret || process.env.WEBHOOK_SECRET
          if (!key) throw new Error('DELIVERY_SETTINGS_UNAVAILABLE')
          const body = JSON.stringify(payload)
          const response = await handleWebhook(new Request(`http://internal/api/webhook?uid=${row.user_id}`, { method: 'POST', body,
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `queue-${row.user_id}`, 'X-Webhook-Signature': `sha256=${createHmac('sha256', key).update(body).digest('hex')}` } }), row.paper)
          const entry = await response.json() as Record<string, unknown>
          result = { ...result, ...entry }
          const retry = response.status === 429 || response.status >= 500 || (entry.status === 'REJECTED' && ['RISK_DATA_UNAVAILABLE','SETTINGS_NOT_FOUND'].includes(String(entry.reason)))
          status = retry ? row.attempts < 3 ? 'QUEUED' : 'FAILED' : response.ok ? 'DONE' : 'FAILED'
        }
      }
    } catch { result = { error: 'DELIVERY_FAILED' }; status = row.attempts < 3 ? 'QUEUED' : 'FAILED' }
    const update = await db.from('strategy_inbox').update({ status, result }).eq('id', row.id).eq('status', 'PROCESSING').eq('claim_id', row.claim_id).select('id').maybeSingle()
    results.push({ id: row.id, status: update.error ? 'PERSISTENCE_FAILED' : update.data ? status : 'LEASE_LOST' })
  }
  return results
}
