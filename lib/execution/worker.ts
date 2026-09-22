import { automaticSignalEligible, EXPECTED_ENTRY_BLOCKS } from './routing'
import { advanceExecution } from './engine'
import { executionBroker, executionGates, queueExecution, type ExecutionDB } from './service'
import type { Execution,Environment } from './model'
import { scanExecutionAccount } from './scanner'

export async function runExecutionWorker(db: ExecutionDB,allowed:Environment[]=['live','testnet']) {
  const configured=executionGates(),gates={live:configured.live&&allowed.includes('live'),testnet:configured.testnet&&allowed.includes('testnet')}
  const environments=Object.entries(gates).filter(([,v])=>v).map(([k])=>k)
  const claim=await db.rpc('claim_execution_worker',{p_environments:environments})
  if(claim.error)throw new Error('EXECUTION_WORKER_CLAIM_FAILED')
  if(!claim.data)return {status:'ALREADY_RUNNING',processed:0}
  const lease=String(claim.data),deadline=Date.now()+40000
  let processed=0,queued=0,error:string|null=null
  const fence=async()=>{const r=await db.rpc('renew_execution_worker',{p_lease:lease});if(r.error||!r.data)throw new Error('WORKER_LEASE_LOST')}
  let lostLease=false
  const heartbeat=setInterval(()=>{void fence().catch(()=>{lostLease=true})},5000)
  try {
    const active=await db.from('broker_executions').select('*').in('environment',allowed).not('state','in','(CLOSED,REJECTED)').order('updated_at').limit(20)
    if(active.error)throw new Error('EXECUTION_READ_FAILED')
    for(const row of active.data){
      if(lostLease)throw new Error('WORKER_LEASE_LOST')
      if(Date.now()>deadline)break
      await fence()
      try{
      const [account,settings,configuration,user]=await Promise.all([
        db.from('execution_accounts').select('*').eq('id',row.broker_account_id).eq('user_id',row.user_id).single(),
        db.from('settings').select('*').eq('user_id',row.user_id).single(),
        db.from('execution_settings').select('*').eq('user_id',row.user_id).maybeSingle(),
        db.from('users').select('is_active').eq('id',row.user_id).single(),
      ])
      if(account.error||settings.error||configuration.error||user.error)throw new Error('EXECUTION_ACCOUNT_READ_FAILED')
      const broker=executionBroker(account.data)
      await advanceExecution(row,broker,{
        fence,
        authorizeEntry:async value=>{
          const [fresh,latest,mode,owner,connected]=await Promise.all([
            db.from('broker_executions').select('version,closing_requested,deadline_at').eq('id',value.id).single(),
            db.from('settings').select('*').eq('user_id',value.user_id).single(),
            db.from('execution_settings').select('*').eq('user_id',value.user_id).maybeSingle(),
            db.from('users').select('is_active').eq('id',value.user_id).single(),
            db.from('execution_accounts').select('connected').eq('id',value.broker_account_id).single(),
          ])
          return !fresh.error&&!latest.error&&!mode.error&&!owner.error&&!connected.error
            &&executionGates()[value.environment]&&owner.data.is_active&&connected.data.connected
            &&fresh.data.version===value.version&&!fresh.data.closing_requested&&Date.now()<Date.parse(fresh.data.deadline_at)
            &&!latest.data.kill_switch_active&&latest.data.signal_delivery_mode==='signals'&&!!latest.data.screener_symbols?.includes(value.symbol)
            &&Date.parse(latest.data.execution_config_updated_at ?? latest.data.updated_at)<=Date.parse(value.created_at)
            &&(!value.automatic||!!mode.data?.auto_enabled&&mode.data.account_id===value.broker_account_id)
        },
        save:async value=>{
          const result=await db.rpc('save_broker_execution',{p_lease:lease,p_id:value.id,p_version:value.version,p_document:value})
          if(result.error)throw new Error(result.error.code==='P0001'?result.error.message:'EXECUTION_SAVE_FAILED')
          return result.data as Execution
        },
      },{entriesAllowed:gates[row.environment]&&user.data.is_active&&!settings.data.kill_switch_active&&account.data.connected
          &&settings.data.signal_delivery_mode==='signals'&&!!settings.data.screener_symbols?.includes(row.symbol)
          &&Date.parse(settings.data.execution_config_updated_at ?? settings.data.updated_at)<=Date.parse(row.created_at)
          &&(!row.automatic||!!configuration.data?.auto_enabled&&configuration.data.account_id===row.broker_account_id),
        maxPriceDriftBps:configuration.data?.max_price_drift_bps??50})
      processed++
      }catch(e){
        const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'BROKER_EXECUTION_UNAVAILABLE'
        if(reason==='WORKER_LEASE_LOST')throw e
        error=reason
        // Re-read after a possible partial save; never overwrite newer fills or a user's close request.
        const current=await db.from('broker_executions').select('*').eq('id',row.id).single()
        if(current.error)throw new Error('EXECUTION_READ_FAILED')
        if(!['CLOSED','REJECTED'].includes(current.data.state)){
          const marked=await db.rpc('save_broker_execution',{p_lease:lease,p_id:row.id,p_version:current.data.version,p_document:{...current.data,state:'ATTENTION',error:reason}})
          if(marked.error&&marked.error.message!=='EXECUTION_VERSION_CHANGED')throw new Error('EXECUTION_SAVE_FAILED')
        }
      }
    }
    const configs=await db.from('execution_settings').select('*').eq('auto_enabled',true).limit(20)
    if(configs.error)throw new Error('EXECUTION_SETTINGS_READ_FAILED')
    for(const cfg of configs.data){
      if(lostLease)throw new Error('WORKER_LEASE_LOST')
      if(Date.now()>deadline||!cfg.account_id)break
      const venue=await db.from('execution_accounts').select('id,broker,environment').eq('id',cfg.account_id).eq('user_id',cfg.user_id).single()
      if(venue.error){error='EXECUTION_ACCOUNT_READ_FAILED';continue}
      if(!allowed.includes(venue.data.environment))continue
      await fence()
      try{await scanExecutionAccount(db,cfg.user_id,cfg.account_id,fence,deadline)}
      catch(e){
        const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'AUTOMATION_SCAN_FAILED'
        if(reason==='WORKER_LEASE_LOST')throw e
        if(!EXPECTED_ENTRY_BLOCKS.has(reason))error=reason
      }
      const current=await db.from('settings').select('*').eq('user_id',cfg.user_id).single()
      if(current.error)throw new Error('AUTOMATION_SETTINGS_READ_FAILED')
      const signals=await db.from('signals').select('*').eq('user_id',cfg.user_id).eq('is_executed',false).in('state',['LONG_READY','SHORT_READY']).gte('received_at',new Date(Date.now()-300000).toISOString()).order('received_at',{ascending:false}).limit(50)
      if(signals.error)throw new Error('AUTOMATION_SIGNAL_READ_FAILED')
      for(const signal of signals.data.filter(value=>automaticSignalEligible(value,venue.data,current.data)).slice(0,5)) {
        if(Date.now()>deadline)break
        await fence()
        let rejection:string|null=null
        try{await queueExecution(db,cfg.user_id,signal.id,cfg.account_id,true);queued++}
        catch(e){rejection=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'AUTOMATION_ENTRY_REJECTED';if(!EXPECTED_ENTRY_BLOCKS.has(rejection))error=rejection}
        const outcome=await db.from('signals').update({raw_payload:{...signal.raw_payload,_dispatch_status:rejection?'BLOCKED':'QUEUED',_dispatch_reason:rejection,_dispatch_checked_at:new Date().toISOString(),_dispatch_account_id:cfg.account_id}}).eq('user_id',cfg.user_id).eq('id',signal.id).eq('is_executed',!rejection)
        if(outcome.error)error='DISPATCH_STATUS_SAVE_FAILED'
        if(!rejection || ['MAX_TRADES_REACHED','DAILY_LOSS_LOCKED','COOLDOWN_ACTIVE','LEGACY_EXPOSURE_REQUIRES_RECONCILIATION','AUTOMATION_DISABLED','EXECUTION_DISABLED'].includes(rejection))break
      }
    }
  }catch(e){error=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'EXECUTION_WORKER_FAILED'}
  clearInterval(heartbeat)
  const release=await db.rpc('renew_execution_worker',{p_lease:lease,p_release:true,p_error:error})
  if(release.error||!release.data)throw new Error('WORKER_LEASE_LOST')
  return {status:error?'ATTENTION':'DONE',processed,queued,error}
}
