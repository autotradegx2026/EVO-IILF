// app/api/paper/route.ts — Paper trading CRUD
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'

const CreateSchema = z.object({
  symbol:           z.string().trim().toUpperCase().min(1).max(50),
  timeframe: z.enum(['1m','5m','15m','1h']).default('15m'),
  direction:        z.enum(['LONG', 'SHORT']),
  entry_price:      z.number().positive(),
  stop_loss:        z.number().positive(),
  take_profit:      z.number().positive(),
  quantity:         z.number().positive(),
  initial_capital:  z.number().positive().default(100000),
  risk_percent:     z.number().min(0.1).max(10).default(1.0),
  rr_ratio:         z.number().optional(),
  confluence_score: z.number().int().min(0).max(7).optional(),
  signal_id:        z.string().uuid().optional(),
  notes:            z.string().max(500).optional(),
})

export async function GET(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const { searchParams } = new URL(request.url)
    const parsed = z.object({status:z.enum(['OPEN','CLOSED']).optional(),limit:z.coerce.number().int().min(1).max(200).default(100)}).safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return Response.json({error:'INVALID_QUERY',code:'INVALID_QUERY'},{status:400})
    const {status,limit}=parsed.data

    let query = supabase
      .from('paper_trades')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('opened_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)

    const { data, error, count } = await query
    if (error) throw error
    const [health, configuration, observations, history] = await Promise.all([
      createServiceClient().from('automation_runs').select('last_started_at,last_finished_at,result').eq('name','paper').maybeSingle(),
      supabase.from('settings').select('paper_trading_enabled,paper_started_at,paper_stopped_at,paper_symbols,paper_timeframe,screener_timeframe,paper_auto_scan,signal_delivery_mode,kill_switch_active,paper_last_scan_at,paper_scan_error,session_start,session_end,session_timezone,rr_ratio,risk_percent,max_trades_per_day,max_daily_loss_pct,min_confluence_score,screener_symbols,updated_at,execution_config_updated_at').eq('user_id',user.id).single(),
      supabase.from('paper_observations').select('*').eq('user_id',user.id).order('checked_at',{ascending:false}).limit(50),
      supabase.from('paper_analysis_history').select('*',{count:'exact'}).eq('user_id',user.id).order('bar_close',{ascending:false}).limit(100),
    ])
    return Response.json({ data: data ?? [], analysisHistory:history.error?null:history.data, analysisHistoryCount:history.error?null:history.count, observations: observations.error ? null : observations.data, count, asOf: new Date().toISOString(), configuration: configuration.error ? null : configuration.data, automation: health.data ? {last_started_at:health.data.last_started_at,last_finished_at:health.data.last_finished_at,status:health.data.result?.status} : null },{headers:{'Cache-Control':'private, no-store'}})
  } catch (res) {
    if (res instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON', code: 'INVALID_JSON' }, { status: 400 })
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const body = await request.json()
    const parsed = CreateSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 })
    }

    const d = parsed.data

    // Validate direction logic
    if (d.direction === 'LONG' && d.stop_loss >= d.entry_price) {
      return Response.json({ error: 'INVALID_SL', message: 'LONG: SL must be below entry' }, { status: 400 })
    }
    if (d.direction === 'SHORT' && d.stop_loss <= d.entry_price) {
      return Response.json({ error: 'INVALID_SL', message: 'SHORT: SL must be above entry' }, { status: 400 })
    }

    if ((d.direction === 'LONG' && d.take_profit <= d.entry_price) || (d.direction === 'SHORT' && d.take_profit >= d.entry_price)) {
      return Response.json({ error: 'INVALID_TP', code: 'INVALID_TP' }, { status: 400 })
    }
    if (d.signal_id) {
      const signal = await supabase.from('signals').select('id').eq('id', d.signal_id).eq('user_id', user.id).single()
      if (signal.error || !signal.data) return Response.json({ error: 'SIGNAL_NOT_FOUND', code: 'SIGNAL_NOT_FOUND' }, { status: 404 })
    }
    const { data, error } = await createServiceClient()
      .from('paper_trades')
      .insert({ ...d, user_id: user.id, signal_time:new Date().toISOString() })
      .select()
      .single()

    if (error?.code === '23505') return Response.json({ error: 'OPEN_POSITION_EXISTS', code: 'OPEN_POSITION_EXISTS' }, { status: 409 })
    if (error?.code === 'P0001') return Response.json({error:error.message,code:'PAPER_ENTRY_REJECTED'},{status:400})
    if (error) throw error
    return Response.json({ data, message: 'Paper trade opened' }, { status: 201 })
  } catch (res) {
    if (res instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON', code: 'INVALID_JSON' }, { status: 400 })
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
