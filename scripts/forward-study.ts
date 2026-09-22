/** Bounded forward PAPER observation. Public candle reads and local reports only. */
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { hostname } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CLIENT_DEFAULTS, STRATEGY_VERSION, localParts } from '../lib/strategy/config'
import { evaluateStrategy, type StrategySnapshot } from '../lib/strategy/engine'
import { fetchBinanceData, type Candle } from '../lib/trading/backtest'
import { marketDayStart } from '../lib/trading/session'
import { evaluatePaperBar, type PaperBar } from '../lib/paper/exit'

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const
const CONFIG = { ...CLIENT_DEFAULTS, sessionStart: '00:00', sessionEnd: '00:00' }
const MODEL = { strategy: STRATEGY_VERSION, config: CONFIG, pairs: PAIRS, timeframe: '1m', initialCapital: 100000, currency: 'USDT', quantityStep: 0.0001, maxTradesPerDay: 3, maxDailyLossPct: 3, maxCatchupBars: 500, baseHistoryBars: 2000, higherHistoryBars: 100 }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const MODEL_HASH = digest(MODEL)
const iso = (value: number) => new Date(value).toISOString()
const finite = z.number().finite(), timestamp = z.string().datetime()
const TradeSchema = z.object({
  id: z.string().uuid(), symbol: z.enum(PAIRS), direction: z.enum(['LONG', 'SHORT']),
  observedAt: timestamp, signal_time: timestamp, entry_price: finite.positive(), stop_loss: finite.positive(), take_profit: finite.positive(),
  quantity: finite.positive(), riskAmount: finite.positive(), initial_capital: finite.positive(),
  last_bar_at: timestamp.nullable(), mark: finite.positive(), status: z.enum(['OPEN', 'CLOSED']),
  closedAt: timestamp.nullable(), exitObservedAt: timestamp.nullable(), closePrice: finite.positive().nullable(),
  closeReason: z.enum(['SL_HIT', 'TP_HIT', 'SESSION_END']).nullable(), pnl: finite,
  session_start: z.string(), session_end: z.string(), session_timezone: z.string(),
})
type Trade = Required<z.infer<typeof TradeSchema>>
type Observation = {
  id: string; symbol: typeof PAIRS[number]; observedAt: string; signalCloseTime: string
  bar: PaperBar; inputHash: string; snapshot: StrategySnapshot
  decision: 'OPENED' | 'BLOCKED' | 'NO_SETUP' | 'WARMUP_ONLY'; reasons: string[]; tradeId: string | null
}
const StateSchema = z.object({
  format: z.literal('evo-forward-paper-v1'), modelHash: z.literal(MODEL_HASH), model: z.unknown(), startedAt: timestamp, savedAt: timestamp,
  entryHaltReason: z.string().nullable(), trades: z.array(TradeSchema),
  observations: z.array(z.object({ id: z.string(), observedAt: timestamp, signalCloseTime: timestamp }).passthrough()),
  bars: z.array(z.object({ tradeId: z.string().uuid(), observedAt: timestamp, bar: z.unknown(), exit: z.unknown() })),
  warnings: z.array(z.object({ observedAt: timestamp, code: z.string(), message: z.string() })),
  runs: z.array(z.object({ id: z.string().uuid(), startedAt: timestamp, finishedAt: timestamp.nullable(), minutes: finite.positive(), reason: z.enum(['RUNNING', 'DURATION_COMPLETE', 'INTERRUPTED', 'PROCESS_LOST']) })),
}).passthrough()
type State = z.infer<typeof StateSchema> & { observations: Observation[] }
type Dataset = { symbol: typeof PAIRS[number]; observedAt: string; candles: Candle[]; higher: Candle[] }

