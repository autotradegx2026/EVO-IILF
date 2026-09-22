/** Authenticated reporting acceptance with isolated database fixtures only.
 * Never submits an order or connects to a broker. Requires migrations 014 and 015.
 * Run with VERIFICATION_URL. Set WRITE_BROWSER_FIXTURE to retain only the first
 * temporary account after success. Later use --cleanup-only and FIXTURE_FILE.
 */
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import assert from 'node:assert/strict'
import { z } from 'zod'
import type { Database } from '../types/database'
import type { Execution, Intent } from '../lib/execution/model'

loadEnvConfig(process.cwd())
const marker = 'reporting-deployment-v1'
const origin = process.env.VERIFICATION_URL
if (!origin) throw new Error('VERIFICATION_URL_REQUIRED')
const parsedOrigin = new URL(origin)
if (!['https:', 'http:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== '/') throw new Error('VERIFICATION_ORIGIN_INVALID')
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!supabaseUrl || !serviceKey || !publishableKey) throw new Error('VERIFICATION_SUPABASE_CONFIG_REQUIRED')
const db = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false } })
const retainedPath = process.env.WRITE_BROWSER_FIXTURE
if (retainedPath && !isAbsolute(retainedPath)) throw new Error('FIXTURE_PATH_MUST_BE_ABSOLUTE')
const fixtureSchema = z.object({
  schema: z.literal(marker), origin: z.string().url(), supabaseUrl: z.string().url(), createdAt: z.string(),
  user: z.object({ id: z.string().uuid(), email: z.string(), password: z.string() }),
  ids: z.object({ paper: z.array(z.string().uuid()), testnet: z.array(z.string().uuid()), live: z.string().uuid(), accounts: z.array(z.string().uuid()) }),
  screenshotPaths: z.array(z.string()),
})
type Session = { id: string; email: string; password: string; cookie: () => string }
const sessions: Session[] = []
const screenshots = new Set<string>()
const paperIds: string[] = [], testnetIds: string[] = [], accountIds: string[] = []
let liveId = '', retained = false

const rowSchema = z.object({ id: z.string(), environment: z.string(), currency: z.string(), symbol: z.string(), state: z.string(), grossPnl: z.number(), netPnl: z.number().nullable(), notes: z.string().nullable() })
const summarySchema = z.object({ grossPnl: z.number().nullable(), quoteFees: z.number().nullable(), accountedPnl: z.number().nullable(), netPnl: z.number().nullable(), metrics: z.object({ totalTrades: z.number(), netPnl: z.number().nullable() }) })
const reportSchema = z.object({ data: z.object({ environment: z.string(), currency: z.string(), currencies: z.array(z.string()), rows: z.array(rowSchema), count: z.number(), summary: summarySchema }) })
const alertsSchema = z.object({ data: z.array(z.object({ id: z.string(), environment: z.string(), currency: z.string().nullable(), is_read: z.boolean() })), count: z.number(), currencies: z.array(z.string()) })

function check(error: unknown, code: string): void { if (error) throw new Error(code) }
async function request(path: string, who = 0, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('cookie', sessions[who].cookie())
  return fetch(new URL(path, origin), { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(30000) })
}
async function json(path: string, who = 0, init: RequestInit = {}): Promise<{ response: Response; value: unknown }> {
  const response = await request(path, who, init)
  return { response, value: await response.json() as unknown }
}
async function report(query: string, who = 0) {
  const response = await json('/api/reporting?' + query, who)
  assert.equal(response.response.status, 200, 'REPORT_REQUEST_FAILED')
  return reportSchema.parse(response.value).data
}
const jsonBody = (body: unknown): RequestInit => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
function filledIntent(purpose: 'ENTRY' | 'TARGET', price: number, quoteFee: number, bnb = 0): Intent {
  const clientId = 'fixture-' + randomUUID()
  return { clientId, purpose, side: purpose === 'ENTRY' ? 'BUY' : 'SELL', type: purpose === 'ENTRY' ? 'MARKET' : 'LIMIT',
    quantity: 1, state: 'ACKNOWLEDGED', orderId: randomUUID(), snapshot: { clientId, orderId: randomUUID(), state: 'FILLED',
      quantity: 1, filled: 1, averagePrice: price, quoteAmount: price, baseFee: 0, quoteFee, otherFees: bnb ? { BNB: bnb } : {} } }
}

