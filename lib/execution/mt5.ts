import { roundStep, type Environment, type ExecutionBroker, type Instrument, type Intent, type OrderSnapshot, type Submission } from './model'
import type { ExecutionDB } from './service'

/** MetaTrader 5 through the AutotradeX Bridge EA.
 * The engine works in base units (lots x contract size) and quote currency, like the spot venues.
 * Stop loss and take profit are position attributes in MT5, so the engine's native-OCO pair maps to
 * one PROTECT command, and exits are attributed from the position's deal history by deal reason.
 */
export type Mt5Bridge = { trade_mode: 'DEMO' | 'CONTEST' | 'REAL' | null; currency: string | null; equity: number | null; margin_free: number | null
  trade_allowed: boolean; connected: boolean; heartbeat_at: string | null; untracked_positions: number }
export type Mt5Symbol = { request: string; resolved: string | null; base: string | null; quote: string | null; tick_size: number | null; tick_value: number | null
  contract_size: number | null; volume_min: number | null; volume_max: number | null; volume_step: number | null; bid: number | null; ask: number | null
  margin_per_lot: number | null; trade_mode: number | null; updated_at: string }
export type Mt5Kind = 'ENTRY' | 'PROTECT' | 'UNPROTECT' | 'CLOSE'
export type Mt5Command = { client_id: string; kind: Mt5Kind; entry_client_id: string; status: 'PENDING' | 'SENT' | 'DONE' | 'FAILED'
  retcode: number | null; message: string | null; order_ticket: number | null; position_id: number | null }
export type Mt5NewCommand = { client_id: string; kind: Mt5Kind; entry_client_id: string; request: string; side?: 'BUY' | 'SELL'; volume?: number; sl?: number; tp?: number }
export type Mt5Deal = { ticket: number; order: number; entry: 'IN' | 'OUT' | 'INOUT' | 'OUT_BY'; reason: string; volume: number; price: number
  commission: number; swap: number; fee: number; profit: number; time: number }
export type Mt5Position = { position_id: number; open: boolean; deals: Mt5Deal[] }
export interface Mt5Store {
  bridge(): Promise<Mt5Bridge | null>
  symbol(request: string): Promise<Mt5Symbol | null>
  commands(entryClientId: string): Promise<Mt5Command[]>
  enqueue(command: Mt5NewCommand): Promise<void>
  position(positionId: number): Promise<Mt5Position | null>
}

const FRESH_MS = 10000
const SYMBOL_TRADE_MODE_FULL = 4
const units = (n: number) => Math.round(n * 1e8) / 1e8
/** TradingView symbol (OANDA:EURUSD) to the bridge request name (EURUSD); the EA resolves broker suffixes. */
export const mt5Request = (symbol: string) => symbol.slice(symbol.indexOf(':') + 1)
// Engine client IDs are e<14 id chars><purpose><3 digits>; every intent of an execution shares the prefix.
const related = (clientId: string, purpose: 'E' | 'L' | 'U') => `${clientId.slice(0, 15)}${purpose}000`

export class Mt5ExecutionBroker implements ExecutionBroker {
  readonly venue = 'mt5' as const
  readonly positionProtection = true
  readonly nativeOco = true
  readonly longOnly = false
  constructor(private readonly store: Mt5Store, readonly environment: Environment, private readonly waitMs = 10000, private readonly pollMs = 250) {}