function options(args: string[]) {
  let minutes = 30, output = resolve('research/forward-study.json')
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--minutes') minutes = Number(args[++index])
    else if (args[index] === '--output' && args[index + 1]) output = resolve(args[++index])
    else throw new Error('Usage: forward-study.js [--minutes 30] [--output research/forward-study.json]')
  }
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('--minutes must be finite and between 1 and 1440')
  return { minutes, output }
}
async function acquireLock(output: string) {
  const path = `${output}.lock`
  try {
    const lock = JSON.parse(await readFile(path, 'utf8')) as { pid: number; host: string }
    if (!Number.isInteger(lock.pid) || lock.pid <= 0 || lock.host !== hostname()) throw new Error('Study output has an unverifiable lock; use another output path.')
    try { process.kill(lock.pid, 0); throw new Error('Another process is already writing this study.') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    await unlink(path)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname() })); await handle.sync() }
  finally { await handle.close() }
  return async () => { await unlink(path) }
}
async function save(output: string, state: State) {
  state.savedAt = iso(Date.now())
  const closed = state.trades.filter(trade => trade.status === 'CLOSED'), openTrade = state.trades.find(trade => trade.status === 'OPEN')
  const realizedPnl = closed.reduce((sum, trade) => sum + trade.pnl, 0)
  const grossProfit = closed.reduce((sum, trade) => sum + Math.max(0, trade.pnl), 0)
  const grossLoss = closed.reduce((sum, trade) => sum - Math.min(0, trade.pnl), 0)
  state.summary = { observations: state.observations.length, closedTrades: closed.length, openTrades: openTrade ? 1 : 0, realizedPnl,
    capital: MODEL.initialCapital + realizedPnl, markedUnrealizedPnl: openTrade ? (openTrade.mark - openTrade.entry_price) * openTrade.quantity * (openTrade.direction === 'LONG' ? 1 : -1) : 0,
    winRate: closed.length ? closed.filter(trade => trade.pnl > 0).length / closed.length * 100 : null,
    profitFactor: grossLoss ? grossProfit / grossLoss : null, grossProfit, grossLoss,
    note: 'Unvalidated forward paper sample. Fees excluded. Null profit factor means no realized losses; open marks can be stale.' }
  const temporary = `${output}.${process.pid}.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try { await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`); await handle.sync() }
  finally { await handle.close() }
  await rename(temporary, output)
}
function warn(state: State, code: string, message: string, observedAt: string, halt = false) {
  if (!state.warnings.some(warning => warning.code === code && warning.message === message)) state.warnings.push({ observedAt, code, message })
  if (halt && !state.entryHaltReason) state.entryHaltReason = `${code}: ${message}`
}
function paperBar(symbol: string, candle: Candle): PaperBar {
  return { symbol: `BINANCE:${symbol}`, tf: '1m', time: iso(candle.time), close_time: iso(candle.closeTime + 1), open: candle.open, high: candle.high, low: candle.low, close: candle.close }
}
function contiguous(candles: Candle[], interval: number) {
  return candles.every((candle, index) => candle.closeTime + 1 - candle.time === interval && (!index || candle.time - candles[index - 1].time === interval))
}
function replayOpen(state: State, dataset: Dataset) {
  const trade = state.trades.find(row => row.status === 'OPEN' && row.symbol === dataset.symbol) as Trade | undefined
  if (!trade) return
  const expected = Date.parse(trade.last_bar_at ?? trade.signal_time)
  const newer = dataset.candles.filter(candle => candle.closeTime + 1 > expected)
  if (!newer.length) return
  if (newer[0].time !== expected) {
    warn(state, 'MISSING_POSITION_BARS', `${trade.id} requires a candle opening ${iso(expected)}; available history starts later. Position remains unresolved.`, dataset.observedAt, true)
    return
  }
  if (newer.length > MODEL.maxCatchupBars) warn(state, 'CATCHUP_LIMIT', `${trade.id} has more than 500 unprocessed bars. New entries halted; exits replay at most 500 bars per cycle.`, dataset.observedAt, true)
  for (const candle of newer.slice(0, MODEL.maxCatchupBars)) {
    if (candle.time !== Date.parse(trade.last_bar_at ?? trade.signal_time)) {
      warn(state, 'MISSING_POSITION_BARS', `${trade.id} has a missing bar before ${iso(candle.time)}. Position remains unresolved.`, dataset.observedAt, true)
      break
    }
    const bar = paperBar(dataset.symbol, candle), exit = evaluatePaperBar(trade, bar)
    state.bars.push({ tradeId: trade.id, observedAt: dataset.observedAt, bar, exit })
    trade.last_bar_at = bar.close_time; trade.mark = bar.close
    if (exit) {
      trade.status = 'CLOSED'; trade.closedAt = bar.close_time; trade.exitObservedAt = dataset.observedAt
      trade.closePrice = exit.closePrice; trade.closeReason = exit.reason
      trade.pnl = (exit.closePrice - trade.entry_price) * trade.quantity * (trade.direction === 'LONG' ? 1 : -1)
      break
    }
  }
}
function consider(state: State, dataset: Dataset, invocationStart: number, cycleHealthy: boolean) {
  const candle = dataset.candles.at(-1)!, closeTime = candle.closeTime + 1
  const observationId = `${dataset.symbol}:${iso(closeTime)}`
  if (state.observations.some(observation => observation.id === observationId)) return
  const snapshot = evaluateStrategy(CONFIG, dataset.candles, dataset.higher).at(-1)!
  const observation: Observation = { id: observationId, symbol: dataset.symbol, observedAt: dataset.observedAt, signalCloseTime: iso(closeTime), bar: paperBar(dataset.symbol, candle), inputHash: digest({ candles: dataset.candles, higher: dataset.higher }), snapshot, decision: 'NO_SETUP', reasons: [...snapshot.reasons], tradeId: null }
  state.observations.push(observation)
  if (closeTime <= invocationStart) { observation.decision = 'WARMUP_ONLY'; observation.reasons.push('Candle closed before this invocation started; historical entries are prohibited.'); return }
  if (!snapshot.qualified || !snapshot.direction || snapshot.sl === null || snapshot.tp === null) return
  const blocks: string[] = []
  if (!cycleHealthy) blocks.push('A market-data request failed in this cycle.')
  if (state.entryHaltReason) blocks.push(state.entryHaltReason)
  if (state.trades.some(trade => trade.status === 'OPEN')) blocks.push('One portfolio position is already open.')
  if (Date.parse(dataset.observedAt) - closeTime > 90000) blocks.push('Latest candle was observed more than 90 seconds after closing.')
  const previous = state.trades.at(-1)
  if (previous && closeTime - Date.parse(previous.signal_time) < CONFIG.cooldownBars * 60000) blocks.push('Portfolio cooldown is active.')
  const dayStart = Date.parse(marketDayStart(new Date(closeTime), CONFIG.sessionTimezone))
  const closed = state.trades.filter(trade => trade.status === 'CLOSED')
  const capital = MODEL.initialCapital + closed.reduce((sum, trade) => sum + trade.pnl, 0)
  const dayCapital = MODEL.initialCapital + closed.filter(trade => Date.parse(trade.closedAt!) < dayStart).reduce((sum, trade) => sum + trade.pnl, 0)
  const dailyLoss = closed.filter(trade => Date.parse(trade.closedAt!) >= dayStart).reduce((sum, trade) => sum - Math.min(0, trade.pnl), 0)
  if (state.trades.filter(trade => Date.parse(trade.signal_time) >= dayStart).length >= MODEL.maxTradesPerDay) blocks.push('Three-trade daily limit reached.')
  if (dayCapital <= 0 || dailyLoss >= dayCapital * MODEL.maxDailyLossPct / 100) blocks.push('Three-percent daily gross-loss limit reached.')
  const risk = Math.abs(candle.close - snapshot.sl)
  const quantity = Math.floor(Math.min(capital * CONFIG.riskPct / 100 / risk, capital / candle.close) * 10000) / 10000
  if (!(quantity > 0) || !Number.isFinite(quantity) || capital <= 0) blocks.push('Insufficient capital for the fixed quantity step.')
  if (blocks.length) { observation.decision = 'BLOCKED'; observation.reasons = blocks; return }
  const trade: Trade = { id: randomUUID(), symbol: dataset.symbol, direction: snapshot.direction,
    observedAt: dataset.observedAt, signal_time: iso(closeTime), entry_price: candle.close, stop_loss: snapshot.sl, take_profit: snapshot.tp,
    quantity, riskAmount: risk * quantity, initial_capital: capital, last_bar_at: iso(closeTime), mark: candle.close, status: 'OPEN',
    closedAt: null, exitObservedAt: null, closePrice: null, closeReason: null, pnl: 0,
    session_start: CONFIG.sessionStart, session_end: CONFIG.sessionEnd, session_timezone: CONFIG.sessionTimezone }
  state.trades.push(trade); observation.decision = 'OPENED'; observation.reasons = []; observation.tradeId = trade.id
}

