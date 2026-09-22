// app/api/trades/route.ts
import { requireAuth } from '@/lib/supabase/auth'
import type { TradeStatus, TradeDirection } from '@/types/database'

export async function GET(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const { searchParams } = new URL(request.url)

    const status   = searchParams.get('status')
    const symbol   = searchParams.get('symbol')
    const direction = searchParams.get('direction')
    const from     = searchParams.get('from')
    const to       = searchParams.get('to')
    const page     = parseInt(searchParams.get('page') ?? '1')
    const limit    = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100)
    const offset   = (page - 1) * limit

    let query = supabase
      .from('trades')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('opened_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status)    query = query.eq('status', status as TradeStatus)
    if (symbol)    query = query.ilike('symbol', `%${symbol}%`)
    if (direction) query = query.eq('direction', direction as TradeDirection)
    if (from)      query = query.gte('opened_at', from)
    if (to)        query = query.lte('opened_at', to)

    const { data, count, error } = await query
    if (error) throw error

    return Response.json({ data, count, page, limit })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
