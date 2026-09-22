import test from 'node:test'
import assert from 'node:assert/strict'
import { AngelExecutionBroker } from '../lib/execution/angelone'
import type { Intent } from '../lib/execution/model'

const credentials = { apiKey: 'fixture-key', password: 'fixture-password', totpSecret: 'JBSWY3DPEHPK3PXP', clientCode: 'TEST', localIp: '10.0.0.2', publicIp: '203.0.113.9' }
const symbol = 'NSE:RELIANCE-EQ'
const intent: Intent = { clientId: 'execution-uuid-entry-attempt-1', purpose: 'ENTRY', side: 'BUY', type: 'MARKET', quantity: 2, state: 'SUBMITTING' }
const master = [{ token: '2885', symbol: 'RELIANCE-EQ', exch_seg: 'NSE', tick_size: '5.000000', lotsize: '1', freeze_qty: '0' }]
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
function fixture(handler: (path: string, body: Record<string, unknown>, init: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; body: Record<string, unknown>; init: RequestInit }[] = []
  const fetcher: typeof fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname, body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    calls.push({ path, body, init })
    if (path.endsWith('loginByPassword')) return response({ status: true, data: { jwtToken: 'fixture-token' } })
    if (path.endsWith('OpenAPIScripMaster.json')) return response(master)
    return handler(path, body, init)
  }
  return { broker: new AngelExecutionBroker(credentials, fetcher), calls }
}
function order(ordertag: string) {
  return { orderid: 'order-1', ordertag, exchange: 'NSE', tradingsymbol: 'RELIANCE-EQ', transactiontype: 'BUY', ordertype: 'MARKET', producttype: 'INTRADAY',
    quantity: '2', filledshares: '1', unfilledshares: '1', averageprice: '100', orderstatus: 'open' }
}

test('Angel timeout recovery uses deterministic tag and exact partial-fill identity without retrying write', async () => {
  let sentTag = ''
  const { broker, calls } = fixture((path, body) => {
    if (path.endsWith('placeOrder')) { sentTag = String(body.ordertag); throw new Error('sensitive token fixture-token') }
    return response({ status: true, data: [order(sentTag)] })
  })
  assert.deepEqual(await broker.submit(symbol, intent), { outcome: 'UNKNOWN', reason: 'ANGEL_SUBMISSION_UNCERTAIN' })
  assert.equal(sentTag.length, 19)
  const found = await broker.lookup(symbol, intent)
  assert.equal(found?.state, 'PARTIAL'); assert.equal(found?.filled, 1); assert.equal(found?.quoteAmount, 100)
  assert.equal(found?.clientId, intent.clientId)
  assert.equal(calls.filter(c => c.path.endsWith('placeOrder')).length, 1)
  const headers = new Headers(calls.find(c => c.path.endsWith('placeOrder'))!.init.headers)
  assert.equal(headers.get('X-ClientPublicIP'), credentials.publicIp)
  assert.equal(headers.get('X-ClientLocalIP'), credentials.localIp)
  assert.equal(headers.get('Authorization'), 'Bearer fixture-token')
  assert.equal(calls.find(c => c.path.endsWith('OpenAPIScripMaster.json'))!.init.headers, undefined)
})

test('Angel successful missing lookup differs from ambiguous or mismatched order', async () => {
  let sentTag = '', mode = 'missing'
  const { broker } = fixture((path, body) => {
    if (path.endsWith('placeOrder')) { sentTag = String(body.ordertag); return response({ status: true, data: { orderid: 'order-1' } }) }
    const rows = mode === 'missing' ? [] : mode === 'ambiguous' ? [order(sentTag), { ...order(sentTag), orderid: 'order-2' }] : [{ ...order(sentTag), quantity: '3' }]
    return response({ status: true, data: rows })
  })
  await broker.submit(symbol, intent)
  assert.equal(await broker.lookup(symbol, intent), null)
  await broker.cancel(symbol, { ...intent, orderId: 'order-1' })
  mode = 'ambiguous'; await assert.rejects(broker.lookup(symbol, intent), /ANGEL_AMBIGUOUS_ORDER/)
  await broker.cancel(symbol, { ...intent, orderId: 'order-1' })
  mode = 'mismatch'; await assert.rejects(broker.lookup(symbol, { ...intent, orderId: 'order-1' }), /ANGEL_ORDER_MISMATCH/)
})