  private async bridge() {
    const bridge = await this.store.bridge()
    const beat = Date.parse(bridge?.heartbeat_at ?? '')
    if (!bridge || !Number.isFinite(beat) || Date.now() - beat > FRESH_MS) throw new Error('MT5_BRIDGE_OFFLINE')
    return bridge
  }
  private async spec(symbol: string) {
    const s = await this.store.symbol(mt5Request(symbol))
    if (!s?.resolved) throw new Error('MT5_SYMBOL_UNAVAILABLE')
    if (Date.now() - Date.parse(s.updated_at) > FRESH_MS) throw new Error('MT5_SYMBOL_STALE')
    if (!(s.bid! > 0 && s.ask! > 0 && s.tick_size! > 0 && s.tick_value! > 0 && s.contract_size! > 0 && s.volume_step! > 0 && s.volume_min! > 0 && s.volume_max! > 0 && s.base && s.quote)) throw new Error('MT5_SYMBOL_UNAVAILABLE')
    if (s.trade_mode !== SYMBOL_TRADE_MODE_FULL) throw new Error('MT5_SYMBOL_TRADING_RESTRICTED')
    return s as Mt5Symbol & { [K in 'bid' | 'ask' | 'tick_size' | 'tick_value' | 'contract_size' | 'volume_step' | 'volume_min' | 'volume_max']: number } & { base: string; quote: string }
  }
  /** Account-currency value of one quote-currency unit, from the broker's own tick value. */
  private async quotePerAccount(symbol: string) {
    const s = await this.spec(symbol)
    return (s.tick_size * s.contract_size) / s.tick_value
  }

  async connect() {
    const bridge = await this.bridge()
    if (!bridge.connected) throw new Error('MT5_TERMINAL_DISCONNECTED')
    if (!bridge.trade_allowed) throw new Error('MT5_ALGO_TRADING_DISABLED')
    if (!bridge.trade_mode || (bridge.trade_mode === 'REAL') !== (this.environment === 'live')) throw new Error('MT5_ENVIRONMENT_MISMATCH')
    if (bridge.untracked_positions > 0) throw new Error('MT5_UNTRACKED_POSITIONS')
  }
  async instrument(symbol: string): Promise<Instrument> {
    const s = await this.spec(symbol)
    return { symbol, base: s.base, quote: s.quote, price: (s.bid + s.ask) / 2, tick: s.tick_size,
      step: units(s.volume_step * s.contract_size), minQuantity: units(s.volume_min * s.contract_size), maxQuantity: units(s.volume_max * s.contract_size), minNotional: 0 }
  }
  /** Position-value capacity in quote currency: 90% of free margin at the broker's per-lot margin. */
  async availableQuote(symbol: string) {
    const [bridge, s] = await Promise.all([this.bridge(), this.spec(symbol)])
    if (!(s.margin_per_lot! > 0) || !(bridge.margin_free! > 0)) return 0
    return (bridge.margin_free! * 0.9 / s.margin_per_lot!) * s.contract_size * (s.bid + s.ask) / 2
  }
  /** Risk and the daily-loss lock use equity, converted to the instrument's quote currency. */
  async riskCapital(symbol: string) {
    const bridge = await this.bridge()
    return Math.max(0, bridge.equity ?? 0) * await this.quotePerAccount(symbol)
  }
  async availableBase() { return 0 } // Only long-only spot venues sell owned inventory.

