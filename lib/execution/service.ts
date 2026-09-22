import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { decrypt } from '../crypto'
import { AngelExecutionBroker } from './angelone'
import { BinanceExecutionBroker } from './binance'
import { assertQuantity, roundStep, type Execution, type ExecutionBroker } from './model'
import { isWithinSession } from '../trading/session'
import { signalFresh } from '../strategy/signal-state'
import { localParts } from '../strategy/config'
import type { Database, Settings } from '../../types/database'

export type ExecutionAccount = Database['public']['Tables']['execution_accounts']['Row']
export type ExecutionDB = SupabaseClient<Database>
const secret=z.string().min(1).max(1024)
export const BinanceCredentials=z.object({apiKey:secret,apiSecret:secret}).strict()
export const AngelCredentials=z.object({apiKey:secret,password:secret,totpSecret:secret,clientCode:secret,localIp:z.string().ip(),publicIp:z.string().ip()}).strict()
export function executionDB(): ExecutionDB {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}})
}
export const executionGates=()=>({testnet:process.env.BROKER_TESTNET_ENABLED==='true',live:process.env.LIVE_TRADING_ENABLED==='true'})
const brokers=new Map<string,{encrypted:string;environment:string;broker:ExecutionBroker}>()
export function executionBroker(account: ExecutionAccount,refresh=false): ExecutionBroker {
  const cached=brokers.get(account.id)
  if(!refresh&&cached?.encrypted===account.credentials_encrypted&&cached.environment===account.environment)return cached.broker
  const credentials: unknown=JSON.parse(decrypt(account.credentials_encrypted))
  const broker=account.broker==='binance'
    ? new BinanceExecutionBroker({...BinanceCredentials.parse(credentials),environment:account.environment})
    : new AngelExecutionBroker(AngelCredentials.parse(credentials))
  if(brokers.size>1000)brokers.clear()
  brokers.set(account.id,{encrypted:account.credentials_encrypted,environment:account.environment,broker})
  return broker
}
export function executionDeadline(settings: Settings,broker:'angelone'|'binance',now=Date.now()): string {
  const zone=settings.session_timezone??'Asia/Kolkata'
  if (!isWithinSession(new Date(now),settings.session_start,settings.session_end,zone)) throw new Error('SESSION_CLOSED')
  let end=now+24*3600000 // explicit maximum holding window for all-day configurations
  if (settings.session_start.slice(0,5)!==settings.session_end.slice(0,5)) {
    for(let t=Math.floor(now/60000)*60000+60000;t<=end;t+=60000) if(!isWithinSession(new Date(t),settings.session_start,settings.session_end,zone)){end=t;break}
  }
  if(broker==='angelone') {
    const local=localParts(now,'Asia/Kolkata')
    const weekday=new Date(local.day+'T12:00:00Z').getUTCDay()
    // Broker-side cutoff can precede the strategy's 15:30 session. Keep an operational buffer.
    const cutoff=process.env.ANGEL_SQUARE_OFF_TIME??'15:00'
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)||cutoff>'15:00'||cutoff<'09:30')throw new Error('INVALID_ANGEL_CUTOFF')
    const dates=(process.env.ANGEL_TRADING_DATES??'').split(',').map(s=>s.trim())
    if(!dates.includes(local.day))throw new Error('ANGEL_TRADING_CALENDAR_NOT_CONFIGURED')
    if(weekday===0||weekday===6||local.clock<'09:15'||local.clock>=cutoff)throw new Error('ANGEL_SESSION_CLOSED')
    end=Math.min(end,Date.parse(`${local.day}T${cutoff}:00+05:30`))
  }
  if(end-now<60000)throw new Error('TOO_CLOSE_TO_SESSION_END')
  return new Date(end).toISOString()
}
export async function queueExecution(db:ExecutionDB,userId:string,signalId:string,accountId:string,automatic=false):Promise<Execution> {
  const [a,s,signal,cfg,worker]=await Promise.all([
    db.from('execution_accounts').select('*').eq('id',accountId).eq('user_id',userId).single(),
    db.from('settings').select('*').eq('user_id',userId).single(),
    db.from('signals').select('*').eq('id',signalId).eq('user_id',userId).single(),
    db.from('execution_settings').select('*').eq('user_id',userId).maybeSingle(),
    db.from('execution_worker').select('*').eq('name','broker').single(),
  ])
  if(a.error||s.error||signal.error||cfg.error||worker.error)throw new Error('EXECUTION_CONFIGURATION_UNAVAILABLE')
  const account=a.data,settings=s.data,setup=signal.data
  if(!account.connected)throw new Error('BROKER_NOT_CONNECTED')
  if(!executionGates()[account.environment])throw new Error('BROKER_ENVIRONMENT_DISABLED')
  if(!worker.data.heartbeat_at||!Number.isFinite(Date.parse(worker.data.heartbeat_at))||Date.now()-Date.parse(worker.data.heartbeat_at)>15000||Date.parse(worker.data.heartbeat_at)>Date.now()+5000||!worker.data.enabled_environments.includes(account.environment))throw new Error('CONTINUOUS_WORKER_OFFLINE')
  if(settings.kill_switch_active)throw new Error('EXECUTION_DISABLED')
  if(settings.signal_delivery_mode!=='signals'||!settings.screener_symbols?.includes(setup.symbol)||settings.screener_timeframe!==setup.timeframe)throw new Error('SIGNAL_CONFIGURATION_CHANGED')
  if(setup.is_executed||!['LONG_READY','SHORT_READY'].includes(setup.state)||!signalFresh(setup.received_at)||!signalFresh(String(setup.raw_payload?.timestamp ?? '')))throw new Error('SIGNAL_NOT_EXECUTABLE')
  if(settings.execution_config_updated_at && (setup.raw_payload?._execution_config_updated_at ? Date.parse(String(setup.raw_payload._execution_config_updated_at))!==Date.parse(settings.execution_config_updated_at) : Date.parse(setup.received_at)<Date.parse(settings.execution_config_updated_at)))throw new Error('STRATEGY_CHANGED_WAIT_FOR_NEW_SIGNAL')
  if(automatic&&(!cfg.data?.auto_enabled||cfg.data.account_id!==accountId))throw new Error('AUTOMATION_DISABLED')
  if(setup.raw_payload?._execution_account_id&&setup.raw_payload._execution_account_id!==accountId)throw new Error('SIGNAL_BROKER_ENVIRONMENT_MISMATCH')
  const broker=executionBroker(account)
  if(broker.longOnly&&setup.direction!=='LONG')throw new Error('BINANCE_SPOT_LONG_ONLY')
  const deadline=executionDeadline(settings,account.broker)
  await broker.connect()
  const rules=await broker.instrument(setup.symbol),balance=await broker.availableQuote(setup.symbol)
  const drift=Math.abs(rules.price-setup.entry_price)/setup.entry_price*10000
  if(drift>(cfg.data?.max_price_drift_bps??50))throw new Error('PRICE_DRIFT_EXCEEDED')
  const long=setup.direction==='LONG'
  const stop=roundStep(setup.stop_loss,rules.tick,long?'floor':'ceil')
  if(long?rules.price<=stop:rules.price>=stop)throw new Error('STOP_ALREADY_CROSSED')
  const risk=balance*settings.risk_percent/100
  const quantity=roundStep(Math.min(risk/Math.max(Math.abs(rules.price-stop),Math.abs(setup.entry_price-stop)),balance/Math.max(rules.price,setup.entry_price),rules.maxQuantity),rules.step)
  assertQuantity(quantity,rules.price,rules)
  const target=roundStep(rules.price+(long?1:-1)*Math.abs(rules.price-stop)*settings.rr_ratio,rules.tick,long?'ceil':'floor')
  const queued=await db.rpc('queue_broker_execution',{p_user:userId,p_signal:signalId,p_account:accountId,p_quantity:quantity,p_balance:balance,p_stop:stop,p_target:target,p_currency:rules.quote,p_deadline:deadline,p_auto:automatic})
  if(queued.error)throw new Error(queued.error.code==='P0001'?queued.error.message:queued.error.code==='23505'?'EXECUTION_ALREADY_RESERVED':'EXECUTION_QUEUE_FAILED')
  return queued.data as Execution
}
