'use client'

import { useEffect,useState,useRef } from 'react'
import Link from 'next/link'
import { Area,AreaChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis,Bar,BarChart } from 'recharts'
import type { ReportData } from '@/lib/reporting/service'
import type { LedgerEnvironment } from '@/lib/reporting/model'
import { LedgerNotes } from './ledger-notes'

const DEMO=process.env.NEXT_PUBLIC_DEMO_MODE==='true'
const input='rounded-md border border-border bg-background px-3 py-2 text-sm'
const button=input+' disabled:cursor-not-allowed disabled:opacity-40'
const number=(n:number|null|undefined)=>n===null||n===undefined?'Unavailable':n.toLocaleString('en-IN',{maximumFractionDigits:8})
const titles={analytics:'Analytics',risk:'Risk & Controls',journal:'Trade Journal'}

export function LedgerDashboard({view}:{view:'analytics'|'risk'|'journal'}){
 const [environment,setEnvironment]=useState<LedgerEnvironment>('paper'),[currency,setCurrency]=useState(''),[account,setAccount]=useState('')
 const [period,setPeriod]=useState('all'),[symbol,setSymbol]=useState(''),[direction,setDirection]=useState(''),[status,setStatus]=useState('')
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1),[nonce,setNonce]=useState(0)
 const [data,setData]=useState<ReportData|null>(null),[loading,setLoading]=useState(!DEMO),[error,setError]=useState(''),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[expanded,setExpanded]=useState<string|null>(null)
 const previousQuery=useRef('')
 const [accountOptions,setAccountOptions]=useState<ReportData['accounts']>([]),[currencyOptions,setCurrencyOptions]=useState<string[]>([])
 const refresh=()=>setNonce(n=>n+1)
 const params=new URLSearchParams({environment,view,period,page:String(page),limit:'20'})
 if(currency)params.set('currency',currency)
 if(account)params.set('account',account)
 if(symbol)params.set('symbol',symbol)
 if(direction)params.set('direction',direction)
 if(status)params.set('status',status)
 if(from)params.set('from',new Date(from+'T00:00:00Z').toISOString())
 if(to)params.set('to',new Date(to+'T23:59:59.999Z').toISOString())
 const query=params.toString()
 useEffect(()=>{
  if(DEMO)return
  const controller=new AbortController()
  setLoading(true);setError('')
  if(previousQuery.current!==query){setData(null);previousQuery.current=query}
  let pending=false
  const load=async()=>{
   if(pending)return
   pending=true
   const requestController=new AbortController(),abort=()=>requestController.abort()
   controller.signal.addEventListener('abort',abort,{once:true})
   const timeout=setTimeout(abort,25000)
   try{
    const response=await fetch('/api/reporting?'+query,{cache:'no-store',signal:requestController.signal}),body=await response.json()
    if(!response.ok)throw new Error(body.error??'REPORT_UNAVAILABLE')
    if(!controller.signal.aborted){setData(body.data);setAccountOptions(body.data.accounts);setCurrencyOptions(body.data.currencies);setError('')}
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'REPORT_UNAVAILABLE')}
   finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',abort);pending=false;if(!controller.signal.aborted)setLoading(false)}
  }
  void load()
  const timer=setInterval(()=>void load(),15000)
  return()=>{controller.abort();clearInterval(timer)}
 },[query,nonce])
 const money=(n:number|null|undefined)=>`${number(n)} ${data?.currency??currency??''}`
 const date=(s:string|null)=>s?new Date(s).toLocaleString('en-IN',{timeZone:data?.timezone??'Asia/Kolkata'}):'—'
 const metric=data?.summary.metrics
 async function toggleKill(){
  if(!data||DEMO)return
  setSaving(true);setMessage('')
  try{
   const response=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({kill_switch_active:!data.risk.killSwitch})}),body=await response.json()
   if(!response.ok)throw new Error(body.error??'CONTROL_SAVE_FAILED')
   setMessage(body.data.kill_switch_active?'New entries stopped across all environments. Existing protection and close management continue.':'Kill switch released. Broker automation still requires its separate explicit enable setting.');refresh()
  }catch(e){setError(e instanceof Error?e.message:'CONTROL_SAVE_FAILED')}
  finally{setSaving(false)}
 }
 async function exportCsv(){
  setSaving(true)
  try{
   const response=await fetch('/api/reporting?'+query+'&format=csv',{cache:'no-store'})
   if(!response.ok)throw new Error('EXPORT_FAILED')
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a')
   link.href=url;link.download=`autotradex-${environment}-${data?.currency??'ledger'}.csv`;link.click();URL.revokeObjectURL(url)
  }catch(e){setError(e instanceof Error?e.message:'EXPORT_FAILED')}
  finally{setSaving(false)}
 }
 return <div className="mx-auto flex max-w-7xl flex-col gap-6">
  <header><p className="text-xs font-semibold uppercase tracking-widest text-blue-500">AutotradeX · Trading records</p><h1 className="mt-1 text-2xl font-bold">{titles[view]}</h1><p className="mt-2 text-sm text-muted-foreground">Paper, testnet and live records remain separate. Amounts use the selected quote currency; currencies are never converted or combined.</p></header>
  {DEMO&&<p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm">Read-only demo preview. Sign in to the deployed app for saved records and controls. No trading results are simulated on this page.</p>}
  <section className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-5" aria-label="Report filters">
   <label className="flex flex-col gap-1 text-xs">Environment<select className={input} value={environment} onChange={e=>{setEnvironment(e.target.value as LedgerEnvironment);setCurrency('');setAccount('');setAccountOptions([]);setCurrencyOptions([]);setPage(1);setExpanded(null)}}><option value="paper">Paper</option><option value="testnet">Testnet</option><option value="live">Live</option><option value="legacy">Earlier manual ledger</option></select></label>
   <label className="flex flex-col gap-1 text-xs">Currency<select className={input} value={currency||data?.currency||''} onChange={e=>{setCurrency(e.target.value);setPage(1)}}><option value="">Automatic selection</option>{currencyOptions.map(c=><option key={c}>{c}</option>)}{currency&&!currencyOptions.includes(currency)&&<option>{currency}</option>}</select></label>
   {(environment==='live'||environment==='testnet')&&<label className="flex flex-col gap-1 text-xs">Account<select className={input} disabled={loading} value={account} onChange={e=>{setAccount(e.target.value);setCurrency('');setPage(1)}}><option value="">All accounts</option>{accountOptions.map(a=><option key={a.id} value={a.id}>{a.label}{a.connected?'':' · disconnected'}</option>)}</select></label>}
   {view!=='risk'&&<label className="flex flex-col gap-1 text-xs">Period<select className={input} value={period} onChange={e=>{setPeriod(e.target.value);setPage(1)}}><option value="all">All time</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="90d">90 days</option></select></label>}
   <button className={button} disabled={DEMO||loading} onClick={refresh}>Refresh</button>
   {view==='journal'&&<button className={button} disabled={DEMO||!data||loading||saving||!!error} onClick={()=>void exportCsv()}>Export filtered CSV</button>}
  </section>
  {view==='journal'&&<div className="flex flex-wrap items-end gap-3">
   <label className="flex flex-col gap-1 text-xs">Symbol<input className={input} value={symbol} maxLength={50} placeholder="Filter symbol" onChange={e=>{setSymbol(e.target.value);setPage(1)}} /></label>
   <label className="flex flex-col gap-1 text-xs">Direction<select className={input} value={direction} onChange={e=>{setDirection(e.target.value);setPage(1)}}><option value="">All directions</option><option>LONG</option><option>SHORT</option></select></label>
   <label className="flex flex-col gap-1 text-xs">Status<select className={input} value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">All statuses</option>{['QUEUED','ENTERING','PROTECTING','OPEN','CLOSING','CLOSED','ATTENTION','REJECTED','PARTIAL','PENDING'].map(s=><option key={s}>{s}</option>)}</select></label>
   <label className="flex flex-col gap-1 text-xs">Opened from (UTC)<input type="date" className={input} value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}} /></label><label className="flex flex-col gap-1 text-xs">Opened through (UTC)<input type="date" className={input} value={to} onChange={e=>{setTo(e.target.value);setPage(1)}} /></label>
  </div>}
  {loading&&<p role="status" className="text-sm text-muted-foreground">Loading {environment} records…</p>}
  {error&&<p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">{error}. Displayed data may be stale. <button className="underline" onClick={refresh}>Retry</button></p>}
  {message&&<p role="status" className="rounded-lg bg-blue-500/10 p-4 text-sm">{message}</p>}
  {data&&<>
   <p className="text-xs text-muted-foreground">{environment.toUpperCase()} · {data.currency} · Updated {date(data.asOf)} · Dates displayed in {data.timezone}. {environment==='legacy'?'Historical records did not store a verified currency; UNKNOWN is not INR or USD.':''}</p>
   {view==='analytics'&&metric&&<>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
     ['Completed-trade gross PnL',money(data.summary.grossPnl)],['Recorded quote fees',money(data.summary.quoteFees)],['PnL after recorded quote fees',money(data.summary.accountedPnl)],['Fully accounted net PnL',money(data.summary.netPnl)],
     ['Completed trades',String(metric.totalTrades)],['Win rate',metric.totalTrades?number(metric.winRate)+'%':'No completed trades'],['Profit factor',metric.totalTrades?(metric.profitFactor===null?'No realized losses':number(metric.profitFactor)):'No completed trades'],['Maximum PnL drawdown',metric.totalTrades ? money(metric.maxDrawdownAmount) : 'No completed trades'],
    ].map(([label,value])=><div key={label} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>)}</div>
    <p className="text-sm text-muted-foreground">{data.summary.feeNotes.join(' · ')||'No accounting history in this selection.'} Other-asset fees: {Object.entries(data.summary.otherFees).map(([a,n])=>number(n)+' '+a).join(', ')||'none recorded'}. Totals, trade statistics and charts include completed, fully exited workflows only. Partial-exit PnL remains visible as cumulative realized amounts in the Journal. {data.summary.unsettled} workflow(s) remain unresolved or hold residual inventory.</p>
    <div className="grid gap-6 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-5 font-semibold">Cumulative completed-trade PnL · {data.currency}</h2>{metric.equityCurve.length?<ResponsiveContainer width="100%" height={260}><AreaChart data={metric.equityCurve}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={v=>new Date(v).toLocaleDateString('en-IN',{timeZone:data.timezone})} /><YAxis /><Tooltip formatter={value=>money(Number(value))} labelFormatter={v=>date(String(v))} /><Area type="stepAfter" dataKey="cumulative" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15}/></AreaChart></ResponsiveContainer>:<p className="text-sm text-muted-foreground">No completed trades in this period.</p>}</section><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-5 font-semibold">Monthly completed-trade PnL · {data.currency}</h2>{data.summary.monthly.length?<ResponsiveContainer width="100%" height={260}><BarChart data={data.summary.monthly}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month"/><YAxis/><Tooltip formatter={value=>money(Number(value))}/><Bar dataKey="net_pnl" fill="#3b82f6"/></BarChart></ResponsiveContainer>:<p className="text-sm text-muted-foreground">No completed trades in this period.</p>}</section></div>
    <p className="text-xs text-muted-foreground">This is a PnL series, not verified account equity. Drawdown percentage is unavailable without an audited equity history. Paper statistics exclude execution costs.</p>
   </>}
   {view==='risk'&&<>
    <section className="rounded-xl border border-border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Global kill switch: {data.risk.killSwitch?'ACTIVE':'released'}</h2><p className="mt-2 text-sm text-muted-foreground">Stops new entries across paper, testnet and live. Existing protection and closing continue.</p></div><button className={button} disabled={saving||!!error} onClick={()=>void toggleKill()}>{data.risk.killSwitch?'Release kill switch':'Stop new entries'}</button></div></section>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Risk per entry',number(data.risk.riskPercent)+'%'],['Trades today / limit',data.risk.todayTrades+' / '+data.risk.maxTradesPerDay],['Loss counted by entry gate',money(data.risk.dailyLoss)],['Daily loss budget',money(data.risk.lossBudget)],['Available quote balance',money(data.risk.balance)],['Open / residual workflows',String(data.risk.openAcrossCurrencies)],['Cooldown ends',data.risk.cooldownUntil?date(data.risk.cooldownUntil):'No prior entry'],['Entry-limit status',data.risk.killSwitch?'Kill switch active':data.risk.todayTrades>=data.risk.maxTradesPerDay?'Trade limit reached':data.risk.lossBudget!==null&&data.risk.dailyLoss!==null&&data.risk.dailyLoss>=data.risk.lossBudget?'Daily loss locked':data.risk.cooldownUntil&&Date.parse(data.risk.cooldownUntil)>Date.now()?'Cooldown active':'Additional execution checks apply']].map(([label,value])=><div key={label} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-base font-semibold">{value}</p></div>)}</div>
    <p className="text-sm text-muted-foreground">{data.risk.scope}</p>{data.risk.balanceError&&<p role="status" className="rounded-lg bg-amber-500/10 p-4 text-sm">{data.risk.balanceError} <Link href="/broker" className="underline">Broker API Settings</Link></p>}
    <p className="text-xs text-muted-foreground">{environment === 'paper' ? 'Simulated equity calculated' : 'Broker balance checked'}: {date(data.risk.balanceAt)}. {environment === 'paper' && 'Paper equity starts at 100,000 simulated units per quote currency.'} This page never submits broker orders. Edit limits in <Link href="/settings" className="underline">Strategy Settings</Link>.</p>
    <section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 font-semibold">Open positions and unresolved executions · {data.currency}</h2>{!data.risk.open.length?<p className="text-sm text-muted-foreground">None in this currency.</p>:data.risk.open.map(r=><div key={r.id} className="border-b border-border py-3 text-sm"><strong>{r.symbol} · {r.direction} · {r.state}</strong><p className="mt-1">Filled {number(r.filled)} · Exited {number(r.exited)} · Residual {number(r.remaining)} · Stop {money(r.stop)} · Target {money(r.target)}</p><p className="mt-1 text-muted-foreground">Unrealized PnL: {money(r.unrealized)} · Mark timestamp: {date(r.markAt)}{r.error?' · '+r.error:''}</p></div>)}</section>
   </>}
   {view==='journal'&&<>
    <p className="text-sm text-muted-foreground">{data.count} matching records. CSV includes every filtered row, not just this page. Net PnL stays unavailable when costs are incomplete.</p>
    <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{['Trade','State / dates','Fills','Gross PnL','Recorded fees','Notes / details'].map(s=><th key={s} className="whitespace-nowrap p-3 font-medium">{s}</th>)}</tr></thead><tbody>{data.rows.map(r=><tr key={r.id} className="border-t border-border align-top"><td className="p-3"><strong>{r.symbol}</strong><p>{r.direction}</p><p className="text-xs text-muted-foreground">{r.accountLabel} · {r.environment} · {r.currency}</p></td><td className="p-3">{r.state}<p className="text-xs text-muted-foreground">Opened {date(r.openedAt)}<br/>Closed {date(r.closedAt)}</p>{r.remaining>0&&r.state==='CLOSED'&&<p className="text-amber-600">Residual inventory retained</p>}</td><td className="p-3 text-xs">Entry {number(r.filled)} @ {number(r.entry)}<br/>Exit {number(r.exited)} @ {number(r.exit)}<br/>Residual {number(r.remaining)}</td><td className="p-3 whitespace-nowrap">{money(r.grossPnl)}<p className="text-xs text-muted-foreground">Net: {money(r.netPnl)}</p></td><td className="p-3 text-xs">{money(r.quoteFees)}<p>{r.feeBasis}</p>{Object.entries(r.otherFees).map(([a,n])=><p key={a}>{number(n)} {a}</p>)}</td><td className="min-w-64 p-3"><button className={button} onClick={()=>setExpanded(expanded===r.id?null:r.id)}>{expanded===r.id?'Hide details':'Details & notes'}</button>{expanded===r.id&&<div className="mt-3 space-y-3"><p className="text-xs">Stop {money(r.stop)} · Target {money(r.target)}<br/>Reason: {r.reason??'—'}{r.error?' · '+r.error:''}</p><LedgerNotes key={r.environment+':'+r.id} row={r} onSaved={refresh}/></div>}</td></tr>)}</tbody></table>{!data.rows.length&&<p className="p-8 text-center text-sm text-muted-foreground">No matching trades.</p>}</div>
    <div className="flex items-center gap-3"><button className={button} disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>Previous</button><span className="text-sm">Page {page} of {Math.max(1,Math.ceil(data.count/data.limit))}</span><button className={button} disabled={page*data.limit>=data.count||loading} onClick={()=>setPage(p=>p+1)}>Next</button></div>
   </>}
  </>}
 </div>
}