  private async lots(symbol: string, quantity: number) {
    const s = await this.spec(symbol)
    return roundStep(units(quantity / s.contract_size), s.volume_step)
  }
  private async result(entryClientId: string, clientId: string): Promise<Submission> {
    for (let waited = 0; ; waited += this.pollMs) {
      const command = (await this.store.commands(entryClientId)).find(c => c.client_id === clientId)
      if (command?.status === 'DONE') return { outcome: 'ACCEPTED', orderId: String(command.position_id ?? command.order_ticket ?? clientId) }
      if (command?.status === 'FAILED') return { outcome: 'REJECTED', reason: `MT5_${command.retcode ?? 'FAILED'}:${(command.message ?? '').replace(/[^A-Z0-9_ -]/gi, '').slice(0, 80)}` }
      if (waited >= this.waitMs) return { outcome: 'UNKNOWN', reason: 'MT5_RESULT_PENDING' }
      await new Promise(resolve => setTimeout(resolve, this.pollMs))
    }
  }
  async submit(symbol: string, intent: Intent): Promise<Submission> {
    if (intent.type !== 'MARKET' || !['ENTRY', 'CLOSE'].includes(intent.purpose)) throw new Error('MT5_UNSUPPORTED_ORDER')
    if (intent.purpose === 'ENTRY' && (!(intent.stopLoss! > 0) || !(intent.takeProfit! > 0))) throw new Error('MT5_ENTRY_PROTECTION_REQUIRED')
    const entry = intent.purpose === 'ENTRY' ? intent.clientId : related(intent.clientId, 'E')
    await this.store.enqueue({ client_id: intent.clientId, kind: intent.purpose as 'ENTRY' | 'CLOSE', entry_client_id: entry, request: mt5Request(symbol), side: intent.side, volume: await this.lots(symbol, intent.quantity), ...(intent.purpose === 'ENTRY' ? { sl: intent.stopLoss, tp: intent.takeProfit } : {}) })
    return this.result(entry, intent.clientId)
  }
  async protect(symbol: string, stop: Intent, target: Intent, listClientId: string): Promise<Submission> {
    const entry = related(listClientId, 'E')
    await this.store.enqueue({ client_id: listClientId, kind: 'PROTECT', entry_client_id: entry, request: mt5Request(symbol), sl: stop.trigger, tp: target.price })
    return this.result(entry, listClientId)
  }
  async cancel(symbol: string, intent: Intent) {
    // MT5 protection belongs to the position. Never strip it before closing.
    if (intent.purpose === 'STOP' || intent.purpose === 'TARGET') throw new Error('MT5_PROTECTION_CANNOT_BE_REMOVED')
  }

  async lookup(symbol: string, intent: Intent): Promise<OrderSnapshot | null> {
    const bridge = await this.bridge()
    const s = await this.spec(symbol)
    const entryId = intent.purpose === 'ENTRY' ? intent.clientId : related(intent.clientId, 'E')
    const commands = await this.store.commands(entryId)
    const find = (clientId: string) => commands.find(c => c.client_id === clientId)
    const ownId = intent.purpose === 'STOP' || intent.purpose === 'TARGET' ? related(intent.clientId, 'L') : intent.clientId
    const own = find(ownId)
    const snapshot = (state: OrderSnapshot['state'], deals: Mt5Deal[], orderId: string): OrderSnapshot => {
      const lots = deals.reduce((n, d) => n + d.volume, 0)
      const filled = units(lots * s.contract_size)
      const averagePrice = lots ? deals.reduce((n, d) => n + d.price * d.volume, 0) / lots : 0
      // MT5 reports commission, swap and fees in account currency, negative when charged.
      const cost = -deals.reduce((n, d) => n + d.commission + d.swap + d.fee, 0)
      const sameCurrency = bridge.currency === s.quote
      return { orderId, clientId: intent.clientId, state, quantity: intent.quantity, filled, averagePrice, quoteAmount: filled * averagePrice,
        baseFee: 0, quoteFee: sameCurrency ? cost : 0, otherFees: !sameCurrency && cost ? { [bridge.currency ?? 'ACCOUNT']: cost } : {} }
    }
    // The command row is written before any bridge delivery; without it nothing reached MT5.
    if (!own) return snapshot('REJECTED', [], intent.clientId)
    if (own.status === 'PENDING' || own.status === 'SENT') return null
    if (own.status === 'FAILED') return snapshot('REJECTED', [], String(own.order_ticket ?? intent.clientId))
    const entry = find(entryId)
    if (!entry?.position_id) return null
    const position = await this.store.position(entry.position_id)
    if (!position) return null
    const outs = position.deals.filter(d => d.entry === 'OUT' || d.entry === 'OUT_BY' || d.entry === 'INOUT')
    if (intent.purpose === 'ENTRY') {
      const ins = position.deals.filter(d => d.entry === 'IN')
      return ins.length ? snapshot('FILLED', ins, String(position.position_id)) : null
    }
    if (intent.purpose === 'STOP' || intent.purpose === 'TARGET') {
      const mine = outs.filter(d => d.reason === (intent.purpose === 'STOP' ? 'SL' : 'TP'))
      if (mine.length) return snapshot('FILLED', mine, String(position.position_id))
      const withdrawn = find(related(intent.clientId, 'U'))?.status === 'DONE'
      return snapshot(!position.open || withdrawn || outs.length ? 'CANCELED' : 'NEW', [], String(position.position_id))
    }
    // CLOSE: our deal by order ticket, or, if MT5 had already closed the position some other way
    // (manual, stop-out), the closing deals not attributed to protection or another close.
    let deals = outs.filter(d => d.order === own.order_ticket)
    if (own.message === 'ALREADY_CLOSED') {
      const claimed = new Set(commands.filter(c => c.kind === 'CLOSE' && c.client_id !== own.client_id && c.order_ticket).map(c => c.order_ticket))
      deals = outs.filter(d => d.reason !== 'SL' && d.reason !== 'TP' && !claimed.has(d.order))
      return snapshot(deals.length ? 'FILLED' : 'CANCELED', deals, String(position.position_id))
    }
    return deals.length ? snapshot('FILLED', deals, String(own.order_ticket ?? position.position_id)) : null
  }
}

