// app/api/signals/route.ts
import { requireAuth } from '@/lib/supabase/auth'
import type { SignalState } from '@/types/database'

export async function GET(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const { searchParams } = new URL(request.url)
    const state    = searchParams.get('state') as SignalState | null
    const symbol   = searchParams.get('symbol')
    const from     = searchParams.get('from')
    const to       = searchParams.get('to')
    const page     = parseInt(searchParams.get('page') ?? '1')
    const limit    = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100)
    const offset   = (page - 1) * limit

    let query = supabase
      .from('signals')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (state)  query = query.eq('state', state)
    if (symbol) query = query.ilike('symbol', `%${symbol}%`)
    if (from)   query = query.gte('received_at', from)
    if (to)     query = query.lte('received_at', to)

    const { data, error, count } = await query
    if (error) throw error

    return Response.json({
      data: data ?? [],
      pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) },
    })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
