import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { executionDB, executionBroker, executionGates } from '@/lib/execution/service'
import { configFromSettings } from '@/lib/strategy/config'
import { strategyMatches } from '@/lib/strategy/identity'
import { analysisHistorySize, buildStrategyAnalysis, type AnalysisData } from '@/lib/strategy/analysis'
import { canonicalSymbol, signalFresh } from '@/lib/strategy/signal-state'
import { fetchBinanceData } from '@/lib/trading/backtest'
import { timeframeMilliseconds, isWithinSession } from '@/lib/trading/session'
import { PaperBarSchema } from '@/lib/paper/exit'
import { WebhookPayloadSchema } from '@/lib/webhook/schema'
import type { Factors } from '@/lib/strategy/engine'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
const Query = z.object({symbol:z.string().trim().toUpperCase().regex(/^[A-Z0-9_&.!:-]{2,50}$/),scope:z.enum(['paper','broker']).default('broker')})

// Read-only analysis. Only the authenticated background workers dispatch orders.
export async function GET(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return Response.json({error:'Select a valid exchange-prefixed symbol.'},{status:400})
    const {scope}=parsed.data, symbol=canonicalSymbol(parsed.data.symbol), db=executionDB()
    const [saved,mode,health]=await Promise.all([
      supabase.from('settings').select('*').eq('user_id',user.id).single(),
      db.from('execution_settings').select('*').eq('user_id',user.id).maybeSingle(),
      db.from('execution_worker').select('heartbeat_at,enabled_environments').eq('name','broker').maybeSingle(),
    ])
    if (saved.error || mode.error) throw new Error('Saved trading configuration is unavailable')
    const settings=saved.data, config=configFromSettings(settings)
    const account=scope==='broker' && mode.data?.account_id ? await db.from('execution_accounts').select('*').eq('user_id',user.id).eq('id',mode.data.account_id).single() : null
    if (account?.error) throw new Error('Selected broker account is unavailable')
    const selected=account?.data
    const timeframe=scope==='paper' && settings.paper_auto_scan ? settings.paper_timeframe ?? '15m' : settings.screener_timeframe ?? '15m'
    const blockers:string[]=[]
    const enabled=scope==='paper'?!!settings.paper_trading_enabled:!!mode.data?.auto_enabled
    if (!enabled) blockers.push(scope==='paper'?'Paper trading is OFF':'Automatic broker trading is OFF')
    if(settings.kill_switch_active)blockers.push('Global entry pause is active')
    const watchlist=scope==='paper' && settings.paper_auto_scan ? settings.paper_symbols : settings.screener_symbols
    if(!watchlist?.includes(symbol))blockers.push('Symbol is not in this trading watchlist')
    if(!isWithinSession(new Date(),settings.session_start,settings.session_end,settings.session_timezone))blockers.push('Outside the saved entry session')
    if(scope==='broker') {
      if(!selected?.connected)blockers.push('Connect and verify a broker account')
      if(settings.signal_delivery_mode!=='signals')blockers.push('Select broker signal delivery in Strategy & Screener')
      if(selected && !executionGates()[selected.environment])blockers.push(`${selected.environment.toUpperCase()} execution is disabled on the server`)
      const heartbeat=Date.parse(health.data?.heartbeat_at??'')
      if(health.error || !Number.isFinite(heartbeat) || Date.now()-heartbeat>15000 || heartbeat>Date.now()+5000 || (selected && !health.data?.enabled_environments.includes(selected.environment)))blockers.push('A current worker heartbeat for this environment is required')
      if(selected?.broker==='angelone' && !/^(NSE|BSE):/.test(symbol))blockers.push('Angel One cash execution requires an NSE/BSE cash symbol')
      if(selected?.broker==='binance' && !/^BINANCE:[A-Z0-9]+USDT$/.test(symbol))blockers.push('Binance Spot execution requires a Binance USDT symbol')
    }
    const output:AnalysisData={symbol,timeframe,source:'TradingView confirmed-candle alerts',checkedAt:new Date().toISOString(),strategyUpdatedAt:settings.execution_config_updated_at??null,signal:'WAIT',fresh:false,snapshot:null,candles:[],markers:[],blockers,execution:{enabled,environment:scope==='paper'?'paper':selected?.environment??'unconnected',lastState:null,lastUpdatedAt:null}}
    if (/^BINANCE:[A-Z0-9]+USDT$/.test(symbol)) {
      const venue=selected?.broker==='binance' ? executionBroker(selected) : null
      const fetchCandles=venue && 'candles' in venue ? (tf:string,count:number,end:number)=>(venue as import('@/lib/execution/binance').BinanceExecutionBroker).candles(symbol,tf,count,end) : (tf:string,count:number,end:number)=>fetchBinanceData(symbol.slice(8),tf,count,end)
      const htf=config.htfTimeframe.toLowerCase(), count=analysisHistorySize(config,timeframe), end=Date.now()-1
      const candles=await fetchCandles(timeframe,count,end)
      const higher=htf===timeframe?candles:await fetchCandles(htf,Math.ceil(count*timeframeMilliseconds(timeframe)/timeframeMilliseconds(htf))+config.htfEmaLength+100,end)
      Object.assign(output,buildStrategyAnalysis(config,candles,higher,timeframe))
      output.source=venue?`Binance ${selected!.environment.toUpperCase()} candles`:'Binance public spot candles · analysis preview'
      if(!output.fresh)blockers.push('Waiting for a new closed candle within the five-minute entry window')
      if(output.snapshot?.direction==='SHORT' && scope==='broker' && selected?.broker==='binance')blockers.push('Binance Spot cannot open a short. SELL orders close an existing long position.')
    } else {
      const inbox=await supabase.from('strategy_inbox').select('payload,status,result,received_at').eq('user_id',user.id).or(`payload->bar->>symbol.eq.${symbol},payload->>symbol.eq.${symbol}`).order('received_at',{ascending:false}).limit(500)
      if(inbox.error)throw new Error('TradingView chart deliveries are unavailable')
      const bars = new Map<number,{bar:z.infer<typeof PaperBarSchema>;entry:ReturnType<typeof WebhookPayloadSchema.parse>|null}>()
      const entries = new Map<number,ReturnType<typeof WebhookPayloadSchema.parse>>()
      for(const row of [...inbox.data].reverse()) {
        const standalone=WebhookPayloadSchema.safeParse(row.payload)
        if(standalone.success && timeframeMilliseconds(standalone.data.tf)===timeframeMilliseconds(timeframe))entries.set(Date.parse(standalone.data.timestamp),standalone.data)
        const bar=PaperBarSchema.safeParse(row.payload.bar)
        if(!bar.success || timeframeMilliseconds(bar.data.tf)!==timeframeMilliseconds(timeframe))continue
        const entry=WebhookPayloadSchema.safeParse(row.payload.entry)
        if(entry.success)entries.set(Date.parse(entry.data.timestamp),entry.data)
        bars.set(Date.parse(bar.data.time),{bar:bar.data,entry:entry.success?entry.data:null})
      }
      const records=[...bars.values()].sort((a,b)=>Date.parse(a.bar.time)-Date.parse(b.bar.time)).slice(-80)
      output.candles=records.map(({bar})=>({time:Date.parse(bar.time),closeTime:Date.parse(bar.close_time)-1,open:bar.open,high:bar.high,low:bar.low,close:bar.close}))
      output.markers=[...entries.values()].flatMap(entry=>(entry.action==='LONG'||entry.action==='SHORT')?[{time:Date.parse(entry.timestamp),direction:entry.action,price:entry.price,sl:entry.sl,tp:entry.tp}]:[])
      const last=records.at(-1)
      const latestEntry=[...entries.values()].sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp))[0]
      const entry=latestEntry && (!last || Date.parse(latestEntry.timestamp)>=Date.parse(last.bar.close_time)) ? latestEntry : null
      output.fresh=signalFresh(entry?.timestamp??last?.bar.close_time)
      if(!last)blockers.push('No TradingView candles received for this symbol/timeframe. Install the exported strategy and enable candle alerts.')
      else if(!output.fresh)blockers.push('TradingView candle delivery is stale')
      if(entry && (entry.action==='LONG'||entry.action==='SHORT')) {
        const factors=(entry.factors??{}) as Factors
        output.signal=output.fresh?entry.action:'WAIT'
        output.snapshot={time:Date.parse(entry.timestamp)-1,direction:entry.action,qualified:true,price:entry.price,sl:entry.sl,tp:entry.tp,longScore:entry.action==='LONG'?entry.confluence:null,shortScore:entry.action==='SHORT'?entry.confluence:null,factors,longFactors:entry.action==='LONG'?factors:null,shortFactors:entry.action==='SHORT'?factors:null,reasons:[],adx:null,atr:null,vwap:null,delta:null}
        if(!strategyMatches(entry.strategy_config,config)){
          output.signal='WAIT';output.snapshot.qualified=false
          output.snapshot.reasons=['TradingView inputs do not match the saved strategy. Download the current script and recreate the alert.']
        }
      }
      output.source='TradingView exported strategy · recreate alerts after changing inputs'
    }
    if(output.snapshot && !output.snapshot.qualified)blockers.push(...output.snapshot.reasons)
    if(scope==='paper') {
      const latest=await supabase.from('paper_trades').select('status,last_checked_at,opened_at').eq('user_id',user.id).eq('symbol',symbol).order('opened_at',{ascending:false}).limit(1).maybeSingle()
      if(latest.error)blockers.push('Paper execution status unavailable')
      output.execution.lastState=latest.data?.status??null;output.execution.lastUpdatedAt=latest.data?.last_checked_at??latest.data?.opened_at??null
    } else if(selected) {
      const latest=await db.from('broker_executions').select('state,updated_at').eq('user_id',user.id).eq('broker_account_id',selected.id).eq('symbol',symbol).order('created_at',{ascending:false}).limit(1).maybeSingle()
      if(latest.error)blockers.push('Broker execution status unavailable')
      output.execution.lastState=latest.data?.state??null;output.execution.lastUpdatedAt=latest.data?.updated_at??null
    }
    output.blockers=[...new Set(blockers)]
    output.checkedAt=new Date().toISOString()
    return Response.json({data:output},{headers:{'Cache-Control':'private, no-store'}})
  } catch(error) {
    if(error instanceof Response)return error
    // Broker adapter failures must not expose decrypted credentials or request URLs.
    return Response.json({error:'Strategy analysis unavailable. Check the selected symbol, saved settings and data connection.'},{status:503})
  }
}
