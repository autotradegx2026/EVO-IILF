import { requireAuth } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { getBrokerAdapter } from '@/lib/brokers'

export async function GET() {
  try {
    const { user, supabase } = await requireAuth()
    const result = await supabase.from('positions').select('*').eq('user_id', user.id).eq('is_open', true).order('last_updated', { ascending: false })
    if (result.error) throw result.error
    const positions = result.data ?? []
    const warnings: string[] = []
    if (positions.length) {
      const db = createServiceClient()
      const ids = Array.from(new Set(positions.map(p => p.broker_account_id).filter((id): id is string => Boolean(id))))
      for (const id of ids) {
        try {
          const account = await db.from('broker_accounts').select('*').eq('id', id).eq('user_id', user.id).single()
          if (account.error || !account.data) throw new Error('BROKER_UNAVAILABLE')
          const broker = getBrokerAdapter(account.data)
          if (!await broker.connect()) throw new Error('BROKER_CONNECTION_FAILED')
          const live = await broker.getPositions()
          for (const p of positions.filter(p => p.broker_account_id === id)) {
            const match = live.find(b => b.symbol === p.symbol.split(':').pop() && b.direction === p.direction && b.quantity === p.quantity && b.productType === 'INTRADAY')
            if (!match) { warnings.push(`${p.symbol}: broker position needs reconciliation`); continue }
            p.current_price = match.currentPrice
            p.unrealized_pnl = match.unrealizedPnl
            p.last_updated = new Date().toISOString()
            const updated = await db.from('positions').update({ current_price: p.current_price, unrealized_pnl: p.unrealized_pnl, last_updated: p.last_updated }).eq('id', p.id).eq('user_id', user.id)
            if (updated.error) throw updated.error
          }
        } catch { warnings.push('Broker refresh failed; showing last confirmed prices') }
      }
    }
    return Response.json({ data: positions, warnings })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'POSITIONS_UNAVAILABLE', code: 'POSITIONS_UNAVAILABLE' }, { status: 503 })
  }
}
