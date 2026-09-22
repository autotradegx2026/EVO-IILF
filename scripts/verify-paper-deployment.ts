/** Isolated acceptance test. Creates two temporary users, no emails or real orders.
 * Requires service/anon keys for the deployment's project and CRON_SECRET.
 * Run only against a deployment you own. Fixture rows are removed in finally.
 */
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { randomBytes } from 'crypto'
import assert from 'node:assert/strict'
loadEnvConfig(process.cwd())
const networkFetch=globalThis.fetch
globalThis.fetch=(input,init)=>networkFetch(input,{...init,signal:init?.signal??AbortSignal.timeout(30_000)})
const origin=process.env.VERIFICATION_URL
if (!origin) throw new Error('Set VERIFICATION_URL explicitly')
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}})
const users:string[]=[]
const report:string[]=[]
function record(message:string){report.push(message);console.info(message)}
async function run(){
  const sessions: {id:string;cookie:()=>string}[]=[]
  for(let i=0;i<2;i++){
    const email=`evo-verify-${randomBytes(8).toString('hex')}@example.invalid`,password=randomBytes(24).toString('hex')
    const created=await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Temporary paper verification'}})
    if(created.error) throw new Error('TEST_USER_CREATE_FAILED')
    const id=created.data.user.id;users.push(id)
    const jar=new Map<string,string>()
    const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:c=>c.forEach(x=>jar.set(x.name,x.value))}})
    const login=await client.auth.signInWithPassword({email,password})
    if(login.error)throw new Error('TEST_SIGN_IN_FAILED')
    sessions.push({id,cookie:()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ')})
    const direct=await client.from('paper_trades').insert({user_id:id,symbol:'OANDA:EURUSD',direction:'LONG',entry_price:1.1,stop_loss:1.09,take_profit:1.13,quantity:1})
    assert.ok(direct.error,'Client must not write paper history directly')
  }
  record('Two authenticated users; direct paper writes denied')
  const api=async(path:string,method='GET',body?:unknown,who=0)=>{
    const response=await fetch(origin+path,{method,headers:{cookie:sessions[who].cookie(),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
    return {status:response.status,json:await response.json()}
  }
  const settings=await api('/api/settings','PUT',{signal_delivery_mode:'paper',screener_symbols:['OANDA:EURUSD'],screener_timeframe:'1m',session_start:'00:00',session_end:'00:00',session_timezone:'Etc/UTC',cooldown_bars:0,rr_ratio:3,kill_switch_active:false})
  assert.equal(settings.status,200,JSON.stringify(settings.json))
  const tokenResponse=await api('/api/strategy/token','POST');assert.equal(tokenResponse.status,200)
  const token=tokenResponse.json.data.token
  const end=Math.floor(Date.now()/60000)*60000
  const bar=(close:number,high:number,low:number,time:number)=>({symbol:'OANDA:EURUSD',tf:'1m',time:new Date(time-60000).toISOString(),close_time:new Date(time).toISOString(),open:1.1,high,low,close})
  const entry={symbol:'OANDA:EURUSD',action:'LONG',price:1.1,sl:1.09,tp:1.13,rr:3,confluence:5,tf:'1m',timestamp:new Date(end-60000).toISOString(),strategy_version:'evo-iilf-1.0',factors:{trend:true,vwap:true,delta:true,volume:true,sweep:true,fvg:false,ob:false}}
  const send=async(b:unknown,e:unknown=null,credential=token)=>{
    const r=await fetch(`${origin}/api/webhook/tradingview?uid=${sessions[0].id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'BAR',token:credential,strategy_version:'evo-iilf-1.0',bar:b,entry:e})})
    return {status:r.status,json:await r.json()}
  }
  const job=async()=>{
    const r=await fetch(origin+'/api/jobs/paper',{method:'POST',headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`}})
    const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data
  }
  const bad=await send(bar(1.1,1.101,1.099,end-60000),entry,'0'.repeat(64));assert.equal(bad.status,401)
  const packet=bar(1.1,1.101,1.099,end-60000)
  const first=await send(packet,entry);assert.equal(first.status,202,JSON.stringify(first.json))
  const dupe=await send(packet,entry);assert.equal(dupe.json.data.status,'DUPLICATE')
  await job()
  let history=await api('/api/paper');assert.equal(history.status,200)
  assert.equal(history.json.data.length,1);assert.equal(history.json.data[0].status,'OPEN')
  const tradeId=history.json.data[0].id
  assert.equal((await api('/api/paper','GET',undefined,1)).json.data.length,0)
  assert.equal((await api(`/api/paper/${tradeId}/close`,'POST',{close_price:1.13},1)).status,404)
  record('Token verification, queued entry, deduplication and two-user isolation passed')
  const stopped=await api('/api/settings','PUT',{kill_switch_active:true});assert.equal(stopped.status,200)
  const exit=await send(bar(1.13,1.14,1.099,end));assert.equal(exit.status,202,JSON.stringify(exit.json))
  await job()
  history=await api('/api/paper');assert.equal(history.json.data[0].status,'CLOSED');assert.equal(history.json.data[0].close_reason,'TP_HIT')
  assert.ok(Math.abs(history.json.data[0].pnl-history.json.data[0].quantity*0.03)<0.011)
  const repeat=await send(bar(1.13,1.14,1.099,end));assert.ok([200,202].includes(repeat.status));await job()
  assert.equal((await api('/api/paper')).json.data.length,1)
  record('Automatic TP, accounting, protection during kill switch and duplicate exit passed')
  const logs=await db.from('strategy_inbox').select('payload').eq('user_id',sessions[0].id)
  assert.equal(JSON.stringify(logs.data).includes(token),false)
  const unauthorized=await fetch(origin+'/api/jobs/paper',{method:'POST'});assert.equal(unauthorized.status,401)
  record('Persisted payloads contain no delivery token; worker rejects unauthenticated calls')
  const scanner=await api('/api/settings','PUT',{signal_delivery_mode:'paper',screener_symbols:['BINANCE:BTCUSDT'],screener_timeframe:'1m',session_start:'00:00',session_end:'00:00',session_timezone:'Etc/UTC',paper_auto_scan:true},1)
  assert.equal(scanner.status,200,JSON.stringify(scanner.json))
  await job()
  const scanned=await db.from('settings').select('paper_last_scan_at,paper_scan_error').eq('user_id',sessions[1].id).single()
  assert.equal(scanned.error,null)
  assert.ok(scanned.data?.paper_last_scan_at,'Scheduled Binance scan must run from the production host')
  assert.equal(scanned.data?.paper_scan_error,null)
  record('Opt-in Binance scanner fetched and evaluated real candles from the production host')
}
async function cleanup(){for(const id of users){for(const table of ['strategy_inbox','paper_trades','alerts','webhook_logs','signals']){const r=await db.from(table).delete().eq('user_id',id);if(r.error)throw new Error(`CLEANUP_FAILED_${table}`)}const r=await db.auth.admin.deleteUser(id);if(r.error)throw new Error('TEST_USER_CLEANUP_FAILED')}}
run().then(()=>console.info(JSON.stringify({checks:report}))).catch(e=>{console.error(e instanceof Error?e.message:'VERIFICATION_FAILED');process.exitCode=1}).finally(cleanup)
