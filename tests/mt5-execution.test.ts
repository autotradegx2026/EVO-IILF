import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceExecution, type ExecutionControls, type ExecutionStore } from '../lib/execution/engine'
import { Mt5ExecutionBroker, mt5Request, type Mt5Bridge, type Mt5Command, type Mt5Deal, type Mt5NewCommand, type Mt5Position, type Mt5Store, type Mt5Symbol } from '../lib/execution/mt5'
import type { Execution } from '../lib/execution/model'

const controls: ExecutionControls = { entriesAllowed: true, maxPriceDriftBps: 100 }

/** In-memory MT5 terminal + bridge: commands execute as the EA would, unless `offline`. */
class FakeMt5 implements Mt5Store {
  heartbeat = true
  autoProcess = true
  tradeMode: Mt5Bridge['trade_mode'] = 'DEMO'
  rejectEntry: { retcode: number; message: string } | null = null
  bid = 1.1000; ask = 1.1002
  queued: (Mt5NewCommand & Mt5Command)[] = []
  positions = new Map<number, Mt5Position & { side: 'BUY' | 'SELL'; volume: number; sl: number; tp: number }>()
  private ticket = 1000
  async bridge(): Promise<Mt5Bridge | null> {
    return { trade_mode: this.tradeMode, currency: 'USD', equity: 10000, margin_free: 9000, trade_allowed: true, connected: true,
      heartbeat_at: this.heartbeat ? new Date().toISOString() : new Date(Date.now() - 60000).toISOString(), untracked_positions: 0 }
  }
  async symbol(request: string): Promise<Mt5Symbol | null> {
    if (request !== 'EURUSD') return null
    return { request, resolved: 'EURUSD.std', base: 'EUR', quote: 'USD', tick_size: 0.00001, tick_value: 1, contract_size: 100000,
      volume_min: 0.01, volume_max: 100, volume_step: 0.01, bid: this.bid, ask: this.ask, margin_per_lot: 1100, trade_mode: 4, updated_at: new Date().toISOString() }
  }
  async commands(entry: string) { return this.queued.filter(c => c.entry_client_id === entry) }
  async position(id: number) { return this.positions.get(id) ?? null }
  async enqueue(command: Mt5NewCommand) {
    if (this.queued.some(c => c.client_id === command.client_id)) return
    const row = { ...command, status: 'PENDING' as const, retcode: null, message: null, order_ticket: null, position_id: null }
    this.queued.push(row)
    if (this.autoProcess) this.process(row)
  }
  deal(entry: Mt5Deal['entry'], reason: string, volume: number, price: number, order: number): Mt5Deal {
    return { ticket: ++this.ticket, order, entry, reason, volume, price, commission: -3.5 * volume, swap: 0, fee: 0, profit: 0, time: 0 }
  }
  process(c: Mt5Command & Mt5NewCommand) {
    const done = (patch: Partial<Mt5Command>) => Object.assign(c, { status: 'DONE', retcode: 10009, ...patch })
    const entry = this.queued.find(q => q.client_id === c.entry_client_id)
    const position = entry?.position_id ? this.positions.get(entry.position_id) : undefined
    if (c.kind === 'ENTRY') {
      if (this.rejectEntry) return Object.assign(c, { status: 'FAILED', ...this.rejectEntry })
      const order = ++this.ticket, id = order
      this.positions.set(id, { position_id: id, open: true, side: c.side!, volume: c.volume!, sl: 0, tp: 0,
        deals: [this.deal('IN', 'EXPERT', c.volume!, c.side === 'BUY' ? this.ask : this.bid, order)] })
      return done({ order_ticket: order, position_id: id })
    }
    if (!position) return Object.assign(c, { status: 'FAILED', message: 'POSITION_NOT_FOUND' })
    if (c.kind === 'PROTECT') { position.sl = c.sl!; position.tp = c.tp!; return done({ position_id: position.position_id }) }
    if (c.kind === 'UNPROTECT') { position.sl = 0; position.tp = 0; return done({ position_id: position.position_id, message: position.open ? 'DONE' : 'POSITION_CLOSED' }) }
    if (!position.open) return done({ message: 'ALREADY_CLOSED', position_id: position.position_id })
    const order = ++this.ticket
    position.deals.push(this.deal('OUT', 'EXPERT', position.volume, position.side === 'BUY' ? this.bid : this.ask, order))
    position.open = false
    return done({ order_ticket: order, position_id: position.position_id })
  }
  /** The broker closes the position on its own (SL, TP, manual in the terminal, stop-out). */
  closeExternally(reason: 'SL' | 'TP' | 'CLIENT', price: number) {
    const position = [...this.positions.values()].find(p => p.open)!
    position.deals.push(this.deal('OUT', reason, position.volume, price, ++this.ticket))
    position.open = false
  }
}

