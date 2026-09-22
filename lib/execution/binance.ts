import { createHmac } from 'crypto'
import type { Environment, ExecutionBroker, Instrument, Intent, OrderSnapshot, OrderState, Submission } from './model'
import { validateCandles, type Candle } from '../strategy/indicators'

type Json = Record<string, unknown>
type Rules = Omit<Instrument, 'price'> & { minPrice: number; maxPrice: number }
class BinanceError extends Error {
  constructor(readonly code: number | null, readonly status = 0, message = 'BINANCE_UNAVAILABLE') { super(code === null ? message : `BINANCE_${code}`) }
}
const object = (value: unknown): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BinanceError(null, 0, 'BINANCE_INVALID_RESPONSE')
  return value as Json
}
const numeric = (value: unknown, positive = false): number => {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d+)?$/.test(String(value))) throw new BinanceError(null, 0, 'BINANCE_INVALID_NUMBER')
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0 || (positive && result === 0)) throw new BinanceError(null, 0, 'BINANCE_INVALID_NUMBER')
  return result
}
const id = (value: unknown): string => {
  if (!/^\d+$/.test(String(value)) || (typeof value === 'number' && !Number.isSafeInteger(value))) throw new BinanceError(null, 0, 'BINANCE_INVALID_ID')
  return String(value)
}
const asset = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Z0-9]{1,30}$/.test(value)) throw new BinanceError(null, 0, 'BINANCE_INVALID_ASSET')
  return value
}
const symbolName = (value: string) => asset(value.replace(/^BINANCE:/, ''))
const clientId = (value: string) => {
  if (!/^[a-zA-Z0-9._:/-]{1,36}$/.test(value)) throw new BinanceError(null, 0, 'BINANCE_INVALID_CLIENT_ID')
  return value
}
const decimal = (value: number) => {
  if (!Number.isFinite(value) || value <= 0 || value >= 1e21) throw new BinanceError(null, 0, 'BINANCE_INVALID_ORDER')
  const result = value.toFixed(12).replace(/\.?0+$/, '')
  if (Number(result) !== value) throw new BinanceError(null, 0, 'BINANCE_UNSUPPORTED_PRECISION')
  return result
}
const closeEnough = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-10, Math.max(a, b) * 1e-9)
// Integer scaling preserves steps such as 0.002 and 0.003, whose intersection is 0.006.
function scaled(value: number): bigint { return BigInt(value.toFixed(12).replace('.', '')) }
function combinedStep(values: number[]): number {
  const gcd = (a: bigint, b: bigint): bigint => { while (b !== BigInt(0)) [a, b] = [b, a % b]; return a }
  let result = BigInt(0)
  for (const value of values.filter(n => n > 0)) {
    decimal(value)
    const step = scaled(value)
    if (step === BigInt(0)) throw new BinanceError(null, 0, 'BINANCE_UNSUPPORTED_PRECISION')
    result = result === BigInt(0) ? step : result / gcd(result, step) * step
  }
  const step = Number(result) / 1e12
  if (!Number.isFinite(step) || step <= 0 || !Number.isSafeInteger(Number(result))) throw new BinanceError(null, 0, 'BINANCE_UNSUPPORTED_PRECISION')
  return step
}
function aligned(value: number, step: number): boolean { return scaled(Number(decimal(value))) % scaled(step) === BigInt(0) }

/** Spot-only implementation. No endpoint fallback, automatic resubmission, or synthetic fills. */
export class BinanceExecutionBroker implements ExecutionBroker {
  readonly venue = 'binance' as const
  readonly nativeOco = true
  readonly longOnly = true
  readonly environment: Environment
  private readonly baseUrl: string
  private offset = 0
  private syncedAt = 0
  private syncPending: Promise<void> | null = null
  private rulesCache = new Map<string, Rules>()
  constructor(private readonly config: { apiKey: string; apiSecret: string; environment: Environment }, private readonly fetcher: typeof fetch = fetch) {
    if (!config.apiKey || !config.apiSecret || !['testnet', 'live'].includes(config.environment)) throw new Error('BINANCE_INVALID_CONFIGURATION')
    this.environment = config.environment
    this.baseUrl = this.environment === 'testnet' ? 'https://testnet.binance.vision' : 'https://api.binance.com'
  }

