import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { requireAuth } from '@/lib/supabase/auth'
import { encrypt } from '@/lib/crypto'
import { readWebhookBody } from '@/lib/webhook/body'
import { executionDB,executionBroker,executionGates,AngelCredentials,BinanceCredentials,queueExecution } from '@/lib/execution/service'

const id=z.string().uuid()
const Input=z.discriminatedUnion('action',[
  z.object({action:z.literal('connect'),account_id:id.optional(),broker:z.enum(['angelone','binance']),environment:z.enum(['testnet','live']),label:z.string().trim().min(1).max(80),credentials:z.unknown()}).strict(),
  z.object({action:z.literal('verify'),account_id:id}).strict(),
  z.object({action:z.literal('configure'),account_id:id,auto_enabled:z.boolean(),max_price_drift_bps:z.number().int().min(1).max(500),symbol:z.string().trim().toUpperCase().regex(/^[A-Z0-9_&.:-]{2,50}$/).optional(),timeframe:z.enum(['1m','5m','15m','1h']).optional(),acknowledgement:z.literal('ENABLE_BROKER_AUTOMATION').optional()}).strict(),
  z.object({action:z.literal('stop')}).strict(),
  z.object({action:z.literal('close'),execution_id:id}).strict(),
  z.object({action:z.literal('execute'),account_id:id,signal_id:id,confirm:z.literal(true)}).strict(),
])
const publicColumns='id,broker,environment,label,connected,last_checked_at,error' as const
const replacementPrefix='CREDENTIAL_REPLACEMENT_IN_PROGRESS:'
const replacing=(error:string|null)=>{
  if(!error?.startsWith(replacementPrefix))return false
  const started=Number(error.slice(replacementPrefix.length).split(':')[0])
  return !Number.isFinite(started)||Date.now()-started<120000
}
const code=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_:-]{1,120}$/.test(e.message)?e.message:'AUTOMATION_REQUEST_FAILED'
const failure=(e:unknown)=> e instanceof Response?e:Response.json({error:code(e),code:code(e)},{status:400})
export async function GET(){
  try{
    const {user}=await requireAuth();const db=executionDB()
    const [accounts,settings,executions,worker,configuration]=await Promise.all([
      db.from('execution_accounts').select(publicColumns).eq('user_id',user.id).order('created_at',{ascending:false}),
      db.from('execution_settings').select('*').eq('user_id',user.id).maybeSingle(),
      db.from('broker_executions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100),
      db.from('execution_worker').select('heartbeat_at,last_error,enabled_environments').eq('name','broker').maybeSingle(),
      db.from('settings').select('kill_switch_active,signal_delivery_mode,screener_symbols,screener_timeframe,session_start,session_end,session_timezone').eq('user_id',user.id).single(),
    ])
    if(accounts.error||settings.error||executions.error||worker.error)throw new Error('AUTOMATION_DATABASE_UNAVAILABLE')
    // Global worker errors may identify another user's instrument; expose only availability globally.
    const health=worker.data?{...worker.data,last_error:worker.data.last_error?'Worker reported an issue; inspect your execution records.':null}:null
    return Response.json({data:{accounts:accounts.data.map(account=>({...account,error:account.error?.startsWith(replacementPrefix)?'CREDENTIAL_REPLACEMENT_IN_PROGRESS':account.error})),settings:settings.data??{account_id:null,auto_enabled:false,max_price_drift_bps:50},executions:executions.data,worker:health,configuration:configuration.error?null:configuration.data,gates:executionGates()}})
  }catch(e){return failure(e)}
}
export async function POST(request:Request){
  try{
    const {user}=await requireAuth();const db=executionDB()
    const parsed=Input.safeParse(JSON.parse(await readWebhookBody(request)))
    if(!parsed.success)throw new Error('INVALID_AUTOMATION_REQUEST')
    const body=parsed.data
    if(body.action==='stop'){
      const stopped=await db.rpc('stop_broker_automation',{p_user:user.id})
      if(stopped.error)throw new Error('AUTOMATION_STOP_FAILED')
      return Response.json({message:'Automatic broker entries stopped. Existing positions remain monitored.'})
    }
    if(body.action==='connect'){
      if(body.broker==='angelone'&&body.environment!=='live')throw new Error('ANGEL_HAS_NO_TESTNET_ADAPTER')
      const credentials=(body.broker==='binance'?BinanceCredentials:AngelCredentials).parse(body.credentials)
      if(body.account_id){
        const existing=await db.from('execution_accounts').select('*').eq('id',body.account_id).eq('user_id',user.id).single()
        if(existing.error||!existing.data)return Response.json({error:'BROKER_NOT_FOUND',code:'BROKER_NOT_FOUND'},{status:404})
        if(existing.data.broker!==body.broker||existing.data.environment!==body.environment)return Response.json({error:'BROKER_IDENTITY_CHANGE_FORBIDDEN',code:'BROKER_IDENTITY_CHANGE_FORBIDDEN'},{status:409})
        if(replacing(existing.data.error))return Response.json({error:'CREDENTIAL_REPLACEMENT_IN_PROGRESS',code:'CREDENTIAL_REPLACEMENT_IN_PROGRESS'},{status:409})
        const encrypted=encrypt(JSON.stringify(credentials))
        const disabled=await db.from('execution_settings').update({auto_enabled:false,updated_at:new Date().toISOString()}).eq('user_id',user.id)
        if(disabled.error)throw new Error('AUTOMATION_DISABLE_FAILED')
        const marker=`${replacementPrefix}${Date.now()}:${randomUUID()}`
        let lock=db.from('execution_accounts').update({connected:false,error:marker}).eq('id',body.account_id).eq('user_id',user.id).eq('credentials_encrypted',existing.data.credentials_encrypted)
        lock=existing.data.error===null?lock.is('error',null):lock.eq('error',existing.data.error)
        const locked=await lock.select('id').maybeSingle()
        if(locked.error||!locked.data)return Response.json({error:'BROKER_CHANGED_RETRY',code:'BROKER_CHANGED_RETRY'},{status:409})
        let completed=false
        try{
          // queue_broker_execution locks this settings row before reading the
          // connected flag. This barrier drains transactions that saw the old
          // connection, while subsequent queues see connected=false.
          const barrier=await db.from('settings').update({updated_at:new Date().toISOString()}).eq('user_id',user.id).select('id').single()
          if(barrier.error)throw new Error('EXECUTION_BARRIER_FAILED')
          const active=await db.from('broker_executions').select('id',{count:'exact',head:true}).eq('user_id',user.id).not('state','in','(CLOSED,REJECTED)')
          if(active.error)throw new Error('EXECUTION_STATUS_UNAVAILABLE')
          if((active.count??0)>0)return Response.json({error:'ACTIVE_EXECUTIONS_BLOCK_CREDENTIAL_REPLACEMENT',code:'ACTIVE_EXECUTIONS_BLOCK_CREDENTIAL_REPLACEMENT',message:'Credentials were not changed. Automatic new entries are disabled.'},{status:409})
          // Verify the encrypted candidate without replacing the old credentials
          // until authentication succeeds. This operation never submits orders.
          await executionBroker({...existing.data,label:body.label,credentials_encrypted:encrypted},true).connect()
          // Drain any prior enable request and leave automatic entries disabled
          // before reopening this account with its new verified ciphertext.
          const remainDisabled=await db.from('execution_settings').update({auto_enabled:false,updated_at:new Date().toISOString()}).eq('user_id',user.id)
          if(remainDisabled.error)throw new Error('AUTOMATION_DISABLE_FAILED')
          const saved=await db.from('execution_accounts').update({label:body.label,credentials_encrypted:encrypted,connected:true,error:null,last_checked_at:new Date().toISOString()})
            .eq('id',body.account_id).eq('user_id',user.id).eq('credentials_encrypted',existing.data.credentials_encrypted).eq('error',marker).select(publicColumns).maybeSingle()
          if(saved.error||!saved.data)throw new Error('BROKER_CHANGED_RETRY')
          completed=true
          return Response.json({data:saved.data,message:'Credentials replaced and connection verified. Automatic entries remain disabled. No order placed.'})
        }finally{
          if(!completed){
            // Keep the original ciphertext and a closed entry gate on failure.
            // The owner can verify the original account or try replacement again.
            await db.from('execution_accounts').update({connected:false,error:'CREDENTIAL_REPLACEMENT_NOT_COMPLETED'})
              .eq('id',body.account_id).eq('user_id',user.id).eq('credentials_encrypted',existing.data.credentials_encrypted).eq('error',marker)
          }
        }
      }
      const saved=await db.from('execution_accounts').insert({user_id:user.id,broker:body.broker,environment:body.environment,label:body.label,credentials_encrypted:encrypt(JSON.stringify(credentials))}).select('*').single()
      if(saved.error)throw new Error('BROKER_SAVE_FAILED')
      let error:string|null=null
      try{await executionBroker(saved.data).connect()}catch(e){error=code(e)}
      const checked=await db.from('execution_accounts').update({connected:!error,last_checked_at:new Date().toISOString(),error}).eq('id',saved.data.id).eq('user_id',user.id).eq('credentials_encrypted',saved.data.credentials_encrypted).is('error',null).select(publicColumns).single()
      if(checked.error)throw new Error('BROKER_CONNECTION_SAVE_FAILED')
      return Response.json({data:checked.data,message:error?'Credentials saved; connection check failed.':'Broker connection verified. No order placed.'})
    }
    if(body.action==='close'){
      const existing=await db.from('broker_executions').select('*').eq('id',body.execution_id).eq('user_id',user.id).single()
      if(existing.error)return Response.json({error:'EXECUTION_NOT_FOUND',code:'EXECUTION_NOT_FOUND'},{status:404})
      if(['CLOSED','REJECTED'].includes(existing.data.state))return Response.json({data:existing.data})
      const result=await db.from('broker_executions').update({closing_requested:true,close_reason:existing.data.close_reason??'MANUAL',version:existing.data.version+1}).eq('id',body.execution_id).eq('user_id',user.id).eq('version',existing.data.version).select('*').maybeSingle()
      if(result.error||!result.data)return Response.json({error:'EXECUTION_CHANGED_RETRY',code:'EXECUTION_CHANGED_RETRY'},{status:409})
      return Response.json({data:result.data,message:'Close requested. The worker will reconcile and cancel outstanding orders before closing the remaining quantity.'},{status:202})
    }
    const account=await db.from('execution_accounts').select('*').eq('id',body.account_id).eq('user_id',user.id).single()
    if(account.error)return Response.json({error:'BROKER_NOT_FOUND',code:'BROKER_NOT_FOUND'},{status:404})
    if(body.action==='verify'){
      if(replacing(account.data.error))return Response.json({error:'CREDENTIAL_REPLACEMENT_IN_PROGRESS',code:'CREDENTIAL_REPLACEMENT_IN_PROGRESS'},{status:409})
      let error:string|null=null
      try{await executionBroker(account.data,true).connect()}catch(e){error=code(e)}
      let update=db.from('execution_accounts').update({connected:!error,error,last_checked_at:new Date().toISOString()}).eq('id',body.account_id).eq('user_id',user.id).eq('credentials_encrypted',account.data.credentials_encrypted)
      update=account.data.error===null?update.is('error',null):update.eq('error',account.data.error)
      const result=await update.select(publicColumns).single()
      if(result.error)throw new Error('BROKER_CONNECTION_SAVE_FAILED')
      return Response.json({data:result.data})
    }
    if(body.action==='execute')return Response.json({data:await queueExecution(db,user.id,body.signal_id,body.account_id),message:'Queued for broker execution.'},{status:202})
    if(body.auto_enabled){
      if(!body.symbol||!body.timeframe)throw new Error('SELECT_SYMBOL_AND_TIMEFRAME_FIRST')
      if(body.acknowledgement!=='ENABLE_BROKER_AUTOMATION')throw new Error('EXPLICIT_ENABLE_REQUIRED')
      if(!account.data.connected)throw new Error('BROKER_NOT_CONNECTED')
      if(!executionGates()[account.data.environment])throw new Error('BROKER_ENVIRONMENT_DISABLED')
      const health=await db.from('execution_worker').select('*').eq('name','broker').single()
      const heartbeat=Date.parse(health.data?.heartbeat_at??'')
      if(health.error||!health.data||!Number.isFinite(heartbeat)||Date.now()-heartbeat>15000||heartbeat>Date.now()+5000||health.data.last_error||!health.data.enabled_environments.includes(account.data.environment))throw new Error('CONTINUOUS_WORKER_OFFLINE')
      const settings=await db.from('settings').select('*').eq('user_id',user.id).single()
      if(settings.error||settings.data.kill_switch_active)throw new Error('RELEASE_GLOBAL_ENTRY_PAUSE_FIRST')
      const venue=executionBroker(account.data)
      await venue.connect()
      await venue.instrument(body.symbol)
      if(!(await venue.availableQuote(body.symbol)>0))throw new Error('INSUFFICIENT_AVAILABLE_BALANCE')
    }
    const result=body.auto_enabled ? await db.rpc('start_broker_run',{p_user:user.id,p_account:body.account_id,p_symbol:body.symbol!,p_timeframe:body.timeframe!,p_drift:body.max_price_drift_bps,p_expected_credentials:account.data.credentials_encrypted}) : await db.rpc('configure_execution_settings',{p_user:user.id,p_account:body.account_id,p_auto:false,p_drift:body.max_price_drift_bps,p_expected_credentials:account.data.credentials_encrypted})
    if(result.error?.code==='P0001')return Response.json({error:result.error.message,code:'RUN_CONFIGURATION_REJECTED'},{status:409})
    if(result.error)throw new Error('AUTOMATION_SETTINGS_SAVE_FAILED')
    return Response.json({data:result.data})
  }catch(e){return failure(e)}
}
