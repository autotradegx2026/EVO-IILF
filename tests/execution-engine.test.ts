import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceExecution, type ExecutionControls, type ExecutionStore } from '../lib/execution/engine'
import type { Execution, ExecutionBroker, Instrument, Intent, OrderSnapshot, Submission } from '../lib/execution/model'

const now = Date.parse('2026-09-06T10:00:00Z')
const controls: ExecutionControls = { entriesAllowed: true, maxPriceDriftBps: 100 }
const clone = <T>(value: T): T => structuredClone(value)
function execution(overrides: Partial<Execution> = {}): Execution {
  return { id: '84dc2928-4570-4673-8058-432e8a94b100', user_id: 'fixture-user', broker_account_id: 'fixture-account', signal_id: 'fixture-signal',
    environment: 'testnet', symbol: 'BINANCE:TESTUSDT', direction: 'LONG', currency: 'USDT', state: 'QUEUED',
    requested_quantity: 10, signal_price: 100, stop_loss: 95, take_profit: 115, rr: 3, risk_budget: 50,
    intents: [], entry_quantity: 0, exit_quantity: 0, entry_price: 0, exit_price: 0, gross_pnl: 0, quote_fees: 0, other_fees: {}, residual_quantity: 0,
    close_reason: null, error: null, closing_requested: false, session_end: '23:59', session_start: '00:00', session_timezone: 'Etc/UTC',
    deadline_at: new Date(now + 3600000).toISOString(), created_at: new Date(now - 1000).toISOString(), updated_at: new Date(now - 1000).toISOString(), version: 0, ...overrides }
}
function intent(purpose: Intent['purpose'], quantity = 10): Intent {
  return { clientId: `fixture-${purpose}`, purpose, side: purpose === 'ENTRY' ? 'BUY' : 'SELL', type: purpose === 'STOP' ? 'STOP' : purpose === 'TARGET' ? 'LIMIT' : 'MARKET',
    quantity, state: 'ACKNOWLEDGED', orderId: `order-${purpose}`, submittedAt: new Date(now - 30000).toISOString(),
    ...(purpose === 'STOP' ? { trigger: 95 } : purpose === 'TARGET' ? { price: 115 } : {}) }
}
function snapshot(order: Intent, overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return { orderId: order.orderId ?? `order-${order.clientId}`, clientId: order.clientId, state: 'NEW', quantity: order.quantity,
    filled: 0, averagePrice: 0, quoteAmount: 0, baseFee: 0, quoteFee: 0, otherFees: {}, ...overrides }
}

