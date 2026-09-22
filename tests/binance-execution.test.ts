import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac } from 'node:crypto'
import { BinanceExecutionBroker } from '../lib/execution/binance'
import type { Intent } from '../lib/execution/model'

const config = { apiKey: 'fixture-key', apiSecret: 'fixture-secret', environment: 'testnet' as const }
const intent: Intent = { clientId: 'evo-entry-1', purpose: 'ENTRY', side: 'BUY', type: 'MARKET', quantity: 3, state: 'PREPARED' }
const exchange = () => ({ symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, ocoAllowed: true, filters: [
  { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
  { filterType: 'LOT_SIZE', minQty: '0.002', maxQty: '100', stepSize: '0.002' },
  { filterType: 'MARKET_LOT_SIZE', minQty: '0.003', maxQty: '10', stepSize: '0.003' },
  { filterType: 'MIN_NOTIONAL', minNotional: '5', applyToMarket: false },
  { filterType: 'NOTIONAL', minNotional: '10', maxNotional: '1000', applyMinToMarket: true, applyMaxToMarket: false },
] }] })
const account = { canTrade: true, balances: [{ asset: 'USDT', free: '1200', locked: '100' }, { asset: 'BTC', free: '2.7', locked: '0.3' }] }
const order = (changes: Record<string, unknown> = {}) => ({ symbol: 'BTCUSDT', clientOrderId: intent.clientId, orderId: 42, orderListId: -1, side: 'BUY', status: 'FILLED', origQty: '3', executedQty: '3', cummulativeQuoteQty: '300', ...changes })
const fill = (index: number, commissionAsset: string, commission: string) => ({ symbol: 'BTCUSDT', orderId: 42, id: index, qty: '1', price: '100', quoteQty: '100', commissionAsset, commission, isBuyer: true })
type Handler = (url: URL, options: RequestInit) => Response | Promise<Response>
function fixture(handler?: Handler) {
  const calls: { url: URL; options: RequestInit }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), options = init ?? {}; calls.push({ url, options })
    if (url.pathname === '/api/v3/time') return Response.json({ serverTime: Date.now() + 1234 })
    if (handler) return handler(url, options)
    if (url.pathname === '/api/v3/exchangeInfo') return Response.json(exchange())
    if (url.pathname === '/api/v3/account') return Response.json(account)
    if (url.pathname === '/api/v3/ticker/price') return Response.json({ symbol: 'BTCUSDT', price: '100' })
    throw new Error('Unhandled fixture path')
  }
  return { fetcher, calls }
}

test('Binance testnet and live use isolated fixed endpoints with signed server-adjusted requests', async () => {
  for (const environment of ['testnet', 'live'] as const) {
    const { fetcher, calls } = fixture(), broker = new BinanceExecutionBroker({ ...config, environment }, fetcher)
    const before = Date.now(); await broker.connect(); const after = Date.now()
    assert.equal(broker.longOnly, true); assert.equal(broker.nativeOco, true)
    assert.ok(calls.every(call => call.url.origin === (environment === 'testnet' ? 'https://testnet.binance.vision' : 'https://api.binance.com')))
    const request = calls.find(call => call.url.pathname === '/api/v3/account')!
    const params = new URLSearchParams(request.url.search), signature = params.get('signature'); params.delete('signature')
    assert.equal(signature, createHmac('sha256', config.apiSecret).update(params.toString()).digest('hex'))
    assert.equal(params.get('recvWindow'), '5000')
    assert.ok(Number(params.get('timestamp')) >= before + 1200 && Number(params.get('timestamp')) <= after + 1300)
    assert.equal(new Headers(request.options.headers).get('X-MBX-APIKEY'), config.apiKey)
    assert.equal(request.options.redirect, 'error'); assert.ok(request.options.signal instanceof AbortSignal)
    assert.equal(new Headers(calls[0].options.headers).has('X-MBX-APIKEY'), false)
  }
})

test('connection refuses disabled trading and exposes no provider messages or secret-bearing network errors', async () => {
  const disabled = fixture(() => Response.json({ ...account, canTrade: false }))
  await assert.rejects(new BinanceExecutionBroker(config, disabled.fetcher).connect(), /BINANCE_TRADING_DISABLED/)
  const denied = fixture(() => Response.json({ code: -2015, msg: `secret ${config.apiSecret}` }, { status: 401 }))
  await assert.rejects(new BinanceExecutionBroker(config, denied.fetcher).connect(), error => error instanceof Error && error.message === 'BINANCE_-2015')
  const failed = fixture(() => { throw new Error(`request https://api.binance.com?secret=${config.apiSecret}`) })
  await assert.rejects(new BinanceExecutionBroker(config, failed.fetcher).connect(), error => error instanceof Error && error.message === 'BINANCE_UNAVAILABLE')
})