async function createSessions() {
  for (let n = 0; n < 2; n++) {
    const email = `evo-reporting-check-${randomBytes(12).toString('hex')}@example.invalid`, password = randomBytes(24).toString('hex')
    const made = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Reporting acceptance fixture', verification_fixture: marker } })
    check(made.error, 'FIXTURE_USER_CREATE_FAILED')
    assert.ok(made.data.user)
    const jar = new Map<string, string>()
    sessions.push({ id: made.data.user.id, email, password, cookie: () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ') })
    const client = createServerClient<Database>(supabaseUrl!, publishableKey!, { cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: cookies => cookies.forEach(cookie => jar.set(cookie.name, cookie.value)),
    } })
    check((await client.auth.signInWithPassword({ email, password })).error, 'FIXTURE_LOGIN_FAILED')
    check((await db.from('settings').update({ session_start: '00:00', session_end: '00:00', session_timezone: 'Etc/UTC',
      signal_delivery_mode: 'paper', paper_auto_scan: false, screener_symbols: ['BINANCE:TESTUSDT', 'OANDA:EURUSD', 'NSE:TEST-EQ'],
      screener_timeframe: '1m', cooldown_bars: 0, max_trades_per_day: 20 }).eq('user_id', made.data.user.id)).error, 'FIXTURE_SETTINGS_FAILED')
  }
}

async function seed() {
  const uid = sessions[0].id
  for (const [symbol, close] of [['BINANCE:TESTUSDT', 110], ['OANDA:EURUSD', 80], ['NSE:TEST-EQ', 150]] as const) {
    const trade = await db.from('paper_trades').insert({ user_id: uid, symbol, direction: 'LONG', entry_price: 100, stop_loss: 70,
      take_profit: 190, quantity: 1, initial_capital: 100000, risk_percent: 1, source: 'manual', timeframe: '1m', signal_time: new Date().toISOString() }).select('id').single()
    check(trade.error, 'FIXTURE_PAPER_CREATE_FAILED'); assert.ok(trade.data)
    paperIds.push(trade.data.id)
    // Close immediately through the real cursor/ownership RPC; no market-data call.
    const marked = await db.rpc('apply_paper_mark', { p_user_id: uid, p_trade_id: trade.data.id, p_expected_bar: null,
      p_bar_time: new Date().toISOString(), p_price: close, p_close_price: close, p_reason: 'MANUAL' })
    check(marked.error, 'FIXTURE_PAPER_CLOSE_FAILED')
    assert.equal(z.object({ status: z.string() }).parse(marked.data).status, 'CLOSED')
  }
  for (const [broker, environment] of [['binance', 'testnet'], ['angelone', 'live']] as const) {
    const account = await db.from('execution_accounts').insert({ user_id: uid, broker, environment,
      label: `Reporting ${environment} fixture — disconnected`, credentials_encrypted: 'intentionally-invalid-fixture-ciphertext', connected: false }).select('id').single()
    check(account.error, 'FIXTURE_ACCOUNT_CREATE_FAILED'); assert.ok(account.data)
    accountIds.push(account.data.id)
    for (let n = 0; n < (environment === 'testnet' ? 2 : 1); n++) {
      const symbol = environment === 'testnet' ? 'BINANCE:TESTUSDT' : 'NSE:TEST-EQ'
      const sig = await db.from('signals').insert({ user_id: uid, symbol, direction: 'LONG', state: 'LONG_READY', entry_price: 100,
        stop_loss: 90, take_profit: 130, confluence_score: 5, rr_ratio: 3, timeframe: '1m', is_executed: true }).select('id').single()
      check(sig.error, 'FIXTURE_SIGNAL_CREATE_FAILED'); assert.ok(sig.data)
      const timestamp = new Date().toISOString(), isTestnet = environment === 'testnet'
      const intents: Intent[] = isTestnet ? [filledIntent('ENTRY', 100, n ? .5 : 1), filledIntent('TARGET', n ? 120 : 110, n ? .5 : 1, n ? .1 : 0)] : [filledIntent('ENTRY', 100, 0)]
      if (!isTestnet) intents.push({ clientId: 'fixture-stop-' + randomUUID(), purpose: 'STOP', side: 'SELL', type: 'STOP', quantity: 1, trigger: 90, state: 'ACKNOWLEDGED',
        snapshot: { clientId: 'fixture-stop', orderId: 'fixture-only', state: 'NEW', quantity: 1, filled: 0, averagePrice: 0, quoteAmount: 0, baseFee: 0, quoteFee: 0, otherFees: {} } })
      const value: Partial<Execution> = { user_id: uid, broker_account_id: account.data.id, signal_id: sig.data.id, automatic: false,
        environment, symbol, direction: 'LONG', currency: isTestnet ? 'USDT' : 'INR', state: isTestnet ? 'CLOSED' : 'OPEN',
        requested_quantity: 1, signal_price: 100, stop_loss: 90, take_profit: 130, rr: 3, risk_budget: 10, intents,
        entry_quantity: 1, entry_price: 100, exit_quantity: isTestnet ? 1 : 0, exit_price: isTestnet ? n ? 120 : 110 : 0,
        gross_pnl: isTestnet ? n ? 20 : 10 : 0, quote_fees: isTestnet ? n ? 1 : 2 : 0, other_fees: isTestnet && n ? { BNB: .1 } : {},
        residual_quantity: isTestnet ? 0 : 1, close_reason: isTestnet ? 'MANUAL' : null,
        session_start: '00:00', session_end: '00:00', session_timezone: 'Etc/UTC', deadline_at: new Date(Date.now() + 3600000).toISOString(),
        created_at: timestamp, updated_at: timestamp }
      const execution = await db.from('broker_executions').insert(value).select('id').single()
      check(execution.error, 'FIXTURE_EXECUTION_CREATE_FAILED'); assert.ok(execution.data)
      if (isTestnet) testnetIds.push(execution.data.id); else liveId = execution.data.id
    }
  }
}

async function verifyReports() {
  const base = 'environment=testnet&currency=USDT&period=all&view=journal&limit=1'
  const first = await report(base + '&page=1'), second = await report(base + '&page=2')
  assert.equal(first.count, 2); assert.equal(first.rows.length, 1); assert.equal(second.count, 2); assert.equal(second.rows.length, 1)
  assert.notEqual(first.rows[0].id, second.rows[0].id)
  assert.deepEqual(new Set([first.rows[0].id, second.rows[0].id]), new Set(testnetIds))
  assert.equal(first.summary.metrics.totalTrades, 2); assert.equal(second.summary.metrics.totalTrades, 2)
  assert.equal(first.summary.grossPnl, 30); assert.equal(first.summary.quoteFees, 3); assert.equal(first.summary.accountedPnl, 27)
  assert.equal(first.summary.netPnl, null)
  const byId = new Map([...first.rows, ...second.rows].map(row => [row.id, row]))
  assert.equal(byId.get(testnetIds[0])!.netPnl, 8); assert.equal(byId.get(testnetIds[1])!.netPnl, null)
  for (const [currency, pnl, id] of [['USDT', 10, paperIds[0]], ['USD', -20, paperIds[1]], ['INR', 50, paperIds[2]]] as const) {
    const paper = await report(`environment=paper&currency=${currency}&period=all`)
    assert.equal(paper.count, 1); assert.equal(paper.rows[0].id, id); assert.equal(paper.summary.grossPnl, pnl)
    assert.equal(paper.summary.netPnl, null); assert.deepEqual(new Set(paper.currencies), new Set(['USDT', 'USD', 'INR']))
  }
  const live = await report(`environment=live&currency=INR&account=${accountIds[1]}&period=all`)
  assert.equal(live.count, 1); assert.equal(live.rows[0].id, liveId); assert.equal(live.rows[0].state, 'OPEN'); assert.equal(live.rows[0].netPnl, null)
  assert.equal(live.summary.metrics.totalTrades, 0)
  const other = await report('environment=testnet&currency=USDT&period=all', 1)
  assert.equal(other.count, 0)
  for (const query of [`environment=testnet&currency=INR&account=${accountIds[0]}`, `environment=live&currency=USDT&account=${accountIds[1]}`]) {
    const invalid = await json('/api/reporting?' + query)
    assert.notEqual(invalid.response.status, 200)
    assert.equal(z.object({ error: z.string() }).parse(invalid.value).error, 'CURRENCY_NOT_AVAILABLE')
  }
  const cross = await json(`/api/reporting?environment=testnet&account=${accountIds[0]}`, 1)
  assert.notEqual(cross.response.status, 200); assert.equal(z.object({ error: z.string() }).parse(cross.value).error, 'ACCOUNT_NOT_FOUND')
  const risk = await json('/api/risk?environment=paper&currency=USD&period=all')
  assert.equal(risk.response.status, 200)
  const r = z.object({ currency: z.string(), data: z.object({ todayTrades: z.number(), dailyLoss: z.number(), dailyPnl: z.number(), balance: z.number() }) }).parse(risk.value)
  assert.equal(r.currency, 'USD'); assert.equal(r.data.todayTrades, 3); assert.equal(r.data.dailyLoss, 20); assert.equal(r.data.dailyPnl, -20); assert.equal(r.data.balance, 99980)
  const liveRisk = await json(`/api/risk?environment=live&currency=INR&account=${accountIds[1]}`)
  assert.equal(liveRisk.response.status, 200)
  const lr = z.object({ data: z.object({ balance: z.null(), balanceError: z.string() }) }).parse(liveRisk.value)
  assert.match(lr.data.balanceError, /Connect and verify/i)
  const performance = await json('/api/performance?environment=testnet&currency=USDT&period=all&limit=1')
  assert.equal(performance.response.status, 200)
  const p = z.object({ environment: z.string(), currency: z.string(), data: z.object({ totalTrades: z.number(), netPnl: z.number() }), accounting: z.object({ netPnl: z.null() }) }).parse(performance.value)
  assert.equal(p.environment, 'testnet'); assert.equal(p.currency, 'USDT'); assert.equal(p.data.totalTrades, 2); assert.equal(p.data.netPnl, 27)
  const pp = await json('/api/performance?environment=paper&currency=USD&period=all')
  assert.equal(pp.response.status, 200)
  assert.equal(z.object({ data: z.object({ totalTrades: z.number(), netPnl: z.number() }) }).parse(pp.value).data.netPnl, -20)
}

async function verifyAnnotationsAndExport() {
  const fields = 'state,version,updated_at,entry_quantity,exit_quantity,entry_price,exit_price,gross_pnl,quote_fees,other_fees,residual_quantity,intents'
  const before = await db.from('broker_executions').select(fields).eq('id', testnetIds[0]).single()
  check(before.error, 'FIXTURE_FINANCIAL_READ_FAILED')
  const own = await json('/api/reporting', 0, jsonBody({ environment: 'testnet', id: testnetIds[0], notes: 'Verified annotation, "quoted"' }))
  assert.equal(own.response.status, 200)
  const cross = await json('/api/reporting', 1, jsonBody({ environment: 'testnet', id: testnetIds[0], notes: 'Must not overwrite' }))
  assert.equal(cross.response.status, 404)
  const financialAttempt = await json('/api/reporting', 0, jsonBody({ environment: 'testnet', id: testnetIds[0], notes: 'Rejected', gross_pnl: 9999 }))
  assert.equal(financialAttempt.response.status, 400)
  const after = await db.from('broker_executions').select(fields).eq('id', testnetIds[0]).single()
  check(after.error, 'FIXTURE_FINANCIAL_READ_FAILED'); assert.deepEqual(after.data, before.data)
  const csv = await request('/api/reporting?environment=testnet&currency=USDT&period=all&format=csv&limit=1&page=2')
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type') ?? '', /text\/csv/)
  const text = await csv.text()
  for (const id of testnetIds) assert.ok(text.includes('"' + id + '"'))
  for (const id of [...paperIds, liveId]) assert.equal(text.includes(id), false)
  assert.ok(text.includes('"Verified annotation, ""quoted"""'))
  const paperCsv = await request('/api/reporting?environment=paper&currency=USD&period=all&format=csv&limit=1')
  const paperText = await paperCsv.text()
  assert.equal(paperCsv.status, 200); assert.ok(paperText.includes(paperIds[1]))
  for (const id of [paperIds[0], paperIds[2], ...testnetIds, liveId]) assert.equal(paperText.includes(id), false)
}

async function verifyAlerts() {
  const outsider = await db.from('alerts').insert({ user_id: sessions[1].id, type: 'SYSTEM', title: 'Ownership fixture', message: 'Fixture only', environment: 'paper', currency: 'USD' }).select('id').single()
  check(outsider.error, 'FIXTURE_ALERT_CREATE_FAILED'); assert.ok(outsider.data)
  const own = await json('/api/alerts?environment=paper&currency=USD&limit=1')
  assert.equal(own.response.status, 200)
  const feed = alertsSchema.parse(own.value)
  assert.equal(feed.count, 2); assert.equal(feed.data.length, 1); assert.equal(feed.data[0].currency, 'USD'); assert.equal(feed.data[0].environment, 'paper')
  assert.deepEqual(new Set(feed.currencies), new Set(['USD', 'USDT', 'INR']))
  const mark = await json('/api/alerts', 0, jsonBody({ environment: 'paper', currency: 'USD', ids: [feed.data[0].id, outsider.data.id] }))
  assert.equal(mark.response.status, 200); assert.equal(z.object({ count: z.number() }).parse(mark.value).count, 1)
  const stillUnread = await db.from('alerts').select('is_read').eq('id', outsider.data.id).single()
  check(stillUnread.error, 'FIXTURE_ALERT_READ_FAILED'); assert.equal(stillUnread.data!.is_read, false)
  const all = await json('/api/alerts', 0, jsonBody({ environment: 'paper', currency: 'USD', mark_all: true }))
  assert.equal(all.response.status, 200); assert.equal(z.object({ count: z.number() }).parse(all.value).count, 1)
  const usdt = await json('/api/alerts?environment=paper&currency=USDT&unread=1')
  assert.equal(alertsSchema.parse(usdt.value).count, 2)
  for (const [environment, currency] of [['testnet', 'USDT'], ['live', 'INR']] as const) {
    const result = await json(`/api/alerts?environment=${environment}&currency=${currency}`)
    assert.equal(result.response.status, 200)
    const rows = alertsSchema.parse(result.value)
    assert.ok(rows.count > 0); assert.ok(rows.data.every(alert => alert.environment === environment && alert.currency === currency))
  }
}

async function verifyScreenshots() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64')
  const upload = (bytes: Uint8Array) => { const form = new FormData(); form.set('file', new Blob([Uint8Array.from(bytes).buffer], { type: 'image/png' }), 'fixture.png'); return form }
  for (const [environment, id, table] of [['testnet', testnetIds[0], 'broker_executions'], ['paper', paperIds[1], 'paper_trades']] as const) {
    const path = `/api/reporting/${id}/screenshot?environment=${environment}`
    const invalid = await request(path, 0, { method: 'POST', body: upload(new TextEncoder().encode('not an image')) })
    assert.equal(invalid.status, 400)
    const crossUpload = await request(path, 1, { method: 'POST', body: upload(png) })
    assert.equal(crossUpload.status, 404)
    const posted = await request(path, 0, { method: 'POST', body: upload(png) })
    // Read the stored path even when the HTTP assertion fails, for reliable cleanup.
    const stored = await db.from(table).select('screenshot_path').eq('id', id).single()
    check(stored.error, 'FIXTURE_SCREENSHOT_READ_FAILED')
    if (stored.data?.screenshot_path) screenshots.add(stored.data.screenshot_path)
    assert.equal(posted.status, 200); assert.ok(stored.data?.screenshot_path)
    assert.ok(stored.data.screenshot_path.startsWith(sessions[0].id + '/' + id + '/'))
    const own = await request(path)
    assert.equal(own.status, 302); assert.match(own.headers.get('cache-control') ?? '', /private.*no-store/)
    assert.ok(own.headers.get('location'))
    assert.equal((await request(path, 1)).status, 404)
    const publicUrl = new URL('/storage/v1/object/public/trade-screenshots/' + stored.data.screenshot_path, supabaseUrl)
    assert.notEqual((await fetch(publicUrl, { redirect: 'manual', signal: AbortSignal.timeout(15000) })).status, 200)
  }
}