class MemoryStore implements ExecutionStore {
  value: Execution
  saves: Execution[] = []
  events: string[] = []
  failSave: ((value: Execution) => boolean) | null = null
  authorizeEntry?: (value: Execution) => Promise<boolean>
  leaseLost = false
  constructor(value: Execution) { this.value = clone(value) }
  async save(value: Execution): Promise<Execution> {
    if (this.failSave?.(value)) throw new Error('EXECUTION_SAVE_FAILED')
    if (value.version !== this.value.version) throw new Error('EXECUTION_VERSION_CHANGED')
    this.value = clone({ ...value, version: value.version + 1 })
    this.saves.push(clone(this.value)); this.events.push('save')
    return clone(this.value)
  }
  async fence(): Promise<void> {
    this.events.push('fence')
    if (this.leaseLost) throw new Error('WORKER_LEASE_LOST')
  }
}
class FakeBroker implements ExecutionBroker {
  readonly venue = 'binance' as const
  environment: 'testnet' | 'live' = 'testnet'
  nativeOco = false
  longOnly = false
  rules: Instrument = { symbol: 'BINANCE:TESTUSDT', base: 'TEST', quote: 'USDT', price: 100, tick: .01, step: 1, minQuantity: 1, maxQuantity: 1000, minNotional: 1 }
  orders = new Map<string, OrderSnapshot>()
  submissions: Intent[] = []
  cancellations: Intent[] = []
  protections: { stop: Intent; target: Intent; listClientId: string }[] = []
  onSubmit?: (order: Intent) => Promise<Submission>
  onCancel?: (order: Intent) => Promise<void>
  onProtect?: (stop: Intent, target: Intent) => Promise<Submission>
  async connect() {}
  async instrument() { return clone(this.rules) }
  async availableQuote() { return 100000 }
  async availableBase() { return 1000 }
  async lookup(_symbol: string, order: Intent) { return clone(this.orders.get(order.clientId) ?? null) }
  async submit(_symbol: string, order: Intent): Promise<Submission> {
    this.submissions.push(clone(order))
    if (this.onSubmit) return this.onSubmit(order)
    const filled = order.purpose === 'ENTRY' ? order.quantity : 0
    this.orders.set(order.clientId, snapshot(order, { state: filled ? 'FILLED' : 'NEW', filled, averagePrice: filled ? 100 : 0, quoteAmount: filled * 100 }))
    return { outcome: 'ACCEPTED', orderId: this.orders.get(order.clientId)!.orderId }
  }
  async cancel(_symbol: string, order: Intent) {
    this.cancellations.push(clone(order))
    if (this.onCancel) return this.onCancel(order)
    const found = this.orders.get(order.clientId)
    if (found) this.orders.set(order.clientId, { ...found, state: 'CANCELED' })
  }
  async protect(_symbol: string, stop: Intent, target: Intent, listClientId: string): Promise<Submission> {
    this.protections.push({ stop: clone(stop), target: clone(target), listClientId })
    if (this.onProtect) return this.onProtect(stop, target)
    for (const order of [stop, target]) this.orders.set(order.clientId, snapshot(order, { listId: 'fixture-list' }))
    return { outcome: 'ACCEPTED' }
  }
}
function openFixture(overrides: Partial<Execution> = {}) {
  const entry = intent('ENTRY'), stop = intent('STOP')
  const broker = new FakeBroker()
  broker.orders.set(entry.clientId, snapshot(entry, { state: 'FILLED', filled: 10, averagePrice: 100, quoteAmount: 1000 }))
  broker.orders.set(stop.clientId, snapshot(stop))
  const initial = execution({ state: 'OPEN', intents: [entry, stop], ...overrides })
  const store = new MemoryStore(initial)
  return { broker, store, entry, stop }
}
const run = (store: MemoryStore, broker: FakeBroker, options = controls, time = now) => advanceExecution(store.value, broker, store, options, time)

test('durable intent and lease fence precede every entry/protection submission', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  broker.onSubmit = async order => {
    const persisted = store.value.intents.find(value => value.clientId === order.clientId)
    assert.equal(persisted?.state, 'SUBMITTING')
    assert.equal(persisted?.submittedAt, new Date(now).toISOString())
    assert.equal(store.events.at(-1), 'fence')
    const filled = order.purpose === 'ENTRY' ? order.quantity : 0
    broker.orders.set(order.clientId, snapshot(order, { filled, state: filled ? 'FILLED' : 'NEW', averagePrice: filled ? 100 : 0, quoteAmount: filled * 100 }))
    return { outcome: 'ACCEPTED', orderId: `order-${order.clientId}` }
  }
  const result = await run(store, broker)
  assert.equal(result.state, 'PROTECTING')
  assert.deepEqual(broker.submissions.map(value => value.purpose), ['ENTRY', 'STOP'])
})

test('lost entry response recovers by persisted client ID without another entry', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  let accepted: Intent | undefined
  broker.onSubmit = async order => { accepted = clone(order); return { outcome: 'UNKNOWN', reason: 'TIMEOUT' } }
  const first = await run(store, broker)
  assert.equal(first.state, 'ATTENTION'); assert.equal(broker.submissions.length, 1)
  broker.orders.set(accepted!.clientId, snapshot(accepted!, { state: 'FILLED', filled: 10, averagePrice: 100, quoteAmount: 1000 }))
  broker.onSubmit = undefined
  const next = await run(store, broker)
  assert.equal(next.state, 'PROTECTING')
  assert.equal(broker.submissions.filter(order => order.purpose === 'ENTRY').length, 1)
  assert.equal(broker.submissions.find(order => order.purpose === 'STOP')?.quantity, 10)
})

test('missing unknown entry is never resubmitted even after repeated successful empty lookups', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  broker.onSubmit = async () => ({ outcome: 'UNKNOWN', reason: 'TIMEOUT' })
  await run(store, broker); await run(store, broker); await run(store, broker)
  assert.equal(broker.submissions.length, 1)
  assert.equal(store.value.state, 'ATTENTION')
  assert.equal(store.value.error, 'SUBMISSION_UNKNOWN_RECONCILE_REQUIRED')
})