test('instrument combines both lot lattices and conservative notional limits, refreshing its price', async () => {
  const { fetcher, calls } = fixture(), broker = new BinanceExecutionBroker(config, fetcher)
  const rules = await broker.instrument('BINANCE:BTCUSDT')
  assert.deepEqual(rules, { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', tick: 0.01, step: 0.006, minQuantity: 0.003, maxQuantity: 10, minNotional: 10, maxNotional: 1000, price: 100 })
  await broker.instrument('BTCUSDT')
  assert.equal(calls.filter(call => call.url.pathname === '/api/v3/ticker/price').length, 2)
  assert.equal(await broker.availableQuote('BTCUSDT'), 1200)
  assert.equal(await broker.availableBase('BTCUSDT'), 2.7)
})

test('disabled market step does not erase the limit-lot step and invalid symbol metadata fails closed', async () => {
  const altered = exchange(); Object.assign(altered.symbols[0].filters[2], { stepSize: '0', minQty: '0', maxQty: '0' })
  const mock = fixture(url => Response.json(url.pathname === '/api/v3/exchangeInfo' ? altered : { symbol: 'BTCUSDT', price: '100' }))
  assert.equal((await new BinanceExecutionBroker(config, mock.fetcher).instrument('BTCUSDT')).step, 0.002)
  const invalid = fixture(() => Response.json({ symbols: [{ ...exchange().symbols[0], status: 'BREAK' }] }))
  await assert.rejects(new BinanceExecutionBroker(config, invalid.fetcher).instrument('BTCUSDT'), /BINANCE_INSTRUMENT_UNAVAILABLE/)
})

test('lookup returns null only for the explicit order-not-found response', async () => {
  for (const [code, status, absent] of [[-2013, 400, true], [-2015, 401, false], [-1007, 504, false], [-2013, 500, false]] as const) {
    const mock = fixture(() => Response.json({ code, msg: 'redacted' }, { status })), broker = new BinanceExecutionBroker(config, mock.fetcher)
    if (absent) assert.equal(await broker.lookup('BTCUSDT', intent), null)
    else await assert.rejects(broker.lookup('BTCUSDT', intent))
  }
})

test('lookup reconciles actual fills and commissions in base, quote and other assets', async () => {
  const mock = fixture(url => {
    if (url.pathname === '/api/v3/exchangeInfo') return Response.json(exchange())
    if (url.pathname === '/api/v3/order') {
      assert.equal(url.searchParams.get('origClientOrderId'), intent.clientId)
      assert.equal(url.searchParams.get('orderId'), '42')
      return Response.json(order())
    }
    assert.equal(url.pathname, '/api/v3/myTrades'); assert.equal(url.searchParams.get('orderId'), '42')
    return Response.json([fill(1, 'BTC', '0.001'), fill(2, 'USDT', '0.1'), fill(3, 'BNB', '0.0002')])
  })
  const snapshot = await new BinanceExecutionBroker(config, mock.fetcher).lookup('BTCUSDT', { ...intent, orderId: '42' })
  assert.deepEqual(snapshot, { orderId: '42', clientId: intent.clientId, state: 'FILLED', quantity: 3, filled: 3, averagePrice: 100, quoteAmount: 300, baseFee: 0.001, quoteFee: 0.1, otherFees: { BNB: 0.0002 } })
})

test('lookup refuses incomplete fees and invalid order states instead of declaring a fill', async () => {
  for (const invalidState of [false, true]) {
    const mock = fixture(url => Response.json(url.pathname === '/api/v3/exchangeInfo' ? exchange() : url.pathname === '/api/v3/order' ? order(invalidState ? { status: 'MYSTERY' } : {}) : [fill(1, 'BTC', '0.001')]))
    await assert.rejects(new BinanceExecutionBroker(config, mock.fetcher).lookup('BTCUSDT', intent), invalidState ? /INVALID_ORDER_STATE/ : /FILL_RECONCILIATION_PENDING/)
  }
})

test('lookup pages all order fills without dropping commissions after the first thousand', async () => {
  const quantities = { ...intent, quantity: 1001 }
  let pages = 0
  const mock = fixture(url => {
    if (url.pathname === '/api/v3/exchangeInfo') return Response.json(exchange())
    if (url.pathname === '/api/v3/order') return Response.json(order({ origQty: '1001', executedQty: '1001', cummulativeQuoteQty: '100100' }))
    pages++
    if (pages === 1) {
      assert.equal(url.searchParams.get('fromId'), '0')
      return Response.json(Array.from({ length: 1000 }, (_, index) => fill(index + 1, 'USDT', '0.1')))
    }
    assert.equal(url.searchParams.get('fromId'), '1001')
    return Response.json([fill(1001, 'BTC', '0.001')])
  })
  const snapshot = await new BinanceExecutionBroker(config, mock.fetcher).lookup('BTCUSDT', quantities)
  assert.equal(pages, 2); assert.equal(snapshot?.filled, 1001); assert.equal(snapshot?.baseFee, 0.001)
  assert.ok(Math.abs(snapshot!.quoteFee - 100) < 1e-8)
})

test('submissions distinguish acceptance, definitive rejection and uncertain execution without retries', async () => {
  for (const mode of ['accept', 'reject', 'timeout', 'duplicate', 'network', 'badAck'] as const) {
    const mock = fixture((_url, options) => {
      assert.equal(options.method, 'POST')
      if (mode === 'network') throw new Error(config.apiSecret)
      if (mode === 'accept') return Response.json({ symbol: 'BTCUSDT', clientOrderId: intent.clientId, orderId: 42 })
      if (mode === 'badAck') return Response.json({})
      return Response.json({ code: mode === 'reject' ? -1013 : mode === 'duplicate' ? -2010 : -1007, msg: config.apiSecret }, { status: mode === 'timeout' ? 504 : 400 })
    })
    const result = await new BinanceExecutionBroker(config, mock.fetcher).submit('BTCUSDT', intent)
    assert.equal(result.outcome, mode === 'accept' ? 'ACCEPTED' : mode === 'reject' ? 'REJECTED' : 'UNKNOWN')
    assert.equal(mock.calls.filter(call => call.options.method === 'POST').length, 1)
    assert.equal(JSON.stringify(result).includes(config.apiSecret), false)
  }
})

test('protection submits one native SELL OCO with durable IDs and never two independent sell orders', async () => {
  const stop: Intent = { ...intent, clientId: 'evo-stop-1', purpose: 'STOP', type: 'STOP', side: 'SELL', trigger: 95 }
  const target: Intent = { ...intent, clientId: 'evo-target-1', purpose: 'TARGET', type: 'LIMIT', side: 'SELL', price: 115 }
  const mock = fixture((url, options) => {
    if (url.pathname === '/api/v3/exchangeInfo') return Response.json(exchange())
    assert.equal(url.pathname, '/api/v3/orderList/oco'); assert.equal(options.method, 'POST')
    const p = url.searchParams
    assert.equal(p.get('aboveType'), 'LIMIT_MAKER'); assert.equal(p.get('belowType'), 'STOP_LOSS')
    assert.equal(p.get('side'), 'SELL'); assert.equal(p.get('quantity'), '3')
    assert.equal(p.get('aboveClientOrderId'), target.clientId); assert.equal(p.get('belowClientOrderId'), stop.clientId)
    assert.equal(p.get('listClientOrderId'), 'evo-list-1'); assert.equal(p.get('abovePrice'), '115'); assert.equal(p.get('belowStopPrice'), '95')
    return Response.json({ listClientOrderId: 'evo-list-1', orderListId: 7, orders: [{ symbol: 'BTCUSDT', clientOrderId: stop.clientId, orderId: 43 }, { symbol: 'BTCUSDT', clientOrderId: target.clientId, orderId: 44 }] })
  })
  const broker = new BinanceExecutionBroker(config, mock.fetcher)
  assert.deepEqual(await broker.protect('BINANCE:BTCUSDT', stop, target, 'evo-list-1'), { outcome: 'ACCEPTED' })
  assert.equal((await broker.submit('BTCUSDT', stop)).outcome, 'REJECTED')
  assert.equal((await broker.submit('BTCUSDT', target)).outcome, 'REJECTED')
  assert.equal(mock.calls.filter(call => call.options.method === 'POST').length, 1)
  assert.equal((await broker.protect('BTCUSDT', { ...stop, quantity: 0.001 }, { ...target, quantity: 0.001 }, 'evo-list-2')).outcome, 'REJECTED')
})

test('cancel requests the permanent order identity and leaves fill confirmation to lookup', async () => {
  const mock = fixture((url, options) => {
    assert.equal(options.method, 'DELETE'); assert.equal(url.pathname, '/api/v3/order')
    assert.equal(url.searchParams.get('origClientOrderId'), intent.clientId); assert.equal(url.searchParams.get('orderId'), '42')
    return Response.json(order({ status: 'CANCELED' }))
  })
  assert.equal(await new BinanceExecutionBroker(config, mock.fetcher).cancel('BTCUSDT', { ...intent, orderId: '42' }), undefined)
})

function candle(index: number): unknown[] {
  return [index * 60000, '100', '102', '99', '101', '10', index * 60000 + 59999, '1000', 5, '6', '600', '0']
}

test('candles use the selected environment without auth or production fallback', async () => {
  for (const environment of ['testnet', 'live'] as const) {
    const mock = fixture((url, options) => {
      assert.equal(url.pathname, '/api/v3/klines'); assert.equal(options.method, 'GET')
      assert.equal(url.searchParams.get('symbol'), 'BTCUSDT'); assert.equal(url.searchParams.get('interval'), '1m')
      assert.equal(new Headers(options.headers).has('X-MBX-APIKEY'), false)
      assert.equal(url.searchParams.has('signature'), false)
      assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal)
      return Response.json([candle(1), candle(2)])
    })
    const values = await new BinanceExecutionBroker({ ...config, environment }, mock.fetcher).candles('BINANCE:BTCUSDT', '1m', 2, 179999)
    assert.equal(values.length, 2); assert.equal(values[0].volume, 10); assert.equal(values[1].takerBuyVolume, 6)
    assert.ok(mock.calls.every(call => call.url.origin === (environment === 'testnet' ? 'https://testnet.binance.vision' : 'https://api.binance.com')))
  }
  const unavailable = fixture(() => { throw new Error('cannot reach testnet') })
  await assert.rejects(new BinanceExecutionBroker(config, unavailable.fetcher).candles('BTCUSDT', '1m', 1, 179999), /BINANCE_UNAVAILABLE/)
  assert.equal(unavailable.calls.length, 1); assert.equal(unavailable.calls[0].url.origin, 'https://testnet.binance.vision')
})

test('candles exclude unfinished bars and page backwards to replace the missing closed bar', async () => {
  const mock = fixture(url => {
    const end = Number(url.searchParams.get('endTime'))
    if (end === 150000) {
      assert.equal(url.searchParams.get('limit'), '2')
      return Response.json([candle(1), candle(2)]) // Candle 2 is still forming at this cutoff.
    }
    assert.equal(end, 59999); assert.equal(url.searchParams.get('limit'), '1')
    return Response.json([candle(0)])
  })
  const values = await new BinanceExecutionBroker(config, mock.fetcher).candles('BTCUSDT', '1m', 2, 150000)
  assert.deepEqual(values.map(value => value.time), [0, 60000])
  assert.ok(values.every(value => value.closeTime <= 150000))
  assert.equal(mock.calls.length, 2)
})

test('candles paginate at most 1000 per request and reject oversized requests before network access', async () => {
  const mock = fixture(url => {
    const limit = Number(url.searchParams.get('limit')), end = Number(url.searchParams.get('endTime'))
    assert.ok(limit <= 1000)
    const last = Math.floor(end / 60000)
    return Response.json(Array.from({ length: limit }, (_, index) => candle(last - limit + index + 1)))
  })
  const broker = new BinanceExecutionBroker(config, mock.fetcher)
  const values = await broker.candles('BTCUSDT', '1m', 1500, 1500 * 60000 - 1)
  assert.equal(values.length, 1500); assert.equal(values[0].time, 0); assert.equal(values[1499].closeTime, 89999999)
  assert.deepEqual(mock.calls.map(call => call.url.searchParams.get('limit')), ['1000', '500'])
  const extended=await broker.candles('BTCUSDT','1m',1600,1600*60000-1)
  assert.equal(extended.length,1600,'Long HTF warmup must paginate beyond 1500 bars')
  const before = mock.calls.length
  for (const count of [0, 10001, 1.5]) await assert.rejects(broker.candles('BTCUSDT', '1m', count, 89999999), /BINANCE_INVALID_HISTORY_REQUEST/)
  await assert.rejects(broker.candles('BTCUSDT', '2m', 1, 89999999), /BINANCE_INVALID_HISTORY_REQUEST/)
  assert.equal(mock.calls.length, before)
})

test('candles reject malformed OHLCV and unordered pages instead of filling gaps synthetically', async () => {
  const invalidHigh = candle(0); invalidHigh[2] = '98'
  const invalidVolume = candle(0); invalidVolume[9] = '11'
  const missingValue = candle(0); missingValue[5] = null
  for (const payload of [[invalidHigh], [invalidVolume], [missingValue], [candle(1), candle(0)], [candle(0), candle(0)], { candles: [] }]) {
    const mock = fixture(() => Response.json(payload))
    await assert.rejects(new BinanceExecutionBroker(config, mock.fetcher).candles('BTCUSDT', '1m', 2, 179999), /BINANCE_INVALID_CANDLES/)
  }
  const empty = fixture(() => Response.json([]))
  assert.deepEqual(await new BinanceExecutionBroker(config, empty.fetcher).candles('BTCUSDT', '1m', 2, 179999), [])
})
