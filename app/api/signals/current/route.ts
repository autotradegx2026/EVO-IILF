// app/api/signals/current/route.ts
import { requireAuth } from '@/lib/supabase/auth'

export async function GET() {
  try {
    const { user, supabase } = await requireAuth()

    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .eq('user_id', user.id)
      .in('state', ['LONG_READY', 'SHORT_READY', 'WAIT'])
      .eq('is_executed', false)
      .order('received_at', { ascending: false })
      .limit(1)
      .single()

    // Not found is fine — means no active signal
    if (error && error.code !== 'PGRST116') throw error

    return Response.json({ data: data ?? null })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