test('failed durable intent save causes no broker side effect', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  store.failSave = value => value.intents.some(order => order.state === 'SUBMITTING')
  await assert.rejects(run(store, broker), /EXECUTION_SAVE_FAILED/)
  assert.equal(broker.submissions.length, 0); assert.equal(broker.protections.length, 0)
  assert.equal(store.value.intents.length, 0)
})

test('fresh authorization rejection terminates the persisted intent without broker effects or another terminal save', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  let authorizations = 0
  store.authorizeEntry = async value => {
    authorizations++
    assert.equal(value.version, store.value.version)
    assert.equal(store.value.intents[0].state, 'SUBMITTING')
    assert.equal(store.events.at(-1), 'fence')
    return false
  }
  // The database disallows updates to terminal executions. Detect any extra save
  // after the authorization branch has already persisted its rejection.
  store.failSave = () => ['REJECTED', 'CLOSED'].includes(store.value.state)
  const result = await run(store, broker)
  assert.equal(result.state, 'REJECTED')
  assert.equal(result.error, 'ENTRY_AUTHORIZATION_CHANGED')
  assert.equal(result.intents[0].state, 'REJECTED')
  assert.equal(authorizations, 1)
  assert.equal(broker.submissions.length, 0)
  assert.equal(broker.protections.length, 0)
  assert.equal(broker.cancellations.length, 0)
  assert.equal(store.saves.filter(value => value.state === 'REJECTED').length, 1)
  const saves = store.saves.length
  assert.deepEqual(await run(store, broker), result)
  assert.equal(store.saves.length, saves)
  assert.equal(authorizations, 1)
})

test('authorization read failure rejects the saved intent without submitting it', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  store.authorizeEntry = async () => { throw new Error('fixture database timeout') }
  const result = await run(store, broker)
  assert.equal(result.state, 'REJECTED')
  assert.equal(result.error, 'ENTRY_AUTHORIZATION_CHANGED')
  assert.equal(result.intents[0].state, 'REJECTED')
  assert.equal(broker.submissions.length, 0)
})

test('lease lost during successful authorization is fenced before the broker side effect', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  let authorizationReached = false
  store.authorizeEntry = async value => {
    assert.equal(store.events.filter(event => event === 'fence').length, 1)
    assert.equal(value.intents[0].state, 'SUBMITTING')
    authorizationReached = true
    store.leaseLost = true
    return true
  }
  await assert.rejects(run(store, broker), /WORKER_LEASE_LOST/)
  assert.equal(authorizationReached, true)
  assert.equal(store.events.filter(event => event === 'fence').length, 2)
  assert.equal(store.value.intents[0].state, 'SUBMITTING')
  assert.equal(store.value.state, 'ENTERING')
  assert.equal(broker.submissions.length, 0)
  assert.equal(broker.protections.length, 0)
  assert.equal(store.saves.filter(value => value.state === 'ATTENTION' || value.state === 'REJECTED').length, 0)
})

test('successful authorization that outlasts signal freshness cannot submit an entry', async t => {
  let current = now
  t.mock.method(Date, 'now', () => current)
  const store = new MemoryStore(execution({ created_at: new Date(now - 299000).toISOString() })), broker = new FakeBroker()
  let authorizations = 0
  store.authorizeEntry = async value => {
    authorizations++
    assert.equal(value.intents[0].state, 'SUBMITTING')
    assert.ok(current - Date.parse(value.created_at) <= 300000)
    current = now + 2000
    assert.ok(current < Date.parse(value.deadline_at))
    return true
  }
  const result = await advanceExecution(store.value, broker, store, controls)
  assert.equal(authorizations, 1)
  assert.equal(result.state, 'REJECTED')
  assert.equal(result.error, 'ENTRY_AUTHORIZATION_CHANGED')
  assert.equal(result.intents[0].state, 'REJECTED')
  assert.equal(broker.submissions.length, 0)
  assert.equal(broker.protections.length, 0)
})

