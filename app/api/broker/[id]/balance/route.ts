// app/api/broker/[id]/balance/route.ts
import { requireAuth } from '@/lib/supabase/auth'
import { getBrokerAdapter } from '@/lib/brokers'
import type { BrokerAccount } from '@/types/database'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, supabase } = await requireAuth()

    const { data: account } = await supabase
      .from('broker_accounts')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!account) {
      return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    }

    const adapter = getBrokerAdapter(account as BrokerAccount)
    const ok = await adapter.connect()
    if (!ok) {
      return Response.json({ error: 'CONNECTION_FAILED' }, { status: 502 })
    }
    const balance = await adapter.getBalance()

    // Update cached balance
    await supabase
      .from('broker_accounts')
      .update({ account_balance: balance, last_synced_at: new Date().toISOString() })
      .eq('id', id)

    return Response.json({ data: { balance } })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