async function main() {
  if (process.argv.includes('--help')) { console.info('Forward PAPER study: --minutes 30 (1–1440), --output research/forward-study.json. Public data only; no broker orders.'); return }
  const { output, minutes } = options(process.argv.slice(2)), invocationStart = Date.now(), deadline = invocationStart + minutes * 60000
  await mkdir(dirname(output), { recursive: true })
  const release = await acquireLock(output)
  let stopping = false
  const stop = () => { stopping = true }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
  try {
    let state: State
    try {
      const parsed = StateSchema.parse(JSON.parse(await readFile(output, 'utf8')))
      if (parsed.trades.filter(trade => trade.status === 'OPEN').length > 1 || parsed.trades.some(trade => trade.status === 'CLOSED' && (!trade.closedAt || !trade.closeReason || trade.closePrice === null))) throw new Error('Invalid saved portfolio; refusing to resume.')
      state = parsed as unknown as State
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      state = { format: 'evo-forward-paper-v1', modelHash: MODEL_HASH, model: MODEL, startedAt: iso(invocationStart), savedAt: iso(invocationStart), entryHaltReason: null, trades: [], observations: [], bars: [], warnings: [], runs: [] }
    }
    for (const previous of state.runs) if (previous.reason === 'RUNNING') previous.reason = 'PROCESS_LOST'
    const run: State['runs'][number] = { id: randomUUID(), startedAt: iso(invocationStart), finishedAt: null, minutes, reason: 'RUNNING' }
    state.runs.push(run)
    await save(output, state)
    while (!stopping && Date.now() < deadline) {
      const cutoff = Math.floor(Date.now() / 60000) * 60000 - 1
      const results = await Promise.allSettled(PAIRS.map(async symbol => {
        const [candles, higher] = await Promise.all([fetchBinanceData(symbol, '1m', MODEL.baseHistoryBars, cutoff), fetchBinanceData(symbol, '1h', MODEL.higherHistoryBars, cutoff)])
        if (candles.length !== MODEL.baseHistoryBars || higher.length !== MODEL.higherHistoryBars || candles.at(-1)?.closeTime !== cutoff) throw new Error('Missing or stale completed candle history')
        if (!contiguous(candles, 60000) || !contiguous(higher, 3600000)) throw new Error('Non-contiguous market history')
        return { symbol, candles, higher, observedAt: iso(Date.now()) }
      }))
      const datasets: Dataset[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') datasets.push(result.value)
        else warn(state, 'DATA_UNAVAILABLE', `${PAIRS[index]}: ${result.reason instanceof Error ? result.reason.message : 'Public market data unavailable'}`, iso(Date.now()))
      })
      // Existing positions are evaluated before any new entry in the same cycle.
      for (const dataset of datasets) replayOpen(state, dataset)
      for (const dataset of datasets) consider(state, dataset, invocationStart, datasets.length === PAIRS.length && !stopping && Date.now() < deadline)
      await save(output, state)
      console.info(JSON.stringify({ observedAt: state.savedAt, pairs: datasets.length, observations: state.observations.length, trades: state.trades.length, open: state.trades.filter(trade => trade.status === 'OPEN').length, entryHalt: state.entryHaltReason, studyDay: localParts(Date.now(), CONFIG.sessionTimezone).day }))
      const next = Math.min(deadline, (Math.floor(Date.now() / 60000) + 1) * 60000 + 1500)
      while (!stopping && Date.now() < next) await new Promise(resolve => setTimeout(resolve, Math.min(1000, next - Date.now())))
    }
    run.finishedAt = iso(Date.now()); run.reason = stopping ? 'INTERRUPTED' : 'DURATION_COMPLETE'
    await save(output, state)
    console.info(`Forward PAPER observation paused. Report: ${output}`)
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
    await release()
  }
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : 'Forward study failed'); process.exitCode = 1 })
