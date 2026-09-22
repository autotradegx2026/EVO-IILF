import type { BrokerAdapter, OrderRequest } from '../../types/trading'

/** Persist each acknowledgement before sending the next order. Unknown results stop the sequence. */
export async function placeProtectedEntry(
  broker: BrokerAdapter, entry: OrderRequest, stopLoss: number, takeProfit: number,
  persist: (stage: 'entry' | 'sl' | 'tp', orderId: string, fillPrice?: number) => Promise<void>
): Promise<void> {
  const order = await broker.placeOrder(entry)
  if (order.status === 'FAILED') throw new Error('ENTRY_REJECTED')
  if (!order.orderId) throw new Error('ENTRY_OUTCOME_UNKNOWN')
  await persist('entry', order.orderId)
  const fill = await broker.getOrder(order.orderId)
  if (fill.status !== 'COMPLETE' || fill.filledQuantity !== entry.quantity || !fill.averagePrice) {
    throw new Error('ENTRY_FILL_REQUIRES_RECONCILIATION')
  }
  await persist('entry', order.orderId, fill.averagePrice)
  const reverse = entry.transactionType === 'BUY' ? 'SELL' : 'BUY'
  const sl = await broker.placeOrder({ ...entry, transactionType: reverse, orderType: 'SL-M', triggerPrice: stopLoss, tag: `${entry.tag}-SL` })
  if (!sl.orderId || sl.status !== 'SUCCESS') throw new Error('STOP_LOSS_REQUIRES_RECONCILIATION')
  await persist('sl', sl.orderId)
  const slState = await broker.getOrder(sl.orderId)
  if (!['OPEN', 'PENDING'].includes(slState.status) || slState.filledQuantity > 0) throw new Error('STOP_LOSS_STATE_REQUIRES_RECONCILIATION')
  const tp = await broker.placeOrder({ ...entry, transactionType: reverse, orderType: 'LIMIT', price: takeProfit, tag: `${entry.tag}-TP` })
  if (!tp.orderId || tp.status !== 'SUCCESS') throw new Error('TAKE_PROFIT_REQUIRES_RECONCILIATION')
  await persist('tp', tp.orderId)
}
