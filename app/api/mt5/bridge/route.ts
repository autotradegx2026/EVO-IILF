import { createHash } from 'node:crypto'
import { z } from 'zod'
import { readWebhookBody } from '@/lib/webhook/body'
import { executionDB } from '@/lib/execution/service'
import { mt5Request } from '@/lib/execution/mt5'
import { MT5_TIMEFRAMES } from '@/lib/execution/mt5-market'
import { configFromSettings } from '@/lib/strategy/config'
import { analysisHistorySize } from '@/lib/strategy/analysis'
import { timeframeMilliseconds } from '@/lib/trading/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* AutotradeX Bridge EA endpoint. Each poll reports terminal state and receives work as text lines:
 *   ACK|id                     result stored; the EA may forget it
 *   SYM|EURUSD                 keep this symbol's specification fresh
 *   TRACK|position             report this position's deals
 *   CMD|id|kind|client|symbol|side|volume|sl|tp|position
 *   RESOLVE|id|kind|client|position|sl|tp   delivered but unreported; find the outcome in MT5 history
 *   BARS|EURUSD|15m|500|refresh   send closed bars (UTC) when a new bar closes, or now if refresh=1
 */
const n = z.number().finite()
const text = (max: number) => z.string().max(max)
const Deal = z.object({ ticket: n, order: n, entry: z.enum(['IN', 'OUT', 'INOUT', 'OUT_BY']), reason: text(16), volume: n, price: n, commission: n, swap: n, fee: n, profit: n, time: n })
const Body = z.object({
  v: z.literal(1),
  error: text(200).optional(),
  account: z.object({ login: n, server: text(120), company: text(120), trade_mode: z.enum(['DEMO', 'CONTEST', 'REAL']), margin_mode: text(20), currency: text(12),
    balance: n, equity: n, margin_free: n, leverage: n, trade_allowed: z.boolean(), connected: z.boolean(), build: n }),
  symbols: z.array(z.object({ request: text(40), resolved: text(40), base: text(12), quote: text(12), digits: n, tick_size: n, tick_value: n, contract_size: n,
    volume_min: n, volume_max: n, volume_step: n, bid: n, ask: n, margin_per_lot: n, trade_mode: n, quote_time: n })).max(40),
  results: z.array(z.object({ id: n, status: z.enum(['DONE', 'FAILED']), retcode: n, message: text(120), order: n, deal: n, position: n, price: n, volume: n })).max(40),
  positions: z.array(z.object({ id: n, symbol: text(40), open: z.boolean(), magic: z.boolean(), sl: n, tp: n, deals: z.array(Deal).max(50) })).max(100),
  candles: z.array(z.object({ request: text(40), timeframe: z.enum(Object.keys(MT5_TIMEFRAMES) as [string, ...string[]]), bars: z.array(z.array(n).length(6)).max(2000) })).max(6).default([]),
}).strict()

const iso = (seconds: number) => seconds > 0 ? new Date(seconds * 1000).toISOString() : null
const field = (v: unknown) => String(v ?? '').replace(/[|\r\n]/g, '')