test('Angel expired read reauthenticates once, order and cancel failures never retry', async () => {
  let reads = 0
  const { broker, calls } = fixture(path => {
    if (path.endsWith('getRMS') && ++reads === 1) return response({ status: false, errorcode: 'AG8002' }, 401)
    if (path.endsWith('getRMS')) return response({ status: true, data: { availablecash: '0', net: '10000' } })
    return response({ status: false, errorcode: 'AG8002' }, 401)
  })
  assert.equal(await broker.availableQuote(symbol), 0)
  assert.equal(calls.filter(c => c.path.endsWith('loginByPassword')).length, 2)
  assert.equal((await broker.submit(symbol, intent)).outcome, 'UNKNOWN')
  await assert.rejects(broker.cancel(symbol, { ...intent, orderId: 'order-1' }), /ANGEL_CANCEL_UNCERTAIN/)
  assert.equal(calls.filter(c => c.path.endsWith('placeOrder')).length, 1)
  assert.equal(calls.filter(c => c.path.endsWith('cancelOrder')).length, 1)
  assert.equal(calls.filter(c => c.path.endsWith('loginByPassword')).length, 2)
})

test('Angel tick normalization accepts zero balances/fills but rejects zero price and invalid sizes', async () => {
  let sentTag = '', price = '100.05'
  const { broker, calls } = fixture((path, body) => {
    if (path.endsWith('getLtpData')) return response({ status: true, data: { exchange: 'NSE', tradingsymbol: 'RELIANCE-EQ', symboltoken: '2885', ltp: price } })
    if (path.endsWith('placeOrder')) { sentTag = String(body.ordertag); return response({ status: true, data: { orderid: 'order-1' } }) }
    return response({ status: true, data: [{ ...order(sentTag), filledshares: '0', unfilledshares: '2', averageprice: '0' }] })
  })
  const rules = await broker.instrument(symbol)
  assert.equal(rules.tick, 0.05); assert.equal(rules.step, 1); assert.equal(rules.maxQuantity, Number.MAX_SAFE_INTEGER)
  await broker.submit(symbol, intent)
  assert.equal((await broker.lookup(symbol, intent))?.averagePrice, 0)
  const before = calls.filter(c => c.path.endsWith('placeOrder')).length
  assert.equal((await broker.submit(symbol, { ...intent, quantity: 0 })).outcome, 'REJECTED')
  assert.equal((await broker.submit(symbol, { ...intent, type: 'STOP', trigger: 0 })).outcome, 'REJECTED')
  assert.equal((await broker.submit(symbol, { ...intent, type: 'LIMIT', price: 100.03 })).outcome, 'REJECTED')
  assert.equal(calls.filter(c => c.path.endsWith('placeOrder')).length, before)
  price = '0'; await assert.rejects(broker.instrument(symbol), /ANGEL_INVALID_NUMBER/)
})

test('Angel malformed numeric fills and unavailable books are not missing orders', async () => {
  let sentTag = '', mode = 'invalid'
  const { broker } = fixture((path, body) => {
    if (path.endsWith('placeOrder')) { sentTag = String(body.ordertag); return response({ status: true, data: { orderid: 'order-1' } }) }
    if (mode === 'unavailable') throw new Error('private broker details')
    return response({ status: true, data: [{ ...order(sentTag), filledshares: '' }] })
  })
  await broker.submit(symbol, intent)
  await assert.rejects(broker.lookup(symbol, intent), /ANGEL_INVALID_NUMBER/)
  await broker.cancel(symbol, { ...intent, orderId: 'order-1' })
  mode = 'unavailable'; await assert.rejects(broker.lookup(symbol, intent), /ANGEL_READ_UNAVAILABLE/)
})