async function cleanup(users: Array<{ id: string; email: string }>, knownPaths: string[]) {
  const failures: string[] = []
  for (const user of users) {
    const owner = await db.auth.admin.getUserById(user.id)
    if (owner.error || !owner.data.user) { failures.push(user.id); continue }
    if (owner.data.user.email !== user.email || owner.data.user.user_metadata.verification_fixture !== marker || !/^evo-reporting-check-[a-f0-9]+@example\.invalid$/.test(user.email)) throw new Error('FIXTURE_CLEANUP_OWNER_MISMATCH')
    const paths = new Set(knownPaths.filter(path => path.startsWith(user.id + '/')))
    for (const table of ['broker_executions', 'paper_trades'] as const) {
      const rows = await db.from(table).select('screenshot_path').eq('user_id', user.id)
      if (rows.error) { failures.push(user.id); continue }
      for (const row of rows.data ?? []) if (row.screenshot_path?.startsWith(user.id + '/')) paths.add(row.screenshot_path)
    }
    if (paths.size && (await db.storage.from('trade-screenshots').remove([...paths])).error) failures.push(user.id)
    // Alerts first: their legacy trade references must not obstruct ledger deletion.
    for (const table of ['alerts', 'execution_events', 'execution_observations', 'broker_executions', 'execution_settings', 'execution_accounts', 'paper_trades', 'webhook_logs', 'strategy_inbox', 'signals'] as const) {
      if ((await db.from(table).delete().eq('user_id', user.id)).error) failures.push(user.id)
    }
    if ((await db.auth.admin.deleteUser(user.id)).error) failures.push(user.id)
  }
  if (failures.length) {
    console.error(JSON.stringify({ cleanupFailedUserIds: [...new Set(failures)] }))
    throw new Error('REPORTING_FIXTURE_CLEANUP_FAILED')
  }
}

