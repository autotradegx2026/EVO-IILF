import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { TOTP } from 'otpauth'
import type { ExecutionBroker, Instrument, Intent, OrderSnapshot, OrderState, Submission } from './model'

const API = 'https://apiconnect.angelone.in'
const MASTER = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json'
const PATH = '/rest/secure/angelbroking'
const ORDER_BOOK = `${PATH}/order/v1/getOrderBook`
type RecordValue = Record<string, unknown>
type Reply = { status?: boolean; data?: unknown; errorcode?: string }
export type AngelExecutionCredentials = { apiKey: string; password: string; totpSecret: string; clientCode: string; localIp: string; publicIp: string }
type CashInstrument = { exchange: 'NSE' | 'BSE'; tradingSymbol: string; token: string; tick: number; lot: number; max: number }

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ANGEL_INVALID_RESPONSE')
  return value as RecordValue
}
function number(value: unknown, positive = false): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') throw new Error('ANGEL_INVALID_NUMBER')
  const result = Number(value)
  if (!Number.isFinite(result) || (positive ? result <= 0 : result < 0)) throw new Error('ANGEL_INVALID_NUMBER')
  return result
}
function integer(value: unknown, positive = false): number {
  const result = number(value, positive)
  if (!Number.isSafeInteger(result)) throw new Error('ANGEL_INVALID_QUANTITY')
  return result
}
function cashSymbol(symbol: string): { exchange: 'NSE' | 'BSE'; tradingSymbol: string } {
  const match = /^(NSE|BSE):([A-Z0-9&.-]+-EQ)$/.exec(symbol)
  if (!match) throw new Error('ANGEL_UNSUPPORTED_CASH_SYMBOL')
  return { exchange: match[1] as 'NSE' | 'BSE', tradingSymbol: match[2] }
}
function tag(clientId: string): string {
  if (!clientId) throw new Error('ANGEL_CLIENT_ID_REQUIRED')
  return `e${createHash('sha256').update(clientId).digest('hex').slice(0, 18)}`
}
function type(intent: Intent): string {
  return intent.type === 'STOP' ? 'STOPLOSS_MARKET' : intent.type
}
function state(value: unknown, filled: number, quantity: number): OrderState {
  switch (String(value).trim().toLowerCase()) {
    case 'complete':
      if (filled !== quantity) throw new Error('ANGEL_INCONSISTENT_FILL')
      return 'FILLED'
    case 'cancelled': case 'canceled': return 'CANCELED'
    case 'rejected': return 'REJECTED'
    case 'expired': return 'EXPIRED'
    case 'open': case 'pending': case 'open pending': case 'trigger pending':
    case 'validation pending': case 'put order req received': case 'modify pending':
    case 'cancel pending': case 'after market order req received':
      return filled > 0 ? 'PARTIAL' : 'NEW'
    default: return 'UNKNOWN'
  }
}

/** Live cash INTRADAY adapter. No sandbox or automatic retry of order mutations. */
export class AngelExecutionBroker implements ExecutionBroker {
  readonly venue = 'angelone' as const
  readonly environment = 'live' as const
  readonly nativeOco = false
  readonly longOnly = false
  private token: string | null = null
  private connecting: Promise<void> | null = null
  private master: { at: number; rows: unknown[] } | null = null
  private book: { at: number; rows: RecordValue[] } | null = null
  private bookPending: Promise<void> | null = null
  private bookGeneration = 0
  private nextBookRequestAt = 0

  constructor(private readonly credentials: AngelExecutionCredentials, private readonly fetcher: typeof fetch = fetch) {}

