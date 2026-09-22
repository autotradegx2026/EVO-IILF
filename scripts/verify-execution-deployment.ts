/** Authenticated hosted acceptance. Uses isolated fake credentials; never calls a broker. */
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { randomBytes } from 'crypto'
import assert from 'node:assert/strict'
loadEnvConfig(process.cwd())
const origin=process.env.VERIFICATION_URL
if(!origin)throw new Error('VERIFICATION_URL_REQUIRED')
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}})
const ids:string[]=[]
async function run(){
 const sessions:{id:string;cookie:()=>string}[]=[]
 for(let n=0;n<2;n++){
  const email=`evo-execution-check-${randomBytes(8).toString('hex')}@example.invalid`,password=randomBytes(24).toString('hex')
  const made=await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Execution acceptance fixture'}})
  if(made.error)throw new Error('FIXTURE_CREATE_FAILED');ids.push(made.data.user.id)
  const jar=new Map<string,string>()
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:c=>c.forEach(v=>jar.set(v.name,v.value))}})
  assert.equal((await client.auth.signInWithPassword({email,password})).error,null)
  sessions.push({id:made.data.user.id,cookie:()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ')})
  assert.ok((await client.from('execution_accounts').select('*')).error,'Browser role cannot read encrypted credentials')
 }
 const api=async(body?:unknown,who=0)=>{
  const response=await fetch(origin+'/api/automation',{method:body?'POST':'GET',headers:{cookie:sessions[who].cookie(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})
  return {status:response.status,json:await response.json()}
 }
 const empty=await api();assert.equal(empty.status,200);assert.equal(empty.json.data.settings.auto_enabled,false);assert.equal(empty.json.data.accounts.length,0)
 const inserted=await db.from('execution_accounts').insert({user_id:ids[0],broker:'binance',environment:'testnet',label:'Isolated disconnected fixture',credentials_encrypted:'not-a-real-secret',connected:false}).select('id').single()
 assert.equal(inserted.error,null);const account=inserted.data!.id
 const listed=await api();assert.equal(listed.json.data.accounts.length,1)
 assert.equal(JSON.stringify(listed.json).includes('not-a-real-secret'),false)
 assert.equal(Object.hasOwn(listed.json.data.accounts[0],'credentials_encrypted'),false)
 assert.equal((await api(undefined,1)).json.data.accounts.length,0)
 assert.equal((await api({action:'configure',account_id:account,auto_enabled:false,max_price_drift_bps:50},1)).status,404)
 const configure={action:'configure',account_id:account,auto_enabled:true,max_price_drift_bps:50,symbol:'BINANCE:BTCUSDT',timeframe:'15m'}
 assert.equal((await api(configure)).json.code,'EXPLICIT_ENABLE_REQUIRED')
 assert.equal((await api({...configure,acknowledgement:'ENABLE_BROKER_AUTOMATION'})).json.code,'BROKER_NOT_CONNECTED')
 assert.equal((await api({...configure,auto_enabled:false})).status,200)
 assert.equal((await api({action:'close',execution_id:account},1)).status,404)
 const replacement={action:'connect',account_id:account,broker:'binance',environment:'testnet',label:'Replacement fixture',credentials:{apiKey:'fixture-only',apiSecret:'fixture-only'}}
 assert.equal((await api(replacement,1)).status,404)
 assert.equal((await api({...replacement,environment:'live'})).json.code,'BROKER_IDENTITY_CHANGE_FORBIDDEN')
 const signal=await db.from('signals').insert({user_id:ids[0],symbol:'BINANCE:BTCUSDT',direction:'LONG',state:'LONG_READY',entry_price:100,stop_loss:98,take_profit:106,confluence_score:5,rr_ratio:3,timeframe:'1m',raw_payload:{timestamp:new Date().toISOString()}}).select('id').single()
 assert.equal(signal.error,null)
 const pending=await db.from('broker_executions').insert({user_id:ids[0],broker_account_id:account,signal_id:signal.data!.id,environment:'testnet',symbol:'BINANCE:BTCUSDT',direction:'LONG',currency:'USDT',requested_quantity:1,signal_price:100,stop_loss:98,take_profit:106,rr:3,risk_budget:10,session_start:'00:00',session_end:'00:00',session_timezone:'Etc/UTC',deadline_at:new Date(Date.now()+60000).toISOString()})
 assert.equal(pending.error,null)
 assert.equal((await api(replacement)).json.code,'ACTIVE_EXECUTIONS_BLOCK_CREDENTIAL_REPLACEMENT')
 assert.equal((await db.from('execution_accounts').select('credentials_encrypted').eq('id',account).single()).data!.credentials_encrypted,'not-a-real-secret')
 assert.equal((await api({action:'connect',broker:'angelone',environment:'testnet',label:'Invalid',credentials:{}})).json.code,'ANGEL_HAS_NO_TESTNET_ADAPTER')
 const unauth=await fetch(origin+'/api/automation',{redirect:'manual'});assert.ok([401,307].includes(unauth.status))
 const job=await fetch(origin+'/api/jobs/execution',{method:'POST'});assert.equal(job.status,401)
 console.info('Hosted execution acceptance passed: two-user ownership, credential non-disclosure, default-off, explicit enable, disconnected broker rejection, authenticated worker endpoint. No broker orders placed.')
}
run().catch(e=>{console.error(e instanceof Error?e.message:'ACCEPTANCE_FAILED');process.exitCode=1}).finally(async()=>{
 for(const id of ids){
  for(const table of ['execution_events','broker_executions','execution_settings','execution_accounts','signals'])assert.equal((await db.from(table).delete().eq('user_id',id)).error,null)
  assert.equal((await db.auth.admin.deleteUser(id)).error,null)
 }
})
