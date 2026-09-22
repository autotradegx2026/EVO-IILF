import test from 'node:test'
import assert from 'node:assert/strict'
import { brokerRow, paperRow, legacyRow, summarize, ledgerCsv, ReportQuery, type AccountSummary } from '../lib/reporting/model'
import type { Execution } from '../lib/execution/model'
import type { PaperTrade, Trade } from '../types/database'

const account: AccountSummary = { id: 'fixture-account', label: 'Fixture Spot testnet', broker: 'binance', environment: 'testnet', connected: false }
const opened = '2026-01-01T00:00:00Z', closed = '2026-01-02T00:00:00Z'
function execution(patch: Partial<Execution> = {}): Execution {
  return { id: 'fixture-execution', user_id: 'fixture-user', broker_account_id: account.id, signal_id: 'fixture-signal', environment: 'testnet',
    symbol: 'BINANCE:BTCUSDT', direction: 'LONG', currency: 'USDT', state: 'CLOSED', requested_quantity: 10,
    signal_price: 100, stop_loss: 95, take_profit: 115, rr: 3, risk_budget: 50, intents: [
      { clientId: 'fixture-entry', purpose: 'ENTRY', side: 'BUY', type: 'MARKET', quantity: 10, state: 'ACKNOWLEDGED',
        snapshot: { orderId: '1', clientId: 'fixture-entry', state: 'FILLED', quantity: 10, filled: 10, averagePrice: 100, quoteAmount: 1000, baseFee: 0, quoteFee: 1, otherFees: {} } },
      { clientId: 'fixture-exit', purpose: 'TARGET', side: 'SELL', type: 'LIMIT', quantity: 10, state: 'ACKNOWLEDGED',
        snapshot: { orderId: '2', clientId: 'fixture-exit', state: 'FILLED', quantity: 10, filled: 10, averagePrice: 115, quoteAmount: 1150, baseFee: 0, quoteFee: 1, otherFees: {} } },
    ], entry_quantity: 10,
    exit_quantity: 10, entry_price: 100, exit_price: 115, gross_pnl: 150, quote_fees: 2, other_fees: {}, residual_quantity: 0,
    close_reason: 'TP_HIT', error: null, closing_requested: false, session_start: '00:00', session_end: '00:00', session_timezone: 'Etc/UTC',
    deadline_at: '2026-01-03T00:00:00Z', created_at: opened, updated_at: closed, version: 10, ...patch }
}
function paper(patch: Partial<PaperTrade> = {}): PaperTrade {
  return { id: 'fixture-paper', user_id: 'fixture-user', signal_id: null, symbol: 'BINANCE:BTCUSDT', direction: 'LONG',
    currency: 'USDT', entry_price: 100, stop_loss: 95, take_profit: 115, quantity: 10, initial_capital: 100000,
    risk_percent: 1, rr_ratio: 3, confluence_score: 5, status: 'CLOSED', close_price: 115, pnl: 150, pnl_percent: .15,
    close_reason: 'TP_HIT', notes: null, opened_at: opened, closed_at: closed, timeframe: '1m', signal_time: opened,
    last_bar_at: closed, current_price: 115, unrealized_pnl: 0, monitor_error: null, last_checked_at: closed,
    source: 'binance', session_start: '00:00', session_end: '00:00', session_timezone: 'Etc/UTC', ...patch }
}
function legacy(patch: Partial<Trade> = {}): Trade {
  return { id: 'fixture-legacy', user_id: 'fixture-user', signal_id: null, broker_account_id: null,
    broker_order_id: null, sl_order_id: null, tp_order_id: null, symbol: 'TEST', direction: 'LONG', entry_price: 100,
    stop_loss: 95, take_profit: 115, quantity: 10, status: 'CLOSED', close_price: 115, pnl: 150, close_reason: 'TP_HIT',
    confluence_score: null, notes: null, screenshot_url: null, opened_at: opened, closed_at: closed, ...patch }
}

test('known quote fees reduce actual PnL while Angel fee absence is not fabricated as a net result', () => {
  const spot = brokerRow(execution(), account)
  assert.equal(spot.grossPnl, 150)
  assert.equal(spot.quoteFees, 2)
  assert.equal(spot.accountedPnl, 148)
  assert.equal(spot.netPnl, 148)
  const angel = brokerRow(execution({ environment: 'live', symbol: 'NSE:TEST-EQ', currency: 'INR', quote_fees: 0 }), { ...account, broker: 'angelone', environment: 'live' })
  assert.equal(angel.accountedPnl, 150)
  assert.equal(angel.netPnl, null)
  assert.match(angel.feeBasis, /unavailable/i)
  assert.equal(summarize([angel], 'INR').netPnl, null)
})


