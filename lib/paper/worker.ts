import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, PaperTrade } from '@/types/database'
import { applyPaperBar, fetchPaperBars } from './monitor'
import { dispatchStrategyInbox } from './dispatch'
import { configFromSettings, STRATEGY_VERSION } from '../strategy/config'
import { analysisHistorySize } from '../strategy/analysis'
import { evaluateStrategy } from '../strategy/engine'
import { fetchBinanceData } from '../trading/backtest'
import { timeframeMilliseconds, isWithinSession } from '../trading/session'

export async function runPaperWorker(db: SupabaseClient<Database>) {
  const claim = await db.rpc('claim_paper_job', {})
  if (claim.error) throw new Error('WORKER_CLAIM_FAILED')
  if (!claim.data) return { status: 'ALREADY_RUNNING' }
  const lease = String(claim.data), deadline = Date.now() + 45_000
  const result: Record<string, unknown> = { status: 'DONE', monitored: 0, scanned: 0, errors: 0 }
  try {
    result.deliveries = await dispatchStrategyInbox(db)
    const open = await db.from('paper_trades').select('*').eq('status', 'OPEN').order('last_checked_at', { ascending: true, nullsFirst: true }).limit(20)
    if (open.error) throw new Error('PAPER_READ_FAILED')
    for (const trade of open.data as PaperTrade[]) {
      if (Date.now() > deadline) break
      try {
        if (trade.symbol.startsWith('BINANCE:')) {
          const bars = await fetchPaperBars(trade.symbol, trade.timeframe, Date.parse(trade.last_bar_at ?? trade.signal_time))
          for (const bar of bars) {
            if (Date.now() > deadline) break
            const mark = await applyPaperBar(db, trade.user_id, bar)
            if (mark.status === 'CLOSED' || mark.status === 'NO_OPEN_TRADE') break
          }
          if (!bars.length && Date.now() - Date.parse(trade.last_bar_at ?? trade.signal_time) > 2 * timeframeMilliseconds(trade.timeframe)) throw new Error('MARKET_DATA_STALE')
        } else if (Date.now() - Date.parse(trade.last_bar_at ?? trade.signal_time) > 2 * timeframeMilliseconds(trade.timeframe) + 120_000) {
          throw new Error('WAITING_FOR_TRADINGVIEW_BARS: keep the chart alert running for exits')
        }
        await db.from('paper_trades').update({ last_checked_at: new Date().toISOString() }).eq('id', trade.id)
        result.monitored = Number(result.monitored) + 1
      } catch (e) {
        result.errors = Number(result.errors) + 1
        await db.from('paper_trades').update({ last_checked_at: new Date().toISOString(), monitor_error: e instanceof Error ? e.message : 'MONITOR_FAILED' }).eq('id', trade.id).eq('status','OPEN')
      }
    }
    const accounts = await db.from('settings').select('*').eq('paper_auto_scan', true).eq('paper_trading_enabled', true).eq('kill_switch_active', false).order('paper_last_scan_at', { ascending: true, nullsFirst: true }).limit(5)
    if (accounts.error) throw new Error('SCAN_SETTINGS_FAILED')
    for (const settings of accounts.data) {
      if (Date.now() > deadline) break
      let error: string | null = null
      try {
        const config = configFromSettings(settings)
        {
          // Read-only observations continue outside the entry session so waiting is explainable.
          const symbols = (settings.paper_symbols ?? []).filter(s => /^BINANCE:[A-Z0-9]+USDT$/.test(s)).slice(0,5)
          for (const symbol of symbols) {
            if (Date.now() > deadline) break
            const tf = settings.paper_timeframe ?? '15m'
            let observation: import('@/types/database').PaperObservation = {user_id:settings.user_id,symbol,timeframe:tf,checked_at:new Date().toISOString(),bar_close:null,price:null,score:null,status:'ERROR',reasons:[]}
            try {
              const htf = config.htfTimeframe.toLowerCase(), end = Date.now() - 1
              const count = analysisHistorySize(config,tf)
              const candles = await fetchBinanceData(symbol.slice(8),tf,count,end)
              const higher = htf === tf ? candles : await fetchBinanceData(symbol.slice(8),htf,Math.ceil(count*timeframeMilliseconds(tf)/timeframeMilliseconds(htf))+config.htfEmaLength+100,end)
              const snapshot = evaluateStrategy(config,candles,higher,tf===htf).at(-1)
              const last = candles.at(-1)
              if (!snapshot || !last) throw new Error('NO_CLOSED_CANDLES')
              const timestamp = new Date(last.closeTime+1).toISOString()
              result.scanned=Number(result.scanned)+1
              observation = {...observation,bar_close:timestamp,price:snapshot.price,score:Math.max(snapshot.longScore,snapshot.shortScore),status:'WAIT',reasons:snapshot.reasons.length?snapshot.reasons:['No qualified directional setup']}
              observation.analysis={direction:snapshot.direction,longScore:snapshot.longScore,shortScore:snapshot.shortScore,factors:snapshot.direction?snapshot.factors:snapshot.longScore>=snapshot.shortScore?snapshot.longFactors:snapshot.shortFactors,adx:snapshot.adx,atr:snapshot.atr,minimumScore:config.minConfluenceScore,configRevision:settings.execution_config_updated_at??null}
              if (!isWithinSession(new Date(), settings.session_start, settings.session_end, settings.session_timezone)) {
                observation.reasons=['Outside the saved trading session',...snapshot.reasons.filter(reason => reason !== 'Outside strategy session')]
              } else if (Date.now()-Date.parse(timestamp)>300_000) {
                observation.status='WAIT'
                observation.reasons=[Date.now()-Date.parse(timestamp)>2*timeframeMilliseconds(tf)?'Market candles are stale; no new entry submitted':'Waiting for the next candle close; this candle is outside the five-minute entry window',...snapshot.reasons]
              } else if (snapshot.qualified && snapshot.direction && snapshot.sl && snapshot.tp) {
                const payload = { symbol, action:snapshot.direction, price:snapshot.price, sl:snapshot.sl, tp:snapshot.tp, confluence:snapshot.direction==='LONG'?snapshot.longScore:snapshot.shortScore, rr:config.rrRatio, tf, timestamp, factors:snapshot.factors, strategy_version:STRATEGY_VERSION,_execution_config_updated_at:settings.execution_config_updated_at }
                const hash = createHash('sha256').update(JSON.stringify([settings.user_id,true,symbol,payload.action,payload.price,timestamp])).digest('hex')
                const existing = await db.from('paper_trades').select('id').eq('user_id',settings.user_id).eq('payload_hash',hash).maybeSingle()
                if (existing.error) throw new Error('PAPER_HISTORY_UNAVAILABLE')
                if (existing.data) { observation.status='RECORDED'; observation.reasons=['A paper entry for this candle is already recorded'] }
                else {
                  const stored = await db.rpc('persist_webhook',{p_user_id:settings.user_id,p_paper:true,p_payload:payload,p_hash:hash,p_state:`${payload.action}_READY`,p_quantity:null,p_risk:settings.risk_percent,p_ip:'paper-scanner'})
                  observation.status=stored.error?(stored.error.code==='23505'?'RECORDED':'BLOCKED'):'OPENED'
                  observation.reasons=[stored.error?(stored.error.code==='23505'?'Entry already recorded':stored.error.code==='P0001'?stored.error.message:'Paper entry could not be saved'):'Qualified setup opened a simulated paper trade']
                  if (stored.error && !['23505','P0001'].includes(stored.error.code)) error='SCAN_PERSISTENCE_FAILED'
                }
              }
            } catch (e) {
              error=e instanceof Error?e.message:'SCAN_FAILED'
              observation={...observation,status:'ERROR',reasons:[error]}
            }
            const saved = await db.from('paper_observations').upsert(observation,{onConflict:'user_id,symbol,timeframe'})
            if (saved.error) error='SCAN_OBSERVATION_SAVE_FAILED'
          }
        }
      } catch (e) { error=e instanceof Error?e.message:'SCAN_FAILED' }
      await db.from('settings').update({paper_last_scan_at:new Date().toISOString(),paper_scan_error:error}).eq('user_id',settings.user_id)
      if (error) result.errors=Number(result.errors)+1
    }
  } catch (e) { result.status='FAILED'; result.error=e instanceof Error?e.message:'WORKER_FAILED' }
  const finish=await db.from('automation_runs').update({last_finished_at:new Date().toISOString(),result,lease_until:null}).eq('name','paper').eq('lease_id',lease)
  if (finish.error) throw new Error('WORKER_ACK_FAILED')
  return result
}