test('deadline crossed while awaiting broker balance prevents the subsequent entry submission', async t => {
  let current = now
  t.mock.method(Date, 'now', () => current)
  const store = new MemoryStore(execution({ deadline_at: new Date(now + 1000).toISOString() })), broker = new FakeBroker()
  let releaseBalance!: (value: number) => void
  let observedBalance!: () => void
  const balanceRequested = new Promise<void>(resolve => { observedBalance = resolve })
  const balance = new Promise<number>(resolve => { releaseBalance = resolve })
  broker.availableQuote = async () => { observedBalance(); return balance }
  const advancing = advanceExecution(store.value, broker, store, controls)
  await balanceRequested
  current = now + 2000
  releaseBalance(100000)
  const result = await advancing
  assert.equal(result.state, 'REJECTED')
  assert.equal(result.error, 'ENTRY_AUTHORIZATION_CHANGED')
  assert.equal(result.intents[0].state, 'REJECTED')
  assert.equal(broker.submissions.length, 0)
})

test('deadline crossed while awaiting a broker quote prevents the subsequent entry submission', async t => {
  let current = now
  t.mock.method(Date, 'now', () => current)
  const store = new MemoryStore(execution({ deadline_at: new Date(now + 1000).toISOString() })), broker = new FakeBroker()
  let releaseQuote!: (value: Instrument) => void
  let observedQuote!: () => void
  const quoteRequested = new Promise<void>(resolve => { observedQuote = resolve })
  const quote = new Promise<Instrument>(resolve => { releaseQuote = resolve })
  broker.instrument = async () => { observedQuote(); return quote }
  const advancing = advanceExecution(store.value, broker, store, controls)
  await quoteRequested
  current = now + 2000
  releaseQuote(clone(broker.rules))
  const result = await advancing
  assert.equal(result.state, 'REJECTED')
  assert.equal(result.error, 'ENTRY_AUTHORIZATION_CHANGED')
  assert.equal(broker.submissions.length, 0)
})

test('lost lease after intent save prevents submission and leaves recoverable SUBMITTING intent', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  store.leaseLost = true
  await assert.rejects(run(store, broker), /WORKER_LEASE_LOST/)
  assert.equal(store.value.intents[0].state, 'SUBMITTING')
  assert.equal(broker.submissions.length, 0)
  store.leaseLost = false
  const result = await run(store, broker)
  assert.equal(result.state, 'ATTENTION'); assert.equal(broker.submissions.length, 0)
})

test('post-submission persistence failure recovers the accepted entry instead of resending', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  store.failSave = value => value.intents.some(order => order.purpose === 'ENTRY' && !!order.orderId)
  await assert.rejects(run(store, broker), /EXECUTION_SAVE_FAILED/)
  assert.equal(broker.submissions.length, 1)
  assert.equal(store.value.intents[0].orderId, undefined)
  store.failSave = null
  await run(store, broker)
  assert.equal(broker.submissions.filter(order => order.purpose === 'ENTRY').length, 1)
})

test('partial entry cancellation protects the final filled quantity including cancel-race fills', async () => {
  const entry = intent('ENTRY'), broker = new FakeBroker(), store = new MemoryStore(execution({ state: 'ENTERING', intents: [entry] }))
  broker.orders.set(entry.clientId, snapshot(entry, { state: 'PARTIAL', filled: 3, averagePrice: 100, quoteAmount: 300 }))
  broker.onCancel = async order => { broker.orders.set(order.clientId, snapshot(order, { state: 'CANCELED', filled: 4, averagePrice: 100, quoteAmount: 400 })) }
  const result = await run(store, broker)
  assert.equal(broker.cancellations[0].purpose, 'ENTRY')
  assert.equal(result.entry_quantity, 4)
  assert.equal(broker.submissions[0].purpose, 'STOP'); assert.equal(broker.submissions[0].quantity, 4)
})

test('entry cancellation acknowledgment without terminal state cannot place protection', async () => {
  const entry = intent('ENTRY'), broker = new FakeBroker(), store = new MemoryStore(execution({ state: 'ENTERING', intents: [entry] }))
  broker.orders.set(entry.clientId, snapshot(entry, { state: 'PARTIAL', filled: 3, averagePrice: 100, quoteAmount: 300 }))
  broker.onCancel = async () => {}
  const result = await run(store, broker)
  assert.equal(result.state, 'ENTERING'); assert.equal(result.error, 'PARTIAL_ENTRY_CANCEL_PENDING')
  assert.equal(broker.submissions.length, 0)
})

