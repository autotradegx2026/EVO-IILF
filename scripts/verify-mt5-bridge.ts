/* MT5 bridge acceptance on a DEMO account: entry, broker SL/TP, manual close and accounting, LONG then SHORT,
 * at the symbol's minimum volume. Runs the production engine and adapter against the live bridge; the execution
 * document is kept in memory, so nothing is written to broker_executions. Refuses REAL accounts.
 *
 *   node verify-mt5-bridge.js --place-demo-orders --account-id=UUID [--symbol=FX:EURUSD]
 */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { advanceExecution, type ExecutionStore } from '../lib/execution/engine'
import { Mt5ExecutionBroker, mt5Store } from '../lib/execution/mt5'
import { roundStep, type Execution } from '../lib/execution/model'
import type { Database } from '../types/database'

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const log = (...parts: unknown[]) => process.stdout.write(parts.join(' ') + '\n')

async function main() {
  const accountId = arg('account-id'), symbol = arg('symbol') ?? 'FX:EURUSD'
  if (!process.argv.includes('--place-demo-orders') || !accountId) throw new Error('USAGE: --place-demo-orders --account-id=UUID [--symbol=FX:EURUSD]')
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const account = await db.from('execution_accounts').select('*').eq('id', accountId).single()
  if (account.error || account.data.broker !== 'mt5' || account.data.environment !== 'testnet') throw new Error('DEMO_MT5_ACCOUNT_REQUIRED')
  const broker = new Mt5ExecutionBroker(mt5Store(db, accountId), 'testnet')
  await broker.connect() // also refuses a REAL trade mode for a testnet account
  let rules = null
  for (let i = 0; i < 30 && !rules; i++) { try { rules = await broker.instrument(symbol) } catch { await sleep(1000) } }
  if (!rules) throw new Error('SYMBOL_SPECIFICATION_UNAVAILABLE')
  log('instrument', symbol, `price=${rules.price} tick=${rules.tick} min=${rules.minQuantity} step=${rules.step} ${rules.base}/${rules.quote}`)

  let failures = 0
  for (const direction of ['LONG', 'SHORT'] as const) {
    rules = await broker.instrument(symbol)
    const sign = direction === 'LONG' ? 1 : -1, distance = roundStep(rules.price * 0.003, rules.tick)
    const quantity = rules.minQuantity, now = Date.now()
    let e: Execution = { id: randomUUID(), user_id: account.data.user_id, broker_account_id: accountId, signal_id: randomUUID(), automatic: false,
      environment: 'testnet', symbol, direction, currency: rules.quote, state: 'QUEUED', requested_quantity: quantity, signal_price: rules.price,
      stop_loss: roundStep(rules.price - sign * distance, rules.tick), take_profit: roundStep(rules.price + sign * 3 * distance, rules.tick), rr: 3,
      risk_budget: quantity * distance * 1.5, intents: [], entry_quantity: 0, exit_quantity: 0, entry_price: 0, exit_price: 0, gross_pnl: 0,
      quote_fees: 0, other_fees: {}, residual_quantity: 0, close_reason: null, error: null, closing_requested: false,
      session_start: '00:00', session_end: '00:00', session_timezone: 'Etc/UTC', deadline_at: new Date(now + 3600000).toISOString(),
      created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), version: 0 }
    const store: ExecutionStore = { save: async value => (e = structuredClone({ ...value, version: value.version + 1 })), fence: async () => {} }
    const controls = { entriesAllowed: true, maxPriceDriftBps: 100 }
    const advanceUntil = async (states: string[]) => {
      for (let i = 0; i < 30 && !states.includes(e.state); i++) {
        e = await advanceExecution(e, broker, store, controls)
        log(' ', direction, e.state, e.error ?? '')
        if (!states.includes(e.state)) await sleep(1000)
      }
    }
    log(`${direction}: entering ${quantity} units, SL ${e.stop_loss}, TP ${e.take_profit}`)
    await advanceUntil(['OPEN', 'REJECTED', 'CLOSED'])
    if (e.state !== 'OPEN') { failures++; log(`FAIL ${direction}: expected OPEN, got ${e.state} ${e.error ?? ''}`); continue }
    const entry = e.intents.find(i => i.purpose === 'ENTRY')!
    const position = await db.from('mt5_positions').select('sl,tp,open').eq('account_id', accountId).eq('position_id', Number(entry.orderId)).single()
    const protectedOk = !position.error && position.data.open && Number(position.data.sl) === e.stop_loss && Number(position.data.tp) === e.take_profit
    log(`  broker position ${entry.orderId}: SL ${position.data?.sl} TP ${position.data?.tp} -> ${protectedOk ? 'protection confirmed' : 'PROTECTION MISMATCH'}`)
    if (!protectedOk) failures++
    e.closing_requested = true
    await advanceUntil(['CLOSED'])
    if ((e as Execution).state !== 'CLOSED' || e.residual_quantity !== 0) { failures++; log(`FAIL ${direction}: expected CLOSED, got ${e.state} ${e.error ?? ''}`); continue }
    log(`  closed: entry ${e.entry_quantity}@${e.entry_price} exit ${e.exit_quantity}@${e.exit_price} gross ${e.gross_pnl.toFixed(4)} ${e.currency} fees ${e.quote_fees} ${JSON.stringify(e.other_fees)} reason ${e.close_reason}`)
  }
  log(failures ? `ACCEPTANCE FAILED (${failures})` : 'ACCEPTANCE PASSED')
  process.exit(failures ? 1 : 0)
}
main().catch(error => { log('ERROR', error instanceof Error ? error.message : String(error)); process.exit(1) })