test('Angel documented MARKET-to-LIMIT conversion retains exact identity checks', async () => {
  let sentTag = '', changedTag = false
  const { broker } = fixture((path, body) => {
    if (path.endsWith('placeOrder')) { sentTag = String(body.ordertag); return response({ status: true, data: { orderid: 'order-1' } }) }
    return response({ status: true, data: [{ ...order(changedTag ? 'different-order' : sentTag), ordertype: 'LIMIT', filledshares: '2', unfilledshares: '0', orderstatus: 'complete' }] })
  })
  await broker.submit(symbol, intent)
  assert.equal((await broker.lookup(symbol, { ...intent, orderId: 'order-1' }))?.state, 'FILLED')
  await broker.cancel(symbol, { ...intent, orderId: 'order-1' })
  changedTag = true
  await assert.rejects(broker.lookup(symbol, { ...intent, orderId: 'order-1' }), /ANGEL_ORDER_MISMATCH/)
})

test('Angel coalesces two intent lookups and throttles the fresh cancellation confirmation', async () => {
  const second: Intent = { ...intent, clientId: 'second-entry-id' }
  const tags: string[] = [], readTimes: number[] = []
  let canceled = false
  const { broker, calls } = fixture(async (path, body) => {
    if (path.endsWith('placeOrder')) { tags.push(String(body.ordertag)); return response({ status: true, data: { orderid: `order-${tags.length}` } }) }
    if (path.endsWith('cancelOrder')) { canceled = true; return response({ status: true, data: { orderid: body.orderid } }) }
    readTimes.push(Date.now())
    // Hold the first transport in flight so both lookups must coalesce.
    await new Promise(resolve => setTimeout(resolve, 10))
    return response({ status: true, data: [
      { ...order(tags[0]), filledshares: '0', unfilledshares: '2', averageprice: '0', orderstatus: canceled ? 'cancelled' : 'open' },
      { ...order(tags[1]), orderid: 'order-2' },
    ] })
  })
  await broker.submit(symbol, intent); await broker.submit(symbol, second)
  const [first, other] = await Promise.all([broker.lookup(symbol, intent), broker.lookup(symbol, second)])
  assert.equal(first?.state, 'NEW'); assert.equal(other?.state, 'PARTIAL')
  assert.equal(calls.filter(call => call.path.endsWith('getOrderBook')).length, 1)
  await broker.lookup(symbol, second)
  assert.equal(calls.filter(call => call.path.endsWith('getOrderBook')).length, 1)
  await broker.cancel(symbol, { ...intent, orderId: 'order-1' })
  const confirmed = await broker.lookup(symbol, intent)
  assert.equal(confirmed?.state, 'CANCELED')
  assert.equal(readTimes.length, 2)
  assert.ok(readTimes[1] - readTimes[0] >= 1000, 'invalidating after cancellation must preserve the request budget')
})

test('Angel invalidates a cached book after an uncertain submission without reusing missing data', async () => {
  let sentTag = ''
  const times: number[] = []
  const { broker } = fixture((path, body) => {
    if (path.endsWith('placeOrder')) { sentTag = String(body.ordertag); throw new Error('timeout after broker acceptance') }
    times.push(Date.now())
    return response({ status: true, data: sentTag ? [order(sentTag)] : [] })
  })
  assert.equal(await broker.lookup(symbol, intent), null)
  assert.equal((await broker.submit(symbol, intent)).outcome, 'UNKNOWN')
  assert.equal((await broker.lookup(symbol, intent))?.state, 'PARTIAL')
  assert.ok(times[1] - times[0] >= 1000)
})

test('Angel discards an in-flight pre-cancel book before reporting cancellation state', async () => {
  let sentTag = '', reads = 0, canceled = false
  let releaseRead!: () => void, readStarted!: () => void
  const gate = new Promise<void>(resolve => { releaseRead = resolve })
  const started = new Promise<void>(resolve => { readStarted = resolve })
  const { broker } = fixture(async (path, body) => {
    if (path.endsWith('placeOrder')) { sentTag = String(body.ordertag); return response({ status: true, data: { orderid: 'order-1' } }) }
    if (path.endsWith('cancelOrder')) { canceled = true; return response({ status: true }) }
    const status = canceled ? 'cancelled' : 'open'
    if (++reads === 1) { readStarted(); await gate }
    return response({ status: true, data: [{ ...order(sentTag), orderstatus: status }] })
  })
  await broker.submit(symbol, intent)
  const pending = broker.lookup(symbol, intent)
  await started
  await broker.cancel(symbol, { ...intent, orderId: 'order-1' })
  releaseRead()
  assert.equal((await pending)?.state, 'CANCELED')
  assert.equal(reads, 2)
})