async function main() {
  if (process.argv.includes('--cleanup-only')) {
    const path = process.env.FIXTURE_FILE ?? retainedPath
    if (!path || !isAbsolute(path)) throw new Error('FIXTURE_FILE_REQUIRED')
    const fixture = fixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown)
    if (fixture.supabaseUrl !== supabaseUrl) throw new Error('FIXTURE_PROJECT_MISMATCH')
    await cleanup([fixture.user], fixture.screenshotPaths)
    unlinkSync(path)
    console.info('Retained reporting fixture and private screenshots removed.')
    return
  }
  try {
    await createSessions()
    await seed()
    await verifyReports()
    await verifyAnnotationsAndExport()
    await verifyAlerts()
    await verifyScreenshots()
    const inert = await db.from('broker_executions').select('state,version').eq('id', liveId).single()
    check(inert.error, 'FIXTURE_LIVE_READ_FAILED'); assert.equal(inert.data!.state, 'OPEN'); assert.equal(inert.data!.version, 0)
    if (retainedPath) {
      const user = sessions[0]
      const fixture = fixtureSchema.parse({ schema: marker, origin, supabaseUrl, createdAt: new Date().toISOString(),
        user: { id: user.id, email: user.email, password: user.password }, ids: { paper: paperIds, testnet: testnetIds, live: liveId, accounts: accountIds }, screenshotPaths: [...screenshots] })
      writeFileSync(retainedPath, JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      chmodSync(retainedPath, 0o600)
      retained = true
    }
    console.info(JSON.stringify({ result: 'Reporting deployment acceptance passed', reporting: 'environment/currency isolation, completed totals, full pagination', security: 'two-user annotations, alerts and private screenshots', brokerCalls: 0, retainedBrowserFixture: retained }))
  } finally {
    await cleanup(retained ? sessions.slice(1) : sessions, [...screenshots])
  }
}
main().catch(error => {
  // Assertions can contain session-bearing response data. Report only the failing
  // check/code and a local stack location, never credentials, cookies or signed URLs.
  if (error instanceof assert.AssertionError) console.error(JSON.stringify({ error: 'REPORTING_ACCEPTANCE_ASSERTION_FAILED', location: error.stack?.split('\n').find(line => line.includes('verify-reporting-deployment'))?.trim() }))
  else console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'REPORTING_ACCEPTANCE_FAILED')
  process.exitCode = 1
})