export function mt5Store(db: ExecutionDB, accountId: string): Mt5Store {
  const num = (v: unknown) => v === null || v === undefined ? null : Number(v)
  return {
    async bridge() {
      const r = await db.from('mt5_bridges').select('trade_mode,currency,equity,margin_free,trade_allowed,connected,heartbeat_at,untracked_positions').eq('account_id', accountId).maybeSingle()
      if (r.error) throw new Error('MT5_BRIDGE_READ_FAILED')
      return r.data ? { ...r.data, equity: num(r.data.equity), margin_free: num(r.data.margin_free) } as Mt5Bridge : null
    },
    async symbol(request) {
      const r = await db.from('mt5_symbols').select('*').eq('account_id', accountId).eq('request', request).maybeSingle()
      if (r.error) throw new Error('MT5_SYMBOL_READ_FAILED')
      if (!r.data) {
        // Register the request; the bridge reports its specification on the next poll.
        await db.from('mt5_symbols').upsert({ account_id: accountId, request }, { onConflict: 'account_id,request', ignoreDuplicates: true })
        return null
      }
      const d = r.data
      return { request: d.request, resolved: d.resolved, base: d.base, quote: d.quote, tick_size: num(d.tick_size), tick_value: num(d.tick_value), contract_size: num(d.contract_size),
        volume_min: num(d.volume_min), volume_max: num(d.volume_max), volume_step: num(d.volume_step), bid: num(d.bid), ask: num(d.ask),
        margin_per_lot: num(d.margin_per_lot), trade_mode: num(d.trade_mode), updated_at: d.updated_at }
    },
    async commands(entryClientId) {
      const r = await db.from('mt5_commands').select('client_id,kind,entry_client_id,status,retcode,message,order_ticket,position_id').eq('account_id', accountId).eq('entry_client_id', entryClientId)
      if (r.error) throw new Error('MT5_COMMAND_READ_FAILED')
      return r.data.map(c => ({ ...c, order_ticket: num(c.order_ticket), position_id: num(c.position_id) })) as Mt5Command[]
    },
    async enqueue(command) {
      // Idempotent by (account, client_id): a retried pass never queues a second order.
      const r = await db.from('mt5_commands').upsert({ account_id: accountId, ...command }, { onConflict: 'account_id,client_id', ignoreDuplicates: true })
      if (r.error) throw new Error('MT5_COMMAND_QUEUE_FAILED')
    },
    async position(positionId) {
      const r = await db.from('mt5_positions').select('position_id,open,deals').eq('account_id', accountId).eq('position_id', positionId).maybeSingle()
      if (r.error) throw new Error('MT5_POSITION_READ_FAILED')
      return r.data ? { position_id: Number(r.data.position_id), open: r.data.open, deals: r.data.deals as Mt5Deal[] } : null
    },
  }
}