  private headers(authenticated: boolean): Record<string, string> {
    const c = this.credentials
    if (!c.apiKey || !c.password || !c.totpSecret || !c.clientCode || isIP(c.localIp) !== 4 || isIP(c.publicIp) !== 4) throw new Error('ANGEL_CONFIGURATION_REQUIRED')
    return { 'Content-Type': 'application/json', Accept: 'application/json', 'X-PrivateKey': c.apiKey,
      'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': c.localIp, 'X-ClientPublicIP': c.publicIp,
      // Cloud processes do not expose a stable adapter MAC. This header is metadata,
      // never a substitute for broker-registered static network egress.
      'X-MACAddress': '00:00:00:00:00:00', ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}) }
  }

  async connect(): Promise<void> {
    if (this.token) return
    if (this.connecting) return this.connecting
    this.connecting = (async () => {
      try {
        const response = await this.fetcher(`${API}/rest/auth/angelbroking/user/v1/loginByPassword`, {
          method: 'POST', headers: this.headers(false), cache: 'no-store', signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ clientcode: this.credentials.clientCode, password: this.credentials.password,
            totp: new TOTP({ secret: this.credentials.totpSecret }).generate() }),
        })
        const reply = record(await response.json())
        const data = record(reply.data)
        if (!response.ok || reply.status !== true || typeof data.jwtToken !== 'string' || !data.jwtToken) throw new Error('AUTH')
        this.token = data.jwtToken
      } catch { throw new Error('ANGEL_AUTHENTICATION_FAILED') }
    })()
    try { await this.connecting } finally { this.connecting = null }
  }

  private async request(path: string, body?: RecordValue): Promise<{ http: number; reply: Reply }> {
    if (path === ORDER_BOOK) {
      // Apply this at the transport boundary, including safe-read auth retries.
      // Invalidating the cache must never reset the broker's 1/sec budget.
      while (Date.now() < this.nextBookRequestAt) {
        await new Promise(resolve => setTimeout(resolve, this.nextBookRequestAt - Date.now()))
      }
      this.nextBookRequestAt = Date.now() + 1000
    }
    try {
      const response = await this.fetcher(`${API}${path}`, { method: body ? 'POST' : 'GET', headers: this.headers(true),
        ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(8000) })
      return { http: response.status, reply: record(await response.json()) as Reply }
    } finally {
      // Start the next budget after this request completes, even on transport failure.
      if (path === ORDER_BOOK) this.nextBookRequestAt = Date.now() + 1000
    }
  }

  private async read(path: string, body?: RecordValue): Promise<unknown> {
    try {
      await this.connect()
      let result = await this.request(path, body)
      if (result.http === 401 || ['AG8001', 'AG8002', 'AG8003', 'AB1010', 'AB1011'].includes(result.reply.errorcode ?? '')) {
        this.token = null
        await this.connect()
        result = await this.request(path, body)
      }
      if (result.http < 200 || result.http >= 300 || result.reply.status !== true) throw new Error('READ')
      return result.reply.data
    } catch { throw new Error('ANGEL_READ_UNAVAILABLE') }
  }

  private invalidateBook(): void {
    this.book = null
    this.bookGeneration++
  }

  private async orderBook(): Promise<RecordValue[]> {
    // Coalesce concurrent lookups and discard a read that overlaps a mutation.
    // A short OPEN snapshot can delay progress; it cannot confirm cancellation.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.book && Date.now() - this.book.at < 1000) return this.book.rows
      if (!this.bookPending) {
        const generation = this.bookGeneration
        this.bookPending = (async () => {
          const data = await this.read(ORDER_BOOK)
          if (!Array.isArray(data)) throw new Error('ANGEL_INVALID_ORDER_BOOK')
          const rows = data.map(record)
          if (generation === this.bookGeneration) this.book = { at: Date.now(), rows }
        })().finally(() => { this.bookPending = null })
      }
      await this.bookPending
    }
    if (this.book && Date.now() - this.book.at < 1000) return this.book.rows
    throw new Error('ANGEL_ORDER_BOOK_CHANGED_DURING_READ')
  }

  private async cashInstrument(symbol: string): Promise<CashInstrument> {
    const parsed = cashSymbol(symbol)
    if (!this.master || Date.now() - this.master.at > 300_000) {
      try {
        // Do not forward API credentials to the public instrument host.
        const response = await this.fetcher(MASTER, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        const data: unknown = await response.json()
        if (!response.ok || !Array.isArray(data)) throw new Error('MASTER')
        this.master = { at: Date.now(), rows: data }
      } catch { throw new Error('ANGEL_INSTRUMENTS_UNAVAILABLE') }
    }
    const matches = this.master.rows.filter(value => {
      if (!value || typeof value !== 'object') return false
      const row = value as RecordValue
      return row.symbol === parsed.tradingSymbol && String(row.exch_seg).toUpperCase() === parsed.exchange
    })
    if (matches.length !== 1) throw new Error('ANGEL_INSTRUMENT_NOT_UNIQUE')
    const row = record(matches[0])
    if (typeof row.token !== 'string' || !/^\d+$/.test(row.token) || Number(row.token) <= 0) throw new Error('ANGEL_INVALID_TOKEN')
    const tick = number(row.tick_size, true) / 100, lot = integer(row.lotsize, true)
    const freeze = row.freeze_qty == null || row.freeze_qty === '' ? 0 : integer(row.freeze_qty)
    return { ...parsed, token: row.token, tick, lot, max: freeze || Number.MAX_SAFE_INTEGER }
  }

  async instrument(symbol: string): Promise<Instrument> {
    const cash = await this.cashInstrument(symbol)
    const data = record(await this.read(`${PATH}/order/v1/getLtpData`, {
      exchange: cash.exchange, tradingsymbol: cash.tradingSymbol, symboltoken: cash.token,
    }))
    if (data.exchange !== cash.exchange || data.tradingsymbol !== cash.tradingSymbol || String(data.symboltoken) !== cash.token) throw new Error('ANGEL_QUOTE_MISMATCH')
    return { symbol, base: cash.tradingSymbol, quote: 'INR', price: number(data.ltp, true), tick: cash.tick,
      step: cash.lot, minQuantity: cash.lot, maxQuantity: cash.max, minNotional: 0 }
  }

  async availableQuote(symbol: string): Promise<number> {
    cashSymbol(symbol)
    return number(record(await this.read(`${PATH}/user/v1/getRMS`)).availablecash)
  }

  async availableBase(symbol: string): Promise<number> {
    const { exchange, tradingSymbol } = cashSymbol(symbol)
    const data = await this.read(`${PATH}/order/v1/getPosition`)
    if (data === null) return 0
    if (!Array.isArray(data)) throw new Error('ANGEL_INVALID_POSITIONS')
    const matches = data.map(record).filter(row => row.exchange === exchange && row.tradingsymbol === tradingSymbol && row.producttype === 'INTRADAY')
    if (matches.length > 1) throw new Error('ANGEL_AMBIGUOUS_POSITION')
    if (!matches.length) return 0
    const raw = matches[0].netqty
    if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '' || !Number.isSafeInteger(Number(raw))) throw new Error('ANGEL_INVALID_POSITION')
    return Math.max(0, Number(raw))
  }

  async lookup(symbol: string, intent: Intent): Promise<OrderSnapshot | null> {
    const { exchange, tradingSymbol } = cashSymbol(symbol)
    const clientTag = tag(intent.clientId)
    const data = await this.orderBook()
    const matches = data.filter(row => intent.orderId ? row.orderid === intent.orderId : row.ordertag === clientTag)
    if (!matches.length) return null
    if (matches.length !== 1) throw new Error('ANGEL_AMBIGUOUS_ORDER')
    const row = matches[0]
    const quantity = integer(row.quantity, true), filled = integer(row.filledshares), remaining = integer(row.unfilledshares)
    // SmartAPI documents conversion of MARKET requests into MPP limit orders.
    // Retain exact tag, instrument, side, product and quantity checks in that case.
    const typeMatches = row.ordertype === type(intent) || (intent.type === 'MARKET' && row.ordertype === 'LIMIT')
    if (row.ordertag !== clientTag || row.exchange !== exchange || row.tradingsymbol !== tradingSymbol || row.transactiontype !== intent.side ||
      !typeMatches || row.producttype !== 'INTRADAY' || quantity !== intent.quantity || filled > quantity || remaining > quantity || filled + remaining > quantity ||
      typeof row.orderid !== 'string' || !row.orderid) throw new Error('ANGEL_ORDER_MISMATCH')
    if ((intent.type === 'LIMIT' && number(row.price, true) !== intent.price) ||
      (intent.type === 'STOP' && number(row.triggerprice, true) !== intent.trigger)) throw new Error('ANGEL_ORDER_LEVEL_MISMATCH')
    const averagePrice = number(row.averageprice, filled > 0)
    const status = state(row.orderstatus || row.status, filled, quantity)
    return { orderId: row.orderid, clientId: intent.clientId, state: status, quantity, filled,
      averagePrice, quoteAmount: filled * averagePrice, baseFee: 0, quoteFee: 0, otherFees: {} }
  }

  async submit(symbol: string, intent: Intent): Promise<Submission> {
    let body: RecordValue
    try {
      if (!['BUY', 'SELL'].includes(intent.side) || !['MARKET', 'LIMIT', 'STOP'].includes(intent.type)) throw new Error('INVALID_INTENT')
      const cash = await this.cashInstrument(symbol)
      const quantity = integer(intent.quantity, true)
      if (quantity % cash.lot !== 0 || quantity > cash.max) throw new Error('QUANTITY_LIMIT')
      const aligned = (value: unknown) => {
        const price = number(value, true), units = price / cash.tick
        if (Math.abs(units - Math.round(units)) > 0.0000001) throw new Error('TICK')
        return price
      }
      body = { variety: intent.type === 'STOP' ? 'STOPLOSS' : 'NORMAL', tradingsymbol: cash.tradingSymbol,
        symboltoken: cash.token, transactiontype: intent.side, exchange: cash.exchange, ordertype: type(intent),
        producttype: 'INTRADAY', duration: 'DAY', quantity: String(quantity), ordertag: tag(intent.clientId),
        price: String(intent.type === 'LIMIT' ? aligned(intent.price) : 0), triggerprice: String(intent.type === 'STOP' ? aligned(intent.trigger) : 0),
        squareoff: '0', stoploss: '0' }
      await this.connect()
    } catch { return { outcome: 'REJECTED', reason: 'ANGEL_PREFLIGHT_FAILED' } }
    this.invalidateBook()
    try {
      const result = await this.request(`${PATH}/order/v1/placeOrder`, body)
      if (result.http >= 200 && result.http < 300 && result.reply.status === true) {
        const data = record(result.reply.data)
        if (typeof data.orderid === 'string' && data.orderid) return { outcome: 'ACCEPTED', orderId: data.orderid }
      }
      // Explicit validation rejections are definitive. Internal/transport/auth
      // failures remain uncertain and require a lookup, never another write.
      if (result.reply.status === false && ['AB1008', 'AB1009', 'AB1012', 'AB1018', 'AB2002', 'AB4008'].includes(result.reply.errorcode ?? '')) return { outcome: 'REJECTED', reason: 'ANGEL_ORDER_REJECTED' }
    } catch { /* Ambiguous network outcome; credentials and broker payloads stay private. */ }
    finally { this.invalidateBook() }
    return { outcome: 'UNKNOWN', reason: 'ANGEL_SUBMISSION_UNCERTAIN' }
  }

  async cancel(symbol: string, intent: Intent): Promise<void> {
    cashSymbol(symbol)
    if (!intent.orderId) throw new Error('ANGEL_ORDER_ID_REQUIRED')
    this.invalidateBook()
    try {
      await this.connect()
      const result = await this.request(`${PATH}/order/v1/cancelOrder`, { variety: intent.type === 'STOP' ? 'STOPLOSS' : 'NORMAL', orderid: intent.orderId })
      if (result.http < 200 || result.http >= 300 || result.reply.status !== true) throw new Error('CANCEL')
    } catch { throw new Error('ANGEL_CANCEL_UNCERTAIN') }
    finally { this.invalidateBook() }
    // Acknowledgment only. Caller must query final status and additional fills.
  }
}