test('unknown fills, missing snapshots, nonterminal exits and unresolved errors cannot claim definitive net PnL', () => {
  const normal = execution()
  const uncertainExit = { ...normal.intents[1], state: 'SUBMITTING' as const, snapshot: undefined }
  const openExit = { ...normal.intents[1], snapshot: { ...normal.intents[1].snapshot!, state: 'NEW' as const } }
  for (const patch of [
    { state: 'ATTENTION' as const, entry_quantity: 0, exit_quantity: 0, gross_pnl: 0, quote_fees: 0, error: 'SUBMISSION_UNKNOWN_RECONCILE_REQUIRED', intents: [uncertainExit] },
    { intents: [] },
    { intents: [normal.intents[0], uncertainExit] },
    { intents: [normal.intents[0], openExit] },
    { error: 'BROKER_FILL_REGRESSION' },
    { residual_quantity: .1 },
  ]) {
    const row = brokerRow(execution(patch), account)
    assert.equal(row.netPnl, null)
    assert.match(row.feeBasis, /incomplete/i)
  }
  const canceledProtection = { ...normal.intents[1], purpose: 'STOP' as const, snapshot: { ...normal.intents[1].snapshot!, state: 'CANCELED' as const, filled: 0, quoteAmount: 0 } }
  const rejectedProtection = { ...canceledProtection, state: 'REJECTED' as const, snapshot: undefined }
  assert.equal(brokerRow(execution({ intents: [...normal.intents, canceledProtection, rejectedProtection] }), account).netPnl, 148)
})

test('missing or non-finite stored monetary data fails instead of silently becoming zero', () => {
  for (const value of [NaN, Infinity, undefined, null]) {
    assert.throws(() => brokerRow(execution({ quote_fees: value as number }), account), /LEDGER_AMOUNT_UNAVAILABLE/)
  }
  assert.throws(() => brokerRow(execution({ other_fees: null as unknown as Record<string, number> }), account), /LEDGER_AMOUNT_UNAVAILABLE/)
  assert.throws(() => brokerRow(execution({ other_fees: { BNB: NaN } }), account), /LEDGER_AMOUNT_UNAVAILABLE/)
  assert.throws(() => paperRow(paper({ pnl: NaN })), /LEDGER_AMOUNT_UNAVAILABLE/)
})

test('base fee aliases use the actual asset and add to existing same-asset fees in either order', () => {
  for (const other_fees of [{ BASE: .01, BTC: .02, BNB: .003 }, { BTC: .02, BASE: .01, BNB: .003 }]) {
    const row = brokerRow(execution({ other_fees }), account)
    assert.deepEqual(row.otherFees, { BTC: .03, BNB: .003 })
    assert.equal(row.netPnl, null)
    assert.equal(row.accountedPnl, 148)
    assert.match(row.feeBasis, /not converted/i)
    const report = summarize([row], 'USDT')
    assert.equal(report.netPnl, null)
    assert.deepEqual(report.otherFees, { BTC: .03, BNB: .003 })
  }
})

test('partial exits and residual inventory retain journal accounting but do not inflate completed totals or win rate', () => {
  const completed = brokerRow(execution({ id: 'settled' }), account)
  const partial = brokerRow(execution({ id: 'partial', state: 'CLOSING', exit_quantity: 4, residual_quantity: 6, gross_pnl: -20, quote_fees: 1, close_reason: 'SL_HIT' }), account)
  const residual = brokerRow(execution({ id: 'dust', exit_quantity: 9, residual_quantity: 1, gross_pnl: -45, quote_fees: 1, error: 'RESIDUAL_INVENTORY_BELOW_EXCHANGE_MINIMUM' }), account)
  assert.equal(partial.settled, false)
  assert.equal(residual.settled, false)
  const report = summarize([partial, completed, residual], 'USDT')
  assert.equal(partial.grossPnl, -20)
  assert.equal(partial.accountedPnl, -21)
  assert.equal(partial.netPnl, null)
  assert.equal(residual.grossPnl, -45)
  assert.equal(residual.accountedPnl, -46)
  assert.equal(residual.netPnl, null)
  assert.equal(report.grossPnl, 150)
  assert.equal(report.quoteFees, 2)
  assert.equal(report.accountedPnl, 148)
  assert.equal(report.netPnl, 148)
  assert.equal(report.unsettled, 2)
  assert.equal(report.metrics.totalTrades, 1)
  assert.equal(report.metrics.winRate, 100)
  assert.equal(report.metrics.netPnl, 148)
  assert.equal(report.monthly[0].total_trades, 1)
  assert.equal(report.monthly[0].net_pnl, 148)
})

test('paper unrealized marks are separate from realized PnL and paper net fees remain unavailable', () => {
  const open = paperRow(paper({ id: 'open', status: 'OPEN', closed_at: null, close_price: null, close_reason: null, pnl: 999, unrealized_pnl: 50 }))
  const done = paperRow(paper())
  assert.equal(open.grossPnl, 0)
  assert.equal(open.unrealized, 50)
  assert.equal(open.settled, false)
  assert.equal(done.unrealized, 0)
  assert.equal(done.netPnl, null)
  const report = summarize([open, done], 'USDT')
  assert.equal(report.grossPnl, 150)
  assert.equal(report.netPnl, null)
  assert.equal(report.metrics.totalTrades, 1)
  assert.match(report.feeNotes.join(' '), /excludes fees/i)
})

