// app/api/broker/[id]/route.ts
import { requireAuth } from '@/lib/supabase/auth'
import { getBrokerAdapter } from '@/lib/brokers'
import type { BrokerAccount } from '@/types/database'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, supabase } = await requireAuth()

    const { count, error: openError } = await supabase.from('trades').select('id', { count: 'exact', head: true }).eq('broker_account_id', id).eq('user_id', user.id).in('status', ['OPEN', 'PENDING', 'PARTIAL'])
    if (openError) throw openError
    if (count) return Response.json({ error: 'BROKER_HAS_OPEN_TRADES', code: 'BROKER_HAS_OPEN_TRADES' }, { status: 409 })
    // Preserve references in the journal; removing an account deactivates saved credentials.
    const { error } = await supabase
      .from('broker_accounts')
      .update({ is_active: false, is_connected: false, api_key_encrypted: '', api_secret_encrypted: '', access_token_encrypted: null })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) throw error
    return Response.json({ message: 'Broker account removed' })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

// POST to test connection
export async function POST(
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
    const connected = await adapter.connect()

    const balance = connected ? await adapter.getBalance() : 0
    const updated = await supabase
      .from('broker_accounts')
      .update({ is_connected: connected, account_balance: balance, last_synced_at: new Date().toISOString() })
      .eq('id', id)

    if (updated.error) throw updated.error
    if (!connected) {
      return Response.json({ error: 'CONNECTION_FAILED', message: 'Could not authenticate with broker' }, { status: 502 })
    }

    return Response.json({ data: { connected: true }, message: 'Connection successful' })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
