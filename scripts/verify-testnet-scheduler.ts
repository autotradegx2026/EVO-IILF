/** Verifies scheduled heartbeat and that the hosted worker never manages a live account.
 * The isolated live fixture has deliberately unusable ciphertext: no broker call is possible.
 */
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import assert from 'node:assert/strict'
loadEnvConfig(process.cwd())
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}})
async function main(){
 const created=await db.auth.admin.createUser({email:`evo-scheduler-check-${randomBytes(8).toString('hex')}@example.invalid`,email_confirm:true,user_metadata:{full_name:'Isolated scheduler guard test'}})
 assert.equal(created.error,null);const uid=created.data.user!.id
 try{
  const account=await db.from('execution_accounts').insert({user_id:uid,broker:'binance',environment:'live',label:'Inert live boundary fixture',credentials_encrypted:'intentionally-not-decryptable',connected:false}).select('id').single()
  assert.equal(account.error,null)
  const signal=await db.from('signals').insert({user_id:uid,symbol:'BINANCE:BTCUSDT',direction:'LONG',state:'LONG_READY',entry_price:100,stop_loss:98,take_profit:106,confluence_score:5,rr_ratio:3,timeframe:'1m',raw_payload:{timestamp:new Date().toISOString()}}).select('id').single()
  assert.equal(signal.error,null)
  const execution=await db.from('broker_executions').insert({user_id:uid,broker_account_id:account.data!.id,signal_id:signal.data!.id,environment:'live',symbol:'BINANCE:BTCUSDT',direction:'LONG',currency:'USDT',requested_quantity:1,signal_price:100,stop_loss:98,take_profit:106,rr:3,risk_budget:10,session_start:'00:00',session_end:'00:00',session_timezone:'Etc/UTC',deadline_at:new Date(Date.now()+60000).toISOString()}).select('id').single()
  assert.equal(execution.error,null)
  let last='',changes=0
  for(let n=0;n<10;n++){
   await new Promise(r=>setTimeout(r,5000))
   const health=await db.from('execution_worker').select('heartbeat_at,enabled_environments,last_error').eq('name','broker').single()
   assert.equal(health.error,null)
   assert.deepEqual(health.data!.enabled_environments,['testnet'])
   assert.ok(Date.now()-Date.parse(health.data!.heartbeat_at)<15000,'Scheduled worker heartbeat exceeded entry freshness limit')
   assert.equal(health.data!.last_error,null)
   if(last!==health.data!.heartbeat_at){changes++;last=health.data!.heartbeat_at}
   const untouched:{data:{state:string;version:number;intents:unknown[]}|null;error:unknown}=await db.from('broker_executions').select('state,version,intents').eq('id',execution.data!.id).single()
   assert.equal(untouched.error,null);assert.equal(untouched.data!.state,'QUEUED');assert.equal(untouched.data!.version,0);assert.deepEqual(untouched.data!.intents,[])
  }
  assert.ok(changes>=5)
  console.info(JSON.stringify({result:'Scheduler acceptance passed',heartbeatChanges:changes,liveFixtureUntouched:true,brokerOrders:0}))
 }finally{
  for(const table of ['execution_events','broker_executions','execution_settings','execution_accounts','signals'])assert.equal((await db.from(table).delete().eq('user_id',uid)).error,null)
  assert.equal((await db.auth.admin.deleteUser(uid)).error,null)
 }
}
main().catch(e=>{console.error(e instanceof Error?e.message:'SCHEDULER_ACCEPTANCE_FAILED');process.exitCode=1})
