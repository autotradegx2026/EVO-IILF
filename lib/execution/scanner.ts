import { createHash } from 'crypto'
import { configFromSettings, STRATEGY_VERSION } from '../strategy/config'
import { analysisHistorySize } from '../strategy/analysis'
import { evaluateStrategy } from '../strategy/engine'
import { timeframeMilliseconds } from '../trading/session'
import { BinanceExecutionBroker } from './binance'
import { executionBroker, executionDeadline, executionGates, type ExecutionDB } from './service'

// Each observation is recorded once per closed candle and configuration. Testnet uses its own market feed.
export async function scanExecutionAccount(db:ExecutionDB,userId:string,accountId:string,fence:()=>Promise<void>,deadline:number){
  const [account,settings]=await Promise.all([
    db.from('execution_accounts').select('*').eq('id',accountId).eq('user_id',userId).single(),
    db.from('settings').select('*').eq('user_id',userId).single(),
  ])
  if(account.error||settings.error)throw new Error('SCANNER_CONFIGURATION_UNAVAILABLE')
  if(!account.data.connected||!executionGates()[account.data.environment]||settings.data.kill_switch_active||settings.data.signal_delivery_mode!=='signals')return
  const broker=executionBroker(account.data)
  if(!(broker instanceof BinanceExecutionBroker))return // Angel receives chart alerts.
  executionDeadline(settings.data,'binance')
  const config=configFromSettings(settings.data),tf=settings.data.screener_timeframe??'15m',htf=config.htfTimeframe.toLowerCase()
  const fingerprint=createHash('sha256').update(JSON.stringify(config)).digest('hex')
  for(const symbol of (settings.data.screener_symbols??[]).filter(s=>/^BINANCE:[A-Z0-9]+USDT$/.test(s)).slice(0,5)){
    if(Date.now()>deadline)break
    await fence()
    // Use UTC minute of the expected last close to avoid repeatedly downloading the same candle.
    const boundary=Math.floor(Date.now()/timeframeMilliseconds(tf))*timeframeMilliseconds(tf)
    const previous=await db.from('execution_observations').select('id').eq('user_id',userId).eq('account_id',accountId).eq('symbol',symbol).eq('timeframe',tf).eq('bar_close',new Date(boundary).toISOString()).eq('config_hash',fingerprint).maybeSingle()
    if(previous.error)throw new Error('SCANNER_OBSERVATION_READ_FAILED')
    if(previous.data)continue
    // Include a full civil day for session VWAP, including at the 1-minute interval.
    const count=analysisHistorySize(config,tf)
    const end=Date.now()-1,candles=await broker.candles(symbol,tf,count,end)
    const higher=tf===htf?candles:await broker.candles(symbol,htf,Math.ceil(count*timeframeMilliseconds(tf)/timeframeMilliseconds(htf))+config.htfEmaLength+100,end)
    const snapshot=evaluateStrategy(config,candles,higher,tf===htf).at(-1)
    const last=candles.at(-1)
    if(!snapshot||!last)throw new Error('SCANNER_NO_CLOSED_CANDLES')
    const timestamp=new Date(last.closeTime+1).toISOString()
    if(Date.now()-Date.parse(timestamp)>300000)continue
    if(snapshot.qualified&&snapshot.direction==='LONG'&&snapshot.sl&&snapshot.tp){
      const payload={symbol,action:snapshot.direction,price:snapshot.price,sl:snapshot.sl,tp:snapshot.tp,rr:config.rrRatio,confluence:snapshot.longScore,tf,timestamp,strategy_version:STRATEGY_VERSION,_execution_config_updated_at:settings.data.execution_config_updated_at,factors:snapshot.factors,_execution_account_id:accountId,_execution_environment:account.data.environment}
      const hash=createHash('sha256').update(JSON.stringify([userId,accountId,symbol,tf,timestamp])).digest('hex')
      const stored=await db.rpc('persist_webhook',{p_user_id:userId,p_paper:false,p_payload:payload,p_hash:hash,p_state:'LONG_READY',p_quantity:null,p_risk:settings.data.risk_percent,p_ip:'broker-scanner'})
      if(stored.error&&stored.error.code!=='23505')throw new Error('SCANNER_SIGNAL_SAVE_FAILED')
    }
    // Mark observed only after durable signal intake. Retrying a failed observation is safely deduplicated above.
    const observation=await db.from('execution_observations').insert({user_id:userId,account_id:accountId,environment:account.data.environment,symbol,timeframe:tf,bar_close:timestamp,config_hash:fingerprint,config,qualified:snapshot.qualified,direction:snapshot.direction,score:Math.max(snapshot.longScore,snapshot.shortScore),price:snapshot.price,reasons:snapshot.direction==='SHORT'?[...snapshot.reasons,'SPOT_SHORT_NOT_SUPPORTED']:snapshot.reasons})
    if(observation.error&&observation.error.code!=='23505')throw new Error('SCANNER_OBSERVATION_SAVE_FAILED')
  }
}