export async function POST(request: Request) {
  try {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1]
    if (!token) return new Response('ERR|UNAUTHORIZED\n', { status: 401 })
    const db = executionDB()
    const hash = createHash('sha256').update(token).digest('hex')
    const found = await db.from('mt5_bridges').select('account_id').eq('token_hash', hash).maybeSingle()
    if (found.error) throw new Error('BRIDGE_LOOKUP_FAILED')
    if (!found.data) return new Response('ERR|UNAUTHORIZED\n', { status: 401 })
    const accountId = found.data.account_id
    const account = await db.from('execution_accounts').select('id,user_id,broker').eq('id', accountId).single()
    if (account.error || account.data.broker !== 'mt5') return new Response('ERR|UNAUTHORIZED\n', { status: 401 })

    const parsed = Body.safeParse(JSON.parse(await readWebhookBody(request, 1_048_576)))
    if (!parsed.success) return new Response('ERR|INVALID_BODY\n', { status: 400 })
    const body = parsed.data, now = new Date().toISOString(), lines: string[] = []

    // 1. Results: only a delivered (SENT) command can complete, and only once.
    for (const r of body.results) {
      const saved = await db.from('mt5_commands').update({ status: r.status, retcode: r.retcode, message: r.message, order_ticket: r.order || null, deal_ticket: r.deal || null,
        position_id: r.position || null, price: r.price || null, volume_done: r.volume || null, done_at: now }).eq('id', r.id).eq('account_id', accountId).eq('status', 'SENT')
      if (saved.error) throw new Error('RESULT_SAVE_FAILED')
      lines.push(`ACK|${r.id}`)
    }
    // 2. Positions and their full deal history.
    if (body.positions.length) {
      const upserted = await db.from('mt5_positions').upsert(body.positions.map(p => ({ account_id: accountId, position_id: p.id, symbol: p.symbol, open: p.open, sl: p.sl || null, tp: p.tp || null, deals: p.deals, updated_at: now })))
      if (upserted.error) throw new Error('POSITION_SAVE_FAILED')
    }
    // 3. Symbol specifications.
    if (body.symbols.length) {
      const upserted = await db.from('mt5_symbols').upsert(body.symbols.map(s => ({ account_id: accountId, request: s.request, resolved: s.resolved || null, base: s.base || null, quote: s.quote || null,
        digits: s.digits, tick_size: s.tick_size, tick_value: s.tick_value, contract_size: s.contract_size, volume_min: s.volume_min, volume_max: s.volume_max, volume_step: s.volume_step,
        bid: s.bid, ask: s.ask, margin_per_lot: s.margin_per_lot, trade_mode: s.trade_mode, quote_time: iso(s.quote_time), updated_at: now })))
      if (upserted.error) throw new Error('SYMBOL_SAVE_FAILED')
    }
    // 3b. Closed candles (UTC open time, OHLC, tick volume) for native strategy scanning.
    if (body.candles.length) {
      const upserted = await db.from('mt5_candles').upsert(body.candles.map(c => ({ account_id: accountId, request: c.request, timeframe: c.timeframe, bars: c.bars, updated_at: now })))
      if (upserted.error) throw new Error('CANDLE_SAVE_FAILED')
    }
    // 4. Positions this platform opened, for deal tracking and to detect unexplained magic positions.
    const entries = await db.from('mt5_commands').select('position_id').eq('account_id', accountId).eq('kind', 'ENTRY').eq('status', 'DONE').not('position_id', 'is', null)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('id', { ascending: false }).limit(50)
    if (entries.error) throw new Error('TRACK_READ_FAILED')
    const tracked = new Set(entries.data.map(e => Number(e.position_id)))
    const untracked = body.positions.filter(p => p.open && p.magic && !tracked.has(p.id)).length
    const a = body.account
    const bridge = await db.from('mt5_bridges').update({ login: a.login, server: a.server, company: a.company, trade_mode: a.trade_mode, margin_mode: a.margin_mode, currency: a.currency,
      balance: a.balance, equity: a.equity, margin_free: a.margin_free, leverage: a.leverage, trade_allowed: a.trade_allowed, connected: a.connected, build: a.build,
      untracked_positions: untracked, heartbeat_at: now, last_error: body.error || null }).eq('account_id', accountId)
    if (bridge.error) throw new Error('BRIDGE_SAVE_FAILED')
    for (const id of tracked) lines.push(`TRACK|${id}`)

    // 5. Symbols to keep fresh: the owner's run symbols and any symbol with live executions here.
    // Plus symbols the platform asked about in the last day (registered by the adapter).
    const [settings, active, registered] = await Promise.all([
      db.from('settings').select('*').eq('user_id', account.data.user_id).single(),
      db.from('broker_executions').select('symbol').eq('broker_account_id', accountId).not('state', 'in', '(CLOSED,REJECTED)'),
      db.from('mt5_symbols').select('request').eq('account_id', accountId).gte('updated_at', new Date(Date.now() - 86400000).toISOString()).limit(20),
    ])
    if (settings.error || active.error || registered.error) throw new Error('SYMBOL_LIST_FAILED')
    const requests = new Set([...[...(settings.data.screener_symbols ?? []), ...active.data.map(e => e.symbol)]
      .filter(s => /^[A-Z0-9_]+:[A-Z0-9._]+$/.test(s) && !/^(NSE|BSE|BINANCE):/.test(s)).map(mt5Request), ...registered.data.map(r => r.request)])
    for (const s of [...requests].slice(0, 20)) lines.push(`SYM|${field(s)}`)
    // Bars for the run's symbols at the strategy timeframe and its higher timeframe (what the scanner reads).
    const runSymbols = (settings.data.screener_symbols ?? []).filter(s => /^[A-Z0-9_]+:[A-Z0-9._]+$/.test(s) && !/^(NSE|BSE|BINANCE):/.test(s)).map(mt5Request).slice(0, 3)
    if (runSymbols.length && settings.data.screener_timeframe) {
      const config = configFromSettings(settings.data), tf = settings.data.screener_timeframe, htf = config.htfTimeframe.toLowerCase()
      const base = analysisHistorySize(config, tf)
      const needs = [[tf, base], ...(htf === tf ? [] : [[htf, Math.ceil(base * timeframeMilliseconds(tf) / timeframeMilliseconds(htf)) + config.htfEmaLength + 100]])] as [string, number][]
      const stored = await db.from('mt5_candles').select('request,timeframe,updated_at').eq('account_id', accountId)
      if (stored.error) throw new Error('CANDLE_READ_FAILED')
      for (const symbol of runSymbols) for (const [timeframe, count] of needs) {
        if (!MT5_TIMEFRAMES[timeframe]) continue
        const row = stored.data.find(r => r.request === symbol && r.timeframe === timeframe)
        const refresh = !row || Date.now() - Date.parse(row.updated_at) > 45000
        lines.push(`BARS|${field(symbol)}|${timeframe}|${Math.min(count, 2000)}|${refresh ? 1 : 0}`)
      }
    }

    // 6. Work. Follow-up commands need the entry's position; fail them if it never opened.
    const claimed = await db.rpc('mt5_claim_commands', { p_account: accountId })
    if (claimed.error) throw new Error('COMMAND_CLAIM_FAILED')
    const commands = (claimed.data ?? []) as { id: number; kind: string; client_id: string; entry_client_id: string; request: string; side: string | null; volume: number | null; sl: number | null; tp: number | null }[]
    // Delivered-but-unreported commands (EA restarted mid-command) are looked up in MT5 history.
    const stale = await db.from('mt5_commands').select('id,kind,client_id,entry_client_id,sl,tp').eq('account_id', accountId).eq('status', 'SENT')
      .lt('sent_at', new Date(Date.now() - 20000).toISOString()).limit(10)
    if (stale.error) throw new Error('STALE_READ_FAILED')
    const positions = new Map<string, number>()
    const entryIds = [...new Set([...commands, ...stale.data].filter(c => c.kind !== 'ENTRY').map(c => c.entry_client_id))]
    if (entryIds.length) {
      const opened = await db.from('mt5_commands').select('client_id,position_id').eq('account_id', accountId).in('client_id', entryIds).eq('status', 'DONE')
      if (opened.error) throw new Error('POSITION_LOOKUP_FAILED')
      for (const o of opened.data) if (o.position_id) positions.set(o.client_id, Number(o.position_id))
    }
    for (const c of commands) {
      const position = c.kind === 'ENTRY' ? 0 : positions.get(c.entry_client_id)
      if (position === undefined) {
        const failed = await db.from('mt5_commands').update({ status: 'FAILED', message: 'ENTRY_POSITION_UNKNOWN', done_at: now }).eq('id', c.id).eq('status', 'SENT')
        if (failed.error) throw new Error('RESULT_SAVE_FAILED')
        continue
      }
      lines.push(['CMD', c.id, c.kind, c.client_id, c.request, c.side ?? '', c.volume ?? 0, c.sl ?? 0, c.tp ?? 0, position].map(field).join('|'))
    }
    for (const c of stale.data) lines.push(['RESOLVE', c.id, c.kind, c.client_id, c.kind === 'ENTRY' ? 0 : positions.get(c.entry_client_id) ?? 0, c.sl ?? 0, c.tp ?? 0].map(field).join('|'))

    return new Response(`OK|${Math.floor(Date.now() / 1000)}\n${lines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
  } catch (e) {
    const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'BRIDGE_FAILED'
    return new Response(`ERR|${code}\n`, { status: e instanceof SyntaxError ? 400 : 500 })
  }
}
