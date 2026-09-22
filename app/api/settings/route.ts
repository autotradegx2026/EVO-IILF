// app/api/settings/route.ts
import { z } from 'zod'
import { configFromSettings, validateStrategy } from '@/lib/strategy/config'
import { requireAuth } from '@/lib/supabase/auth'

const SettingsUpdateSchema = z.object({
  adx_length: z.number().int().min(2).max(50).optional(),
  atr_length: z.number().int().min(2).max(50).optional(),
  delta_length: z.number().int().min(1).max(50).optional(),
  swing_lookback: z.number().int().min(2).max(100).optional(),
  session_timezone: z.enum(['Asia/Kolkata', 'Etc/UTC', 'America/New_York', 'Europe/London']).optional(),
  screener_symbols: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9_&.:-]{2,50}$/)).max(50).optional(),
  screener_timeframe: z.enum(['1m', '5m', '15m', '1h']).optional(),
  signal_delivery_mode: z.enum(['signals', 'paper']).optional(),
  trend_ema_length:    z.number().int().min(5).max(500).optional(),
  fast_ema_length:     z.number().int().min(3).max(200).optional(),
  htf_ema_length:      z.number().int().min(20).max(1000).optional(),
  htf_timeframe:       z.enum(['1H','2H','4H','1D','1W']).optional(),
  adx_threshold:       z.number().int().min(10).max(60).optional(),
  volume_multiplier:   z.number().min(0.5).max(5).optional(),
  atr_multiplier:      z.number().min(0.5).max(5).optional(),
  min_confluence_score:z.number().int().min(1).max(7).optional(),
  risk_percent:        z.number().min(0.1).max(10).optional(),
  rr_ratio:            z.number().min(0.5).max(10).optional(),
  cooldown_bars:       z.number().int().min(0).max(100).optional(),
  max_trades_per_day:  z.number().int().min(1).max(20).optional(),
  max_daily_loss_pct:  z.number().min(0.5).max(20).optional(),
  vwap_enabled:        z.boolean().optional(),
  delta_enabled:       z.boolean().optional(),
  fvg_enabled:         z.boolean().optional(),
  ob_enabled:          z.boolean().optional(),
  session_start:       z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).optional(),
  session_end:         z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).optional(),
  webhook_secret: z.string().min(32).max(255).nullable().optional(),
  kill_switch_active:  z.boolean().optional(),
})

export async function GET() {
  try {
    const { user, supabase } = await requireAuth()
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error) throw error
    return Response.json({ data })
  } catch (res) {
    if (res instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON', code: 'INVALID_JSON' }, { status: 400 })
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const body = await request.json()
    const parsed = SettingsUpdateSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 })
    }

    const current = await supabase.from('settings').select('*').eq('user_id', user.id).single()
    if (current.error || !current.data) return Response.json({ error: 'SETTINGS_UNAVAILABLE', code: 'SETTINGS_UNAVAILABLE' }, { status: 503 })
    const strategyError = validateStrategy(configFromSettings({ ...current.data, ...parsed.data }))
    if (strategyError) return Response.json({ error: strategyError, code: 'INVALID_STRATEGY' }, { status: 400 })
    const { data, error } = await supabase
      .from('settings')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .select()
      .single()

    if (error?.code === 'P0001') return Response.json({error:error.message,code:'RUN_CONFIGURATION_LOCKED'},{status:409})
    if (error) throw error
    return Response.json({ data, message: 'Settings updated' })
  } catch (res) {
    if (res instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON', code: 'INVALID_JSON' }, { status: 400 })
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
