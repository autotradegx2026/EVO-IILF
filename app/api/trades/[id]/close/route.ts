import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { getBrokerAdapter } from '@/lib/brokers'

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  let claimed = false
  const id = params.id
  try {
    const { user } = await requireAuth()
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: 'INVALID_ID', code: 'INVALID_ID' }, { status: 400 })
    if (process.env.LIVE_TRADING_ENABLED !== 'true') return Response.json({ error: 'LIVE_TRADING_DISABLED', code: 'LIVE_TRADING_DISABLED' }, { status: 403 })
    const db = createServiceClient()
    const result = await db.from('trades').select('*').eq('id', id).eq('user_id', user.id).single()
    const trade = result.data
    if (result.error || !trade) return Response.json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, { status: 404 })
    if (!['OPEN', 'PARTIAL'].includes(trade.status) || trade.closing_requested || trade.execution_error) return Response.json({ error: 'TRADE_REQUIRES_RECONCILIATION', code: 'TRADE_REQUIRES_RECONCILIATION' }, { status: 409 })
    const account = await db.from('broker_accounts').select('*').eq('id', trade.broker_account_id!).eq('user_id', user.id).single()
    if (account.error || !account.data) throw new Error('BROKER_NOT_FOUND')
    const broker = getBrokerAdapter(account.data)
    if (!await broker.connect()) throw new Error('BROKER_CONNECTION_FAILED')
    const lock = await db.from('trades').update({ closing_requested: true }).eq('id', id).eq('closing_requested', false).select('id').maybeSingle()
    if (lock.error || !lock.data) return Response.json({ error: 'CLOSE_IN_PROGRESS', code: 'CLOSE_IN_PROGRESS' }, { status: 409 })
    claimed = true
    // Cancel exits and confirm their final state before submitting another closing order.
    for (const [orderId, variety] of [[trade.sl_order_id, 'STOPLOSS'], [trade.tp_order_id, 'NORMAL']] as const) {
      if (!orderId) continue
      const state = await broker.getOrder(orderId)
      if (state.filledQuantity > 0 || state.status === 'COMPLETE') throw new Error('EXIT_ALREADY_FILLED_RECONCILE')
      if (!['CANCELLED', 'REJECTED'].includes(state.status)) {
        if (!await broker.cancelOrder(orderId, variety)) throw new Error('EXIT_CANCELLATION_FAILED')
        const final = await broker.getOrder(orderId)
        if (final.status !== 'CANCELLED' || final.filledQuantity > 0) throw new Error('EXIT_CANCELLATION_UNCONFIRMED')
      }
    }
    const symbol = trade.symbol.split(':').pop()!
    const exchange = trade.exchange ?? 'NSE'
    if (exchange !== 'NSE' && exchange !== 'BSE') throw new Error('UNSUPPORTED_EXCHANGE')
    const positions = await broker.getPositions()
    const position = positions.find(p => p.symbol === symbol && p.exchange === exchange && p.productType === 'INTRADAY')
    if (!position || position.direction !== trade.direction || position.quantity !== trade.quantity) throw new Error('POSITION_MISMATCH_RECONCILE')
    const order = await broker.placeOrder({ symbol, exchange, transactionType: trade.direction === 'LONG' ? 'SELL' : 'BUY',
      orderType: 'MARKET', productType: 'INTRADAY', quantity: trade.quantity, tag: `EVO-CLOSE-${id.slice(0, 8)}` })
    if (order.status === 'FAILED' || !order.orderId) throw new Error('CLOSE_ORDER_REQUIRES_RECONCILIATION')
    const saved = await db.from('trades').update({ close_order_id: order.orderId }).eq('id', id)
    if (saved.error) throw new Error('CLOSE_ORDER_PERSISTENCE_FAILED')
    const fill = await broker.getOrder(order.orderId)
    if (fill.status !== 'COMPLETE' || fill.filledQuantity !== trade.quantity || !fill.averagePrice) throw new Error('CLOSE_FILL_UNCONFIRMED')
    const pnl = (fill.averagePrice - trade.entry_price) * trade.quantity * (trade.direction === 'LONG' ? 1 : -1)
    const closed = await db.from('trades').update({ status: 'CLOSED', close_price: fill.averagePrice, pnl,
      close_reason: 'MANUAL', closed_at: new Date().toISOString(), closing_requested: false }).eq('id', id)
    if (closed.error) throw new Error('CLOSE_PERSISTENCE_FAILED')
    const positionClosed = await db.from('positions').update({ is_open: false, current_price: fill.averagePrice, unrealized_pnl: 0, last_updated: new Date().toISOString() }).eq('trade_id', id)
    if (positionClosed.error) throw new Error('POSITION_PERSISTENCE_FAILED')
    return Response.json({ data: { orderId: order.orderId, pnl }, message: 'Position closure confirmed' })
  } catch (res) {
    if (res instanceof Response) return res
    const code = res instanceof Error ? res.message : 'CLOSE_FAILED'
    if (claimed) {
      const db = createServiceClient()
      const t = await db.from('trades').update({ execution_error: code }).eq('id', id).select('user_id').single()
      if (t.data) {
        await db.from('settings').update({ kill_switch_active: true }).eq('user_id', t.data.user_id)
        await db.from('alerts').insert({ user_id: t.data.user_id, type: 'ORDER_REJECTED', title: 'Close needs broker reconciliation', message: code, trade_id: id })
      }
    }
    return Response.json({ error: code, code }, { status: 502 })
  }
}
