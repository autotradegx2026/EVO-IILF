/** Places ONLY Binance Spot TESTNET orders when explicitly invoked with --place-testnet-orders.
 * Creates an isolated app fixture, exercises real market entry -> native OCO -> cancellation -> close,
 * and retains the durable ledger if reconciliation is incomplete. No production fallback exists.
 */
import { loadEnvConfig } from '@next/env'
import { randomBytes } from 'crypto'
import { existsSync,readFileSync,writeFileSync,mkdirSync } from 'fs'
import assert from 'node:assert/strict'
import { encrypt,decrypt } from '../lib/crypto'
import { executionDB,BinanceCredentials } from '../lib/execution/service'
import { BinanceExecutionBroker } from '../lib/execution/binance'
import { advanceExecution } from '../lib/execution/engine'
import { roundStep,type Execution } from '../lib/execution/model'

loadEnvConfig(process.cwd())
if(existsSync('.env.broker-testnet.local')){
  for(const line of readFileSync('.env.broker-testnet.local','utf8').split('\n')){
    const match=/^(BINANCE_TESTNET_API_KEY|BINANCE_TESTNET_API_SECRET)=([A-Za-z0-9]+)\s*$/.exec(line)
    if(match)process.env[match[1]]=match[2]
  }
}
const credentials={apiKey:process.env.BINANCE_TESTNET_API_KEY??'',apiSecret:process.env.BINANCE_TESTNET_API_SECRET??'',environment:'testnet' as const}
async function main(){
  if(!process.argv.includes('--place-testnet-orders'))throw new Error('EXPLICIT_TESTNET_FLAG_REQUIRED')
  const db=executionDB()
  const sourceId=process.argv.find(a=>a.startsWith('--account-id='))?.split('=')[1]
  if(sourceId){
    const source=await db.from('execution_accounts').select('*').eq('id',sourceId).eq('broker','binance').eq('environment','testnet').eq('connected',true).single()
    if(source.error)throw new Error('VERIFIED_TESTNET_ACCOUNT_REQUIRED')
    Object.assign(credentials,BinanceCredentials.parse(JSON.parse(decrypt(source.data.credentials_encrypted))))
  }
  if(!credentials.apiKey||!credentials.apiSecret)throw new Error('CONNECT_TESTNET_ACCOUNT_IN_DASHBOARD_FIRST')
  process.env.BROKER_TESTNET_ENABLED='true';process.env.LIVE_TRADING_ENABLED='false'
  const broker=new BinanceExecutionBroker(credentials)
  await broker.connect()
  const symbol='BINANCE:BTCUSDT',rules=await broker.instrument(symbol)
  const price=rules.price,stop=roundStep(price*.98,rules.tick),target=roundStep(price*1.06,rules.tick,'ceil')
  const balance=await broker.availableQuote(symbol)
  // Bound test exposure to <=100 virtual USDT. Exchange minimum plus fee buffer must fit.
  const quantity=roundStep(Math.max(rules.minNotional*1.5/price,rules.minQuantity),rules.step,'ceil')
  assert.ok(quantity*price<=100&&quantity*price<=balance,'Insufficient virtual balance or minimum order exceeds test cap')
  const allocatedBalance=Math.min(balance,100)
  assert.ok(quantity*Math.abs(price-stop)<=allocatedBalance*.01,'Minimum order exceeds isolated test risk budget')
  let userId:string|undefined,accountId:string|undefined,execution:Execution|undefined,lease:string|undefined
  let completed=false
  const checks:string[]=[]
  try{
    const made=await db.auth.admin.createUser({email:`evo-broker-verify-${randomBytes(8).toString('hex')}@example.invalid`,email_confirm:true,user_metadata:{full_name:'Isolated Binance testnet acceptance'}})
    if(made.error)throw new Error('TEST_USER_CREATE_FAILED');userId=made.data.user.id
    const settings=await db.from('settings').update({signal_delivery_mode:'signals',screener_symbols:[symbol],screener_timeframe:'1m',session_start:'00:00',session_end:'00:00',session_timezone:'Etc/UTC',risk_percent:1,rr_ratio:3,cooldown_bars:0}).eq('user_id',userId)
    if(settings.error)throw new Error('TEST_SETTINGS_FAILED')
    const account=await db.from('execution_accounts').insert({user_id:userId,broker:'binance',environment:'testnet',label:'Temporary testnet acceptance',credentials_encrypted:encrypt(JSON.stringify({apiKey:credentials.apiKey,apiSecret:credentials.apiSecret}))}).select('*').single()
    if(account.error)throw new Error('TEST_ACCOUNT_FAILED');accountId=account.data.id
    const connected=await db.from('execution_accounts').update({connected:true}).eq('id',accountId)
    if(connected.error)throw new Error('TEST_ACCOUNT_VERIFY_FAILED')
    const claim=await db.rpc('claim_execution_worker',{p_environments:['testnet']})
    if(claim.error||!claim.data)throw new Error('STOP_CONTINUOUS_WORKER_DURING_ISOLATED_ACCEPTANCE');lease=String(claim.data)
    const timestamp=new Date().toISOString()
    const signal=await db.from('signals').insert({user_id:userId,symbol,direction:'LONG',state:'LONG_READY',entry_price:price,stop_loss:stop,take_profit:target,confluence_score:5,rr_ratio:3,timeframe:'1m',raw_payload:{timestamp}}).select('id').single()
    if(signal.error)throw new Error('TEST_SIGNAL_FAILED')
    const queued=await db.rpc('queue_broker_execution',{p_user:userId,p_signal:signal.data.id,p_account:accountId,p_quantity:quantity,p_balance:allocatedBalance,p_stop:stop,p_target:target,p_currency:'USDT',p_deadline:new Date(Date.now()+15*60000).toISOString(),p_auto:false})
    if(queued.error)throw new Error('TEST_ENTRY_RESERVATION_FAILED')
    execution=queued.data as Execution
    checks.push('Testnet authentication, exchange rules and atomic entry reservation')
    const fence=async()=>{const r=await db.rpc('renew_execution_worker',{p_lease:lease});if(r.error||!r.data)throw new Error('WORKER_LEASE_LOST')}
    const save=async(value:Execution)=>{const r=await db.rpc('save_broker_execution',{p_lease:lease,p_id:value.id,p_version:value.version,p_document:value});if(r.error)throw new Error('TEST_LEDGER_SAVE_FAILED');return r.data as Execution}
    const advance=async()=>{await fence();execution=await advanceExecution(execution!,broker,{fence,save,authorizeEntry:async()=>true},{entriesAllowed:true,maxPriceDriftBps:50})}
    for(let i=0;i<20&&execution.state!=='OPEN';i++){await advance();if(['REJECTED','CLOSED'].includes(execution.state))break;await new Promise(r=>setTimeout(r,1500))}
    assert.equal(execution.state,'OPEN',execution.error??'Entry/protection did not settle')
    assert.ok(execution.entry_quantity>0)
    assert.equal(execution.intents.filter(i=>i.purpose==='ENTRY').length,1)
    assert.equal(execution.intents.filter(i=>i.purpose==='STOP'||i.purpose==='TARGET').length,2)
    assert.ok(execution.intents.filter(i=>i.purpose==='STOP'||i.purpose==='TARGET').every(i=>i.snapshot?.listId))
    checks.push('Actual testnet market fill and native OCO protection reconciled by permanent IDs')
    execution=await save({...execution,closing_requested:true,close_reason:'MANUAL'})
    for(let i=0;i<20&&execution.state!=='CLOSED';i++){await advance();await new Promise(r=>setTimeout(r,1500))}
    assert.equal(execution.state,'CLOSED',execution.error??'Close did not settle')
    assert.ok(execution.exit_quantity>0&&execution.exit_quantity<=execution.entry_quantity)
    assert.ok(execution.intents.filter(i=>i.purpose!=='ENTRY'&&i.state!=='REJECTED').every(i=>i.snapshot&&['FILLED','CANCELED','EXPIRED','REJECTED'].includes(i.snapshot.state)))
    checks.push('OCO cancellation confirmed before market close; fill accounting and commissions retained')
    mkdirSync('research',{recursive:true})
    writeFileSync('research/binance-testnet-acceptance.json',JSON.stringify({at:new Date().toISOString(),environment:'testnet',checks,execution},null,2)+'\n')
    completed=true;console.info(JSON.stringify({checks,residual:execution.residual_quantity,quoteFees:execution.quote_fees,grossPnL:execution.gross_pnl}))
  }finally{
    if(lease)await db.rpc('renew_execution_worker',{p_lease:lease,p_release:true,p_error:completed?null:'TESTNET_ACCEPTANCE_INCOMPLETE'})
    // Never erase the only recovery record for an uncertain or open broker position.
    if(!completed&&execution&&execution.state!=='REJECTED'){
      mkdirSync('research',{recursive:true});writeFileSync('research/binance-testnet-incomplete.json',JSON.stringify({at:new Date().toISOString(),execution},null,2)+'\n')
      console.error('TESTNET_LEDGER_RETAINED_FOR_RECONCILIATION')
    }else if(userId){
      for(const table of ['execution_events','broker_executions','execution_observations','execution_settings','execution_accounts','signals','alerts'] as const){const result=await db.from(table).delete().eq('user_id',userId);if(result.error)throw new Error('TEST_FIXTURE_CLEANUP_FAILED')}
      const removed=await db.auth.admin.deleteUser(userId);if(removed.error)throw new Error('TEST_USER_CLEANUP_FAILED')
    }
  }
}
main().catch(e=>{console.error(e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'TESTNET_ACCEPTANCE_FAILED_REVIEW_LEDGER');process.exitCode=1})