class MemoryStore implements ExecutionStore {
  constructor(public value: Execution) {}
  async save(value: Execution) {
    if (value.version !== this.value.version) throw new Error('EXECUTION_VERSION_CHANGED')
    this.value = structuredClone({ ...value, version: value.version + 1 })
    return structuredClone(this.value)
  }
  async fence() {}
}

function execution(overrides: Partial<Execution> = {}): Execution {
  const now = Date.now()
  return { id: '84dc2928-4570-4673-8058-432e8a94b200', user_id: 'fixture-user', broker_account_id: 'fixture-mt5', signal_id: 'fixture-signal',
    environment: 'testnet', symbol: 'OANDA:EURUSD', direction: 'LONG', currency: 'USD', state: 'QUEUED',
    requested_quantity: 50000, signal_price: 1.1001, stop_loss: 1.0981, take_profit: 1.1061, rr: 3, risk_budget: 110,
    intents: [], entry_quantity: 0, exit_quantity: 0, entry_price: 0, exit_price: 0, gross_pnl: 0, quote_fees: 0, other_fees: {}, residual_quantity: 0,
    close_reason: null, error: null, closing_requested: false, session_end: '00:00', session_start: '00:00', session_timezone: 'Etc/UTC',
    deadline_at: new Date(now + 3600000).toISOString(), created_at: new Date(now - 1000).toISOString(), updated_at: new Date(now - 1000).toISOString(), version: 0, ...overrides }
}
const run = async (mt5: FakeMt5, store: MemoryStore) => { store.value = await advanceExecution(store.value, new Mt5ExecutionBroker(mt5, 'testnet', 50, 5), store, controls); return store.value }
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

test('MT5 symbol requests strip the TradingView exchange prefix', () => {
  assert.equal(mt5Request('OANDA:EURUSD'), 'EURUSD')
  assert.equal(mt5Request('EURUSD'), 'EURUSD')
})

test('long entry converts units to lots, attaches broker SL/TP and closes on stop loss', async () => {
  const mt5 = new FakeMt5(), store = new MemoryStore(execution())
  await run(mt5, store)          // entry
  assert.equal(mt5.queued[0].kind, 'ENTRY'); assert.equal(mt5.queued[0].volume, 0.5); assert.equal(mt5.queued[0].side, 'BUY')
  await run(mt5, store)          // protection
  assert.equal(mt5.queued[1].kind, 'PROTECT'); assert.equal(mt5.queued[1].sl, 1.0981)
  await run(mt5, store)
  assert.equal(store.value.state, 'OPEN')
  near(store.value.entry_quantity, 50000); near(store.value.entry_price, 1.1002)
  mt5.closeExternally('SL', 1.0981)
  await run(mt5, store)
  assert.equal(store.value.state, 'CLOSED'); assert.equal(store.value.close_reason, 'SL_HIT')
  near(store.value.gross_pnl, (1.0981 - 1.1002) * 50000)
  near(store.value.quote_fees, 3.5)  // 0.5 lot in + 0.5 lot out at 3.5 USD per lot each way
  assert.equal(store.value.residual_quantity, 0)
})

