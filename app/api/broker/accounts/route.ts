// app/api/broker/accounts/route.ts
import { requireAuth } from '@/lib/supabase/auth'

export async function GET() {
  try {
    const { user, supabase } = await requireAuth()

    const { data, error } = await supabase
      .from('broker_accounts')
      .select('id, broker_name, client_id, account_balance, is_active, is_connected, last_synced_at, created_at')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) throw error
    return Response.json({ data: data ?? [] })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