test('unknown legacy currencies retain journal values but cannot produce monetary totals or completed statistics', () => {
  const rows = [legacyRow(legacy({ id: 'indian', symbol: 'NSE:TEST-EQ', pnl: 1000 })), legacyRow(legacy({ id: 'crypto', symbol: 'BINANCE:BTCUSDT', pnl: -10 }))]
  assert.deepEqual(rows.map(row => row.currency), ['UNKNOWN', 'UNKNOWN'])
  assert.deepEqual(rows.map(row => row.grossPnl), [1000, -10])
  assert.ok(rows.every(row => row.netPnl === null))
  const report = summarize(rows, 'UNKNOWN')
  assert.equal(report.grossPnl, null)
  assert.equal(report.quoteFees, null)
  assert.equal(report.accountedPnl, null)
  assert.equal(report.netPnl, null)
  assert.equal(report.metrics.netPnl, null)
  assert.equal(report.metrics.grossProfit, null)
  assert.equal(report.metrics.grossLoss, null)
  assert.equal(report.metrics.maxDrawdownAmount, null)
  assert.equal(report.metrics.totalTrades, 0)
  assert.deepEqual(report.metrics.equityCurve, [])
  assert.deepEqual(report.monthly, [])
  assert.match(report.feeNotes.join(' '), /currencies are unverified/i)
})

test('monetary aggregation refuses mixed currencies even when selected labels or amounts look compatible', () => {
  const usdt = paperRow(paper()), inr = paperRow(paper({ id: 'inr', symbol: 'NSE:TEST-EQ', currency: 'INR' }))
  assert.throws(() => summarize([usdt, inr], 'USDT'), /MIXED_CURRENCIES_FORBIDDEN/)
  assert.throws(() => summarize([inr], 'USDT'), /MIXED_CURRENCIES_FORBIDDEN/)
  assert.throws(() => summarize([legacyRow(legacy()), usdt], 'UNKNOWN'), /MIXED_CURRENCIES_FORBIDDEN/)
})

test('monthly grouping uses the selected timezone and defaults to India without mutating rows', () => {
  const rows = [paperRow(paper({ id: 'later', closed_at: '2026-01-31T18:30:00Z', pnl: -50 })), paperRow(paper({ id: 'earlier', closed_at: '2026-01-31T18:29:59Z', pnl: 100 }))]
  assert.deepEqual(summarize(rows, 'USDT').monthly.map(m => [m.month, m.net_pnl]), [['2026-01-01', 100], ['2026-02-01', -50]])
  assert.deepEqual(summarize(rows, 'USDT', 'Etc/UTC').monthly.map(m => [m.month, m.net_pnl]), [['2026-01-01', 50]])
  assert.deepEqual(rows.map(row => row.id), ['later', 'earlier'])
})

test('monthly grouping honors daylight-saving timezone rules rather than applying a fixed offset', () => {
  const rows = [paperRow(paper({ id: 'before', closed_at: '2026-07-01T03:59:59Z', pnl: 100 })), paperRow(paper({ id: 'after', closed_at: '2026-07-01T04:00:00Z', pnl: -50 }))]
  assert.deepEqual(summarize(rows, 'USDT', 'America/New_York').monthly.map(m => [m.month, m.net_pnl]), [['2026-06-01', 100], ['2026-07-01', -50]])
  assert.throws(() => summarize(rows, 'USDT', 'Invalid/Timezone'), RangeError)
})

test('CSV neutralizes formula strings including leading whitespace and newlines without changing numeric losses', () => {
  for (const notes of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1)', '  =1+1', '\n=1+1', '\r=1+1', '\t=1+1', ' \t@SUM(1)']) {
    const csv = ledgerCsv([{ ...paperRow(paper({ notes, pnl: -50 })), accountLabel: '=HYPERLINK("https://example.invalid")' }])
    assert.ok(csv.endsWith('"\'' + notes.replace(/"/g, '""') + '"'))
    assert.ok(csv.includes('"\'=HYPERLINK(""https://example.invalid"")"'))
    assert.ok(csv.includes(',"-50",'))
    assert.equal(csv.includes('"\'-50"'), false)
  }
})

test('CSV escapes quoted multiline notes and leaves unknown net empty with environment and currency explicit', () => {
  const csv = ledgerCsv([paperRow(paper({ notes: 'review, "quoted"\nnext line' }))])
  assert.ok(csv.includes('"paper","Paper portfolio","USDT"'))
  assert.ok(csv.includes('"150","","Simulation excludes fees and slippage"'))
  assert.ok(csv.endsWith('"review, ""quoted""\nnext line"'))
})

test('report query validates environment, currency and pagination without accepting unsafe arbitrary options', () => {
  assert.equal(ReportQuery.parse({}).environment, 'paper')
  for (const query of [{ environment: 'production' }, { currency: 'USDT;DROP' }, { page: 0 }, { limit: 101 }, { account: 'someone-else' }, { unknown: true }]) {
    assert.equal(ReportQuery.safeParse(query).success, false)
  }
})
