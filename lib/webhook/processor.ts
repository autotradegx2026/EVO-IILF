import type { WebhookPayload, ValidationResult } from '@/types/trading'
import type { Database } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isWithinSession, marketDayStart, timeframeMilliseconds } from '../trading/session'

export async function runValidationPipeline(
  payload: WebhookPayload, userId: string, supabase: SupabaseClient<Database>,
  options: { paper?: boolean; balance?: number; now?: Date } = {}
): Promise<ValidationResult> {
  const now = options.now ?? new Date()
  const reject = (reason: string): ValidationResult => ({ status: 'REJECTED', reason })
  const { data: settings, error } = await supabase.from('settings').select('*').eq('user_id', userId).single()
  if (error || !settings) return reject('SETTINGS_NOT_FOUND')
  if (payload.action === 'WAIT' || payload.action === 'COOLDOWN') return { status: 'QUALIFIED', state: payload.action }
  if (settings.kill_switch_active) return reject('KILL_SWITCH_ACTIVE')
  if (!isWithinSession(now, settings.session_start, settings.session_end, settings.session_timezone)) return reject('SESSION_CLOSED')
  if (payload.confluence < settings.min_confluence_score) return reject('CONFLUENCE_TOO_LOW')
  if ((payload.action === 'LONG' && !(payload.sl < payload.price && payload.tp > payload.price)) ||
      (payload.action === 'SHORT' && !(payload.tp < payload.price && payload.sl > payload.price))) return reject('INVALID_PRICE_LEVELS')
  const rr = Math.abs(payload.tp - payload.price) / Math.abs(payload.price - payload.sl)
  if (!Number.isFinite(rr) || rr < settings.rr_ratio) return reject('RR_TOO_LOW')
  const table = options.paper ? 'paper_trades' : 'trades'
  const today = marketDayStart(now, settings.session_timezone)
  const [countResult, lossResult, lastResult, openResult] = await Promise.all([
    supabase.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId).neq('status', 'REJECTED').gte('opened_at', today),
    supabase.from(table).select('pnl').eq('user_id', userId).eq('status', 'CLOSED').gte('closed_at', today),
    supabase.from(table).select('opened_at').eq('user_id', userId).neq('status', 'REJECTED').order('opened_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['OPEN', 'PARTIAL', 'PENDING']),
  ])
  if ([countResult, lossResult, lastResult, openResult].some(r => r.error)) return reject('RISK_DATA_UNAVAILABLE')
  if ((countResult.count ?? 0) >= settings.max_trades_per_day) return reject('MAX_TRADES_REACHED')
  if ((openResult.count ?? 0) > 0) return reject('OPEN_POSITION_EXISTS')
  const dailyLoss = (lossResult.data ?? []).reduce((sum, t) => sum + Math.min(0, t.pnl), 0)
  let balance = options.balance
  if (balance === undefined && !options.paper) {
    const result = await supabase.from('broker_accounts').select('account_balance').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle()
    if (result.error) return reject('RISK_DATA_UNAVAILABLE')
    balance = result.data?.account_balance
  }
  // Signals can be inspected before connecting a broker; execution supplies a verified balance.
  if (balance !== undefined && (!Number.isFinite(balance) || balance <= 0)) return reject('BALANCE_UNAVAILABLE')
  if (balance && Math.abs(dailyLoss) >= balance * settings.max_daily_loss_pct / 100) return reject('DAILY_LOSS_LOCKED')
  const barMs = timeframeMilliseconds(payload.tf)
  if (!barMs) return reject('INVALID_TIMEFRAME')
  if (lastResult.data && now.getTime() - new Date(lastResult.data.opened_at).getTime() < settings.cooldown_bars * barMs) return reject('COOLDOWN_ACTIVE')
  return { status: 'QUALIFIED', state: payload.action === 'LONG' ? 'LONG_READY' : 'SHORT_READY' }
}