test('kill switch blocks new entry but continues existing position protection and exit', async () => {
  const disabled = { ...controls, entriesAllowed: false }
  const queuedStore = new MemoryStore(execution()), queuedBroker = new FakeBroker()
  assert.equal((await run(queuedStore, queuedBroker, disabled)).state, 'REJECTED')
  assert.equal(queuedBroker.submissions.length, 0)
  const { store, broker } = openFixture()
  broker.rules.price = 116
  const result = await run(store, broker, disabled)
  assert.equal(result.state, 'CLOSING'); assert.equal(result.close_reason, 'TP_HIT')
  assert.equal(broker.cancellations.length, 1)
  assert.equal(broker.submissions[0].purpose, 'CLOSE')
})

test('disabling entries cancels a newly acknowledged unfilled entry before its usual timeout', async () => {
  const entry = { ...intent('ENTRY'), submittedAt: new Date(now - 1000).toISOString() }
  const broker = new FakeBroker(), store = new MemoryStore(execution({ state: 'ENTERING', intents: [entry] }))
  broker.orders.set(entry.clientId, snapshot(entry))
  const result = await run(store, broker, { ...controls, entriesAllowed: false })
  assert.deepEqual(broker.cancellations.map(order => order.clientId), [entry.clientId])
  assert.equal(result.state, 'REJECTED')
  assert.equal(result.error, 'ENTRY_CANCELED_UNFILLED')
  assert.equal(result.intents[0].snapshot?.state, 'CANCELED')
  assert.equal(broker.submissions.length, 0)
  assert.equal(broker.protections.length, 0)
})

test('unconfirmed protective cancellation never permits a competing market close', async () => {
  const { store, broker } = openFixture({ closing_requested: true })
  broker.onCancel = async () => {}
  const result = await run(store, broker)
  assert.equal(result.state, 'CLOSING'); assert.equal(result.error, 'EXIT_CANCELLATION_PENDING')
  assert.equal(broker.submissions.length, 0)
})

test('partial exit and cancellation-race fills resize the subsequent close exactly', async () => {
  const { store, broker, stop } = openFixture()
  broker.orders.set(stop.clientId, snapshot(stop, { state: 'PARTIAL', filled: 2, averagePrice: 95, quoteAmount: 190 }))
  broker.onCancel = async order => { broker.orders.set(order.clientId, snapshot(order, { state: 'CANCELED', filled: 3, averagePrice: 95, quoteAmount: 285 })) }
  const result = await run(store, broker)
  assert.equal(result.exit_quantity, 3); assert.equal(result.residual_quantity, 7)
  assert.equal(result.close_reason, 'SL_HIT')
  assert.equal(broker.submissions[0].quantity, 7)
})

test('fills on both exit legs exceeding entry become ATTENTION without another order', async () => {
  const { store, broker, stop } = openFixture()
  const target = intent('TARGET'); store.value.intents.push(target)
  broker.orders.set(stop.clientId, snapshot(stop, { state: 'CANCELED', filled: 6, averagePrice: 95, quoteAmount: 570 }))
  broker.orders.set(target.clientId, snapshot(target, { state: 'CANCELED', filled: 6, averagePrice: 115, quoteAmount: 690 }))
  const result = await run(store, broker)
  assert.equal(result.state, 'ATTENTION'); assert.equal(result.error, 'BROKER_OVERFILL_REQUIRES_RECONCILIATION')
  assert.equal(result.exit_quantity, 12); assert.equal(broker.submissions.length, 0)
})

test('session deadline closes existing exposure even when entries are disabled', async () => {
  const { store, broker } = openFixture({ deadline_at: new Date(now).toISOString() })
  const result = await run(store, broker, { ...controls, entriesAllowed: false })
  assert.equal(result.close_reason, 'SESSION_END')
  assert.equal(broker.submissions[0].purpose, 'CLOSE'); assert.equal(broker.submissions[0].quantity, 10)
})