  private async request(path: string, params: Record<string, string> = {}, method = 'GET', signed = false): Promise<unknown> {
    if (signed) await this.syncTime()
    const query = new URLSearchParams(params)
    if (signed) {
      query.set('timestamp', String(Math.round(Date.now() + this.offset)))
      query.set('recvWindow', '5000')
      query.set('signature', createHmac('sha256', this.config.apiSecret).update(query.toString()).digest('hex'))
    }
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}${query.size ? `?${query}` : ''}`, {
        method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: signed ? { 'X-MBX-APIKEY': this.config.apiKey } : {},
      })
      let data: unknown
      try { data = await response.json() } catch { throw new BinanceError(null, response.status, 'BINANCE_INVALID_RESPONSE') }
      const code = data && typeof data === 'object' && !Array.isArray(data) ? (data as Json).code : undefined
      if (!response.ok || (typeof code === 'number' && code < 0)) throw new BinanceError(typeof code === 'number' && Number.isInteger(code) && code < 0 ? code : null, response.status)
      return data
    } catch (error) {
      if (error instanceof BinanceError) throw error
      // Never propagate fetch URLs, API keys, signatures, or arbitrary exchange messages.
      throw new BinanceError(null)
    }
  }
  private async syncTime() {
    if (Date.now() - this.syncedAt < 60000) return
    if (!this.syncPending) this.syncPending = (async () => {
      const start = Date.now(), data = object(await this.request('/api/v3/time'))
      const finish = Date.now(), serverTime = numeric(data.serverTime, true)
      if (!Number.isSafeInteger(serverTime) || finish - start >= 5000) throw new BinanceError(null, 0, 'BINANCE_CLOCK_UNAVAILABLE')
      this.offset = serverTime - (start + finish) / 2
      this.syncedAt = finish
    })().finally(() => { this.syncPending = null })
    await this.syncPending
  }
  private async account() { return object(await this.request('/api/v3/account', {}, 'GET', true)) }
  async connect(): Promise<void> {
    if ((await this.account()).canTrade !== true) throw new Error('BINANCE_TRADING_DISABLED')
  }

  /** Historical signals must use the same venue/environment as execution. */
  async candles(symbol: string, interval: string, count: number, endTime: number): Promise<Candle[]> {
    const name = symbolName(symbol)
    if (!['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'].includes(interval) ||
      !Number.isInteger(count) || count < 1 || count > 10000 || !Number.isSafeInteger(endTime) || endTime < 0) {
      throw new BinanceError(null, 0, 'BINANCE_INVALID_HISTORY_REQUEST')
    }
    const cutoff = Math.min(endTime, Date.now() - 1)
    let cursor = cutoff, candles: Candle[] = []
    while (candles.length < count && cursor >= 0) {
      const limit = Math.min(1000, count - candles.length)
      const raw = await this.request('/api/v3/klines', { symbol: name, interval, limit: String(limit), endTime: String(cursor) })
      if (!Array.isArray(raw) || raw.length > limit) throw new BinanceError(null, 0, 'BINANCE_INVALID_CANDLES')
      if (!raw.length) break
      let page: Candle[]
      try {
        page = raw.map(value => {
          if (!Array.isArray(value) || value.length < 10) throw new Error('CANDLE')
          const time = numeric(value[0]), closeTime = numeric(value[6])
          if (!Number.isSafeInteger(time) || !Number.isSafeInteger(closeTime) || time > cursor) throw new Error('TIME')
          return { time, open: numeric(value[1], true), high: numeric(value[2], true), low: numeric(value[3], true), close: numeric(value[4], true),
            volume: numeric(value[5]), closeTime, takerBuyVolume: numeric(value[9]) }
        })
        validateCandles(page)
        candles = [...page.filter(value => value.closeTime <= cutoff), ...candles]
        validateCandles(candles)
      } catch { throw new BinanceError(null, 0, 'BINANCE_INVALID_CANDLES') }
      cursor = page[0].time - 1
      if (raw.length < limit) break
    }
    return candles.slice(-count)
  }

  private async rules(symbol: string, refresh = false): Promise<Rules> {
    const name = symbolName(symbol)
    if (!refresh && this.rulesCache.has(name)) return this.rulesCache.get(name)!
    const response = object(await this.request('/api/v3/exchangeInfo', { symbol: name }))
    if (!Array.isArray(response.symbols)) throw new BinanceError(null, 0, 'BINANCE_INVALID_INSTRUMENT')
    const found = response.symbols.map(object).find(row => row.symbol === name)
    if (!found || found.status !== 'TRADING' || found.isSpotTradingAllowed !== true || found.ocoAllowed !== true || !Array.isArray(found.filters)) throw new BinanceError(null, 0, 'BINANCE_INSTRUMENT_UNAVAILABLE')
    const filters = found.filters.map(object), price = filters.find(row => row.filterType === 'PRICE_FILTER'), lot = filters.find(row => row.filterType === 'LOT_SIZE')
    if (!price || !lot) throw new BinanceError(null, 0, 'BINANCE_MISSING_FILTERS')
    const lots = [lot, ...filters.filter(row => row.filterType === 'MARKET_LOT_SIZE')]
    const notionals = filters.filter(row => ['MIN_NOTIONAL', 'NOTIONAL'].includes(String(row.filterType)))
    const maxima = lots.map(row => numeric(row.maxQty)).filter(n => n > 0)
    const maximumNotionals = notionals.filter(row => row.filterType === 'NOTIONAL').map(row => numeric(row.maxNotional)).filter(n => n > 0)
    const rules: Rules = {
      symbol: name, base: asset(found.baseAsset), quote: asset(found.quoteAsset), tick: numeric(price.tickSize, true),
      step: combinedStep(lots.map(row => numeric(row.stepSize))), minQuantity: Math.max(...lots.map(row => numeric(row.minQty))),
      maxQuantity: maxima.length ? Math.min(...maxima) : 0,
      minNotional: Math.max(0, ...notionals.map(row => numeric(row.minNotional))),
      ...(maximumNotionals.length ? { maxNotional: Math.min(...maximumNotionals) } : {}),
      minPrice: numeric(price.minPrice), maxPrice: numeric(price.maxPrice),
    }
    if (rules.maxQuantity <= 0 || rules.minQuantity > rules.maxQuantity || (rules.maxNotional !== undefined && rules.minNotional > rules.maxNotional)) throw new BinanceError(null, 0, 'BINANCE_INCONSISTENT_FILTERS')
    this.rulesCache.set(name, rules)
    return rules
  }
  async instrument(symbol: string): Promise<Instrument> {
    const rules = await this.rules(symbol, true)
    const ticker = object(await this.request('/api/v3/ticker/price', { symbol: rules.symbol }))
    if (ticker.symbol !== rules.symbol) throw new BinanceError(null, 0, 'BINANCE_INVALID_TICKER')
    const { minPrice: _min, maxPrice: _max, ...instrument } = rules
    return { ...instrument, price: numeric(ticker.price, true) }
  }
  private async available(symbol: string, side: 'base' | 'quote'): Promise<number> {
    const rules = await this.rules(symbol), account = await this.account()
    if (!Array.isArray(account.balances)) throw new BinanceError(null, 0, 'BINANCE_INVALID_BALANCES')
    const balance = account.balances.map(object).find(row => row.asset === rules[side])
    return balance ? numeric(balance.free) : 0
  }
  availableQuote(symbol: string) { return this.available(symbol, 'quote') }
  availableBase(symbol: string) { return this.available(symbol, 'base') }

  async lookup(symbol: string, intent: Intent): Promise<OrderSnapshot | null> {
    const name = symbolName(symbol)
    let order: Json
    try { order = object(await this.request('/api/v3/order', { symbol: name, origClientOrderId: clientId(intent.clientId), ...(intent.orderId ? { orderId: id(intent.orderId) } : {}) }, 'GET', true)) }
    catch (error) { if (error instanceof BinanceError && error.code === -2013 && error.status === 400) return null; throw error }
    if (order.symbol !== name || order.clientOrderId !== intent.clientId || order.side !== intent.side) throw new BinanceError(null, 0, 'BINANCE_ORDER_MISMATCH')
    const states: Record<string, OrderState> = { NEW: 'NEW', PENDING_NEW: 'NEW', PARTIALLY_FILLED: 'PARTIAL', FILLED: 'FILLED', CANCELED: 'CANCELED', REJECTED: 'REJECTED', EXPIRED: 'EXPIRED', EXPIRED_IN_MATCH: 'EXPIRED', PENDING_CANCEL: 'UNKNOWN' }
    const state = states[String(order.status)]
    if (!state) throw new BinanceError(null, 0, 'BINANCE_INVALID_ORDER_STATE')
    const snapshot: OrderSnapshot = { orderId: id(order.orderId), clientId: intent.clientId, state, quantity: numeric(order.origQty, true), filled: numeric(order.executedQty), quoteAmount: numeric(order.cummulativeQuoteQty), averagePrice: 0, baseFee: 0, quoteFee: 0, otherFees: {} }
    if (!closeEnough(snapshot.quantity, intent.quantity) || snapshot.filled > snapshot.quantity || (state === 'FILLED' && !closeEnough(snapshot.filled, snapshot.quantity)) || (!snapshot.filled && snapshot.quoteAmount)) throw new BinanceError(null, 0, 'BINANCE_INVALID_FILL_TOTALS')
    if (order.orderListId !== undefined && String(order.orderListId) !== '-1') snapshot.listId = id(order.orderListId)
    if (snapshot.filled) {
      const rules = await this.rules(name)
      let quantity = 0, quote = 0, fromId = '0', complete = false
      const seen = new Set<string>()
      for (let page = 0; page < 10; page++) {
        const rows = await this.request('/api/v3/myTrades', { symbol: name, orderId: snapshot.orderId, fromId, limit: '1000' }, 'GET', true)
        if (!Array.isArray(rows)) throw new BinanceError(null, 0, 'BINANCE_INVALID_FILLS')
        let lastId = BigInt(fromId) - BigInt(1)
        for (const value of rows) {
          const fill = object(value), tradeId = id(fill.id)
          if (seen.has(tradeId) || BigInt(tradeId) < BigInt(fromId) || fill.symbol !== name || id(fill.orderId) !== snapshot.orderId || fill.isBuyer !== (intent.side === 'BUY')) throw new BinanceError(null, 0, 'BINANCE_FILL_MISMATCH')
          seen.add(tradeId); if (BigInt(tradeId) > lastId) lastId = BigInt(tradeId)
          const qty = numeric(fill.qty, true), amount = numeric(fill.quoteQty, true), price = numeric(fill.price, true), fee = numeric(fill.commission), feeAsset = asset(fill.commissionAsset)
          if (!closeEnough(qty * price, amount)) throw new BinanceError(null, 0, 'BINANCE_INVALID_FILL_TOTALS')
          quantity += qty; quote += amount
          if (feeAsset === rules.base) snapshot.baseFee += fee
          else if (feeAsset === rules.quote) snapshot.quoteFee += fee
          else snapshot.otherFees[feeAsset] = (snapshot.otherFees[feeAsset] ?? 0) + fee
        }
        if (rows.length < 1000) { complete = true; break }
        fromId = String(lastId + BigInt(1))
      }
      if (!complete || !closeEnough(quantity, snapshot.filled) || !closeEnough(quote, snapshot.quoteAmount)) throw new BinanceError(null, 0, 'BINANCE_FILL_RECONCILIATION_PENDING')
      snapshot.averagePrice = quote / quantity
      if (![snapshot.averagePrice, snapshot.baseFee, snapshot.quoteFee, ...Object.values(snapshot.otherFees)].every(Number.isFinite)) throw new BinanceError(null, 0, 'BINANCE_INVALID_FILL_TOTALS')
    }
    return snapshot
  }

  private submissionError(error: unknown): Submission {
    // Backend timeouts, disconnects, rate limits and ambiguous duplicate IDs need lookup.
    if (error instanceof BinanceError && error.code !== null && error.status >= 400 && error.status < 500 && ![-1000, -1001, -1006, -1007, -1003, -1015, -2010].includes(error.code)) return { outcome: 'REJECTED', reason: error.message }
    return { outcome: 'UNKNOWN', reason: error instanceof BinanceError ? error.message : 'BINANCE_SUBMISSION_UNKNOWN' }
  }
  async submit(symbol: string, intent: Intent): Promise<Submission> {
    if (intent.type !== 'MARKET' || !((intent.purpose === 'ENTRY' && intent.side === 'BUY') || (intent.purpose === 'CLOSE' && intent.side === 'SELL'))) return { outcome: 'REJECTED', reason: 'BINANCE_MARKET_ENTRY_OR_CLOSE_ONLY' }
    let params: Record<string, string>
    try { params = { symbol: symbolName(symbol), side: intent.side, type: 'MARKET', quantity: decimal(intent.quantity), newClientOrderId: clientId(intent.clientId), newOrderRespType: 'ACK' } }
    catch { return { outcome: 'REJECTED', reason: 'BINANCE_INVALID_ORDER' } }
    try {
      const result = object(await this.request('/api/v3/order', params, 'POST', true))
      if (result.symbol !== params.symbol || result.clientOrderId !== intent.clientId) throw new BinanceError(null, 0, 'BINANCE_ORDER_MISMATCH')
      return { outcome: 'ACCEPTED', orderId: id(result.orderId) }
    } catch (error) { return this.submissionError(error) }
  }
  async cancel(symbol: string, intent: Intent): Promise<void> {
    // Canceling an OCO leg cancels its entire list. The engine must query both
    // legs afterwards; HTTP success is not proof that no fill raced the cancel.
    const name = symbolName(symbol)
    const result = object(await this.request('/api/v3/order', { symbol: name, origClientOrderId: clientId(intent.clientId), ...(intent.orderId ? { orderId: id(intent.orderId) } : {}) }, 'DELETE', true))
    if (result.symbol !== name || (result.origClientOrderId ?? result.clientOrderId) !== intent.clientId) throw new BinanceError(null, 0, 'BINANCE_CANCEL_ACK_UNKNOWN')
    id(result.orderId)
  }
  async protect(symbol: string, stop: Intent, target: Intent, listClientId: string): Promise<Submission> {
    if (stop.purpose !== 'STOP' || target.purpose !== 'TARGET' || stop.side !== 'SELL' || target.side !== 'SELL' || stop.type !== 'STOP' || target.type !== 'LIMIT' || stop.quantity !== target.quantity) return { outcome: 'REJECTED', reason: 'BINANCE_INVALID_OCO' }
    let params: Record<string, string>
    try {
      const rules = await this.rules(symbol, true), stopPrice = stop.trigger ?? stop.price ?? 0, targetPrice = target.price ?? 0
      if (stopPrice >= targetPrice || !aligned(stop.quantity, rules.step) || stop.quantity < rules.minQuantity || stop.quantity > rules.maxQuantity || !aligned(stopPrice, rules.tick) || !aligned(targetPrice, rules.tick)) throw new Error('INVALID_OCO')
      for (const price of [stopPrice, targetPrice]) if ((rules.minPrice && price < rules.minPrice) || (rules.maxPrice && price > rules.maxPrice) || price * stop.quantity < rules.minNotional || (rules.maxNotional && price * stop.quantity > rules.maxNotional)) throw new Error('INVALID_OCO')
      const list = clientId(listClientId), below = clientId(stop.clientId), above = clientId(target.clientId)
      if (new Set([list, below, above]).size !== 3) throw new Error('INVALID_OCO')
      params = { symbol: rules.symbol, side: 'SELL', quantity: decimal(stop.quantity), listClientOrderId: list, aboveType: 'LIMIT_MAKER', aboveClientOrderId: above, abovePrice: decimal(targetPrice), belowType: 'STOP_LOSS', belowClientOrderId: below, belowStopPrice: decimal(stopPrice), newOrderRespType: 'ACK' }
    } catch (error) {
      if (error instanceof BinanceError && (error.code !== null || error.message === 'BINANCE_UNAVAILABLE')) return this.submissionError(error)
      return { outcome: 'REJECTED', reason: 'BINANCE_INVALID_OCO' }
    }
    try {
      const result = object(await this.request('/api/v3/orderList/oco', params, 'POST', true))
      if (result.listClientOrderId !== listClientId || !Array.isArray(result.orders)) throw new BinanceError(null, 0, 'BINANCE_INVALID_OCO_ACK')
      const orders = result.orders.map(object)
      if (orders.length !== 2 || ![stop.clientId, target.clientId].every(client => orders.some(order => order.clientOrderId === client && order.symbol === params.symbol))) throw new BinanceError(null, 0, 'BINANCE_INVALID_OCO_ACK')
      id(result.orderListId); orders.forEach(order => id(order.orderId))
      // List IDs and child order IDs are different identities; lookup persists each leg.
      return { outcome: 'ACCEPTED' }
    } catch (error) { return this.submissionError(error) }
  }
}