test('short entry is allowed and take profit is attributed to the target', async () => {
  const mt5 = new FakeMt5(), store = new MemoryStore(execution({ direction: 'SHORT', stop_loss: 1.1021, take_profit: 1.0941 }))
  await run(mt5, store); await run(mt5, store); await run(mt5, store)
  assert.equal(mt5.queued[0].side, 'SELL'); assert.equal(store.value.state, 'OPEN')
  mt5.closeExternally('TP', 1.0941)
  await run(mt5, store)
  assert.equal(store.value.state, 'CLOSED'); assert.equal(store.value.close_reason, 'TP_HIT')
  near(store.value.gross_pnl, (1.1000 - 1.0941) * 50000)
})

test('manual close withdraws protection, then closes with a market order', async () => {
  const mt5 = new FakeMt5(), store = new MemoryStore(execution())
  await run(mt5, store); await run(mt5, store); await run(mt5, store)
  store.value.closing_requested = true
  await run(mt5, store); await run(mt5, store)
  assert.deepEqual(mt5.queued.map(c => c.kind), ['ENTRY', 'PROTECT', 'UNPROTECT', 'CLOSE'])
  assert.equal(store.value.state, 'CLOSED'); assert.equal(store.value.close_reason, 'MANUAL')
  near(store.value.exit_quantity, 50000)
})

test('a position closed outside the platform is reconciled and accounted', async () => {
  const mt5 = new FakeMt5(), store = new MemoryStore(execution())
  await run(mt5, store); await run(mt5, store); await run(mt5, store)
  mt5.closeExternally('CLIENT', 1.1010)
  for (let i = 0; i < 4 && store.value.state !== 'CLOSED'; i++) await run(mt5, store)
  assert.equal(store.value.state, 'CLOSED')
  near(store.value.exit_price, 1.1010); near(store.value.exit_quantity, 50000)
  assert.equal(mt5.queued.filter(c => c.kind === 'CLOSE').length, 1)
  assert.equal(mt5.queued.find(c => c.kind === 'CLOSE')!.message, 'ALREADY_CLOSED')
})

test('a broker rejection rejects the execution without retrying', async () => {
  const mt5 = new FakeMt5(); mt5.rejectEntry = { retcode: 10019, message: 'No money' }
  const store = new MemoryStore(execution())
  await run(mt5, store); await run(mt5, store)
  assert.equal(store.value.state, 'REJECTED')
  assert.equal(mt5.queued.length, 1)
})

test('an offline bridge places nothing and needs attention', async () => {
  const mt5 = new FakeMt5(); mt5.heartbeat = false
  const store = new MemoryStore(execution())
  await run(mt5, store)
  assert.equal(store.value.state, 'ATTENTION'); assert.equal(store.value.error, 'MT5_BRIDGE_OFFLINE')
  assert.equal(mt5.queued.length, 0)
})

test('an unreported result is never resubmitted and reconciles once the EA reports', async () => {
  const mt5 = new FakeMt5(); mt5.autoProcess = false
  const store = new MemoryStore(execution())
  await run(mt5, store)
  assert.equal(store.value.state, 'ATTENTION'); assert.equal(store.value.intents[0].state, 'SUBMITTING')
  await run(mt5, store)
  assert.equal(mt5.queued.length, 1, 'no second entry')
  mt5.autoProcess = true; mt5.process(mt5.queued[0])
  await run(mt5, store); await run(mt5, store)
  assert.equal(store.value.state, 'OPEN')
})

test('a demo bridge cannot serve a live account', async () => {
  const mt5 = new FakeMt5()
  await assert.rejects(new Mt5ExecutionBroker(mt5, 'live').connect(), /MT5_ENVIRONMENT_MISMATCH/)
  mt5.tradeMode = 'REAL'
  await new Mt5ExecutionBroker(mt5, 'live').connect()
})

test('margin capacity and equity risk capital are reported in quote currency', async () => {
  const broker = new Mt5ExecutionBroker(new FakeMt5(), 'testnet')
  near(await broker.riskCapital('OANDA:EURUSD'), 10000)
  near(await broker.availableQuote('OANDA:EURUSD'), 9000 * 0.9 / 1100 * 100000 * 1.1001)
  const rules = await broker.instrument('OANDA:EURUSD')
  assert.equal(rules.step, 1000); assert.equal(rules.minQuantity, 1000); assert.equal(rules.quote, 'USD')
})