test('base commissions reduce spot inventory and unsellable residual and fees remain disclosed', async () => {
  const { store, broker, entry } = openFixture()
  broker.longOnly = true
  const stop = intent('STOP', 9); store.value.intents = [entry, stop]
  broker.orders.set(entry.clientId, snapshot(entry, { state: 'FILLED', filled: 10, averagePrice: 100, quoteAmount: 1000, baseFee: .1, quoteFee: 1, otherFees: { BNB: .003 } }))
  broker.orders.set(stop.clientId, snapshot(stop, { state: 'FILLED', filled: 9, averagePrice: 95, quoteAmount: 855, quoteFee: .5, otherFees: { BNB: .001 } }))
  const result = await run(store, broker)
  assert.equal(result.state, 'CLOSED'); assert.equal(result.error, 'RESIDUAL_INVENTORY_BELOW_EXCHANGE_MINIMUM')
  assert.ok(Math.abs(result.residual_quantity - .9) < 1e-10)
  assert.equal(result.gross_pnl, -45); assert.equal(result.quote_fees, 1.5)
  assert.deepEqual(result.other_fees, { BNB: .004, BASE: .1 }); assert.equal(broker.submissions.length, 0)
})

test('broker environment mismatch cannot submit, cancel or connect to execution path', async () => {
  const store = new MemoryStore(execution()), broker = new FakeBroker()
  broker.environment = 'live'
  broker.connect = async () => { assert.fail('Wrong environment must fail before broker authentication') }
  const result = await run(store, broker)
  assert.equal(result.state, 'ATTENTION'); assert.equal(result.error, 'BROKER_ENVIRONMENT_MISMATCH')
  assert.equal(broker.submissions.length, 0); assert.equal(broker.cancellations.length, 0)
})

test('uncertain native OCO submission is persisted as both intents and never resubmitted', async () => {
  const entry = intent('ENTRY'), broker = new FakeBroker(), store = new MemoryStore(execution({ state: 'ENTERING', intents: [entry] }))
  broker.nativeOco = true
  broker.orders.set(entry.clientId, snapshot(entry, { state: 'FILLED', filled: 10, averagePrice: 100, quoteAmount: 1000 }))
  broker.onProtect = async (stop, target) => {
    assert.equal(store.value.intents.find(order => order.clientId === stop.clientId)?.state, 'SUBMITTING')
    assert.equal(store.value.intents.find(order => order.clientId === target.clientId)?.state, 'SUBMITTING')
    assert.equal(store.events.at(-1), 'fence')
    return { outcome: 'UNKNOWN', reason: 'OCO_TIMEOUT' }
  }
  await run(store, broker)
  assert.equal(store.value.intents.length, 3)
  const result = await run(store, broker)
  assert.equal(result.state, 'ATTENTION'); assert.equal(result.error, 'SUBMISSION_UNKNOWN_RECONCILE_REQUIRED')
  assert.equal(broker.protections.length, 1); assert.equal(broker.submissions.length, 0)
})

test('confirmed close fill completes workflow with actual execution PnL and no duplicate close', async () => {
  const { store, broker } = openFixture({ closing_requested: true })
  await run(store, broker)
  const close = broker.submissions.find(order => order.purpose === 'CLOSE')!
  assert.ok(close)
  broker.orders.set(close.clientId, snapshot(close, { state: 'FILLED', filled: 10, averagePrice: 114, quoteAmount: 1140, quoteFee: 1.14 }))
  const result = await run(store, broker)
  assert.equal(result.state, 'CLOSED'); assert.equal(result.exit_quantity, 10)
  assert.equal(result.exit_price, 114); assert.equal(result.gross_pnl, 140); assert.equal(result.quote_fees, 1.14)
  assert.equal(result.residual_quantity, 0)
  await run(store, broker)
  assert.equal(broker.submissions.filter(order => order.purpose === 'CLOSE').length, 1)
})

test('broker cumulative fill regression becomes ATTENTION instead of resizing from stale exposure', async () => {
  const { store, broker, entry } = openFixture()
  store.value.intents[0].snapshot = snapshot(entry, { state: 'FILLED', filled: 10, averagePrice: 100, quoteAmount: 1000 })
  broker.orders.set(entry.clientId, snapshot(entry, { state: 'PARTIAL', filled: 4, averagePrice: 100, quoteAmount: 400 }))
  const result = await run(store, broker)
  assert.equal(result.state, 'ATTENTION'); assert.equal(result.error, 'BROKER_FILL_REGRESSION')
  assert.equal(broker.submissions.length, 0); assert.equal(broker.cancellations.length, 0)
})
