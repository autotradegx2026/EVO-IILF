'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AnalysisData, AnalysisCandle } from '@/lib/strategy/analysis'
import { canonicalSymbol } from '@/lib/strategy/signal-state'

const number=(value:number|null|undefined)=>value==null?'Unavailable':value.toLocaleString(undefined,{maximumFractionDigits:6})
const date=(value:string|number|null|undefined)=>value==null?'Not recorded':new Date(value).toLocaleString()

function CandlePlot({data}:{data:AnalysisData}) {
  if(!data.candles.length)return <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No market candles received for this symbol and timeframe.</div>
  const bars=data.candles, width=920,height=280,pad=40,right=90,bottom=28
  const values=bars.flatMap(b=>[b.low,b.high,...(b.fast==null?[]:[b.fast]),...(b.trend==null?[]:[b.trend])])
  const minimum=Math.min(...values), maximum=Math.max(...values), span=Math.max(maximum-minimum,maximum*.0001)
  const low=minimum-span*.08, high=maximum+span*.08
  const y=(price:number)=>pad+(high-price)/(high-low)*(height-pad-bottom)
  const slot=(width-pad-right)/bars.length, x=(i:number)=>pad+(i+.5)*slot
  const line=(key:'fast'|'trend')=>bars.map((b,i)=>b[key]==null?'':`${i===0||bars[i-1][key]==null?'M':'L'}${x(i)},${y(b[key]!)}`).join(' ')
  const markers=data.markers.map(m=>({...m,index:bars.findIndex(b=>b.closeTime+1===m.time)})).filter(m=>m.index>=0)
  return <div className="overflow-hidden rounded-xl border border-border bg-background"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${data.symbol} ${data.timeframe} candles with LONG and SHORT strategy setup markers`} className="h-auto min-h-48 w-full">
    {[0,1,2,3,4].map(i=>{const value=low+(high-low)*i/4;return <g key={i}><line x1={pad} x2={width-right} y1={y(value)} y2={y(value)} stroke="currentColor" className="text-border"/><text x={width-right+8} y={y(value)+4} fill="currentColor" className="text-muted-foreground" fontSize="10">{number(value)}</text></g>})}
    {bars.map((bar:AnalysisCandle,i)=>{const up=bar.close>=bar.open;return <g key={bar.time} fill={up?'#16a34a':'#dc2626'} stroke={up?'#16a34a':'#dc2626'}><title>{date(bar.closeTime+1)} · O {number(bar.open)} H {number(bar.high)} L {number(bar.low)} C {number(bar.close)}</title><line x1={x(i)} x2={x(i)} y1={y(bar.high)} y2={y(bar.low)}/><rect x={x(i)-slot*.3} y={y(Math.max(bar.open,bar.close))} width={Math.max(1,slot*.6)} height={Math.max(1,Math.abs(y(bar.close)-y(bar.open)))}/></g>})}
    <path d={line('fast')} fill="none" stroke="#2563eb" strokeWidth="1.5"/><path d={line('trend')} fill="none" stroke="#d97706" strokeWidth="1.5"/>
    {markers.map((m,i)=>{const long=m.direction==='LONG',cy=y(long?bars[m.index].low:bars[m.index].high)+(long?12:-12),cx=x(m.index);return <g key={`${m.time}:${m.direction}`} fill={long?'#15803d':'#b91c1c'}><title>{m.direction} setup · {date(m.time)} · Entry {number(m.price)} · SL {number(m.sl)} · TP {number(m.tp)}</title><path d={long?`M${cx},${cy-5} l-4,7 h8 Z`:`M${cx},${cy+5} l-4,-7 h8 Z`}/>{i>=markers.length-3&&<text x={cx} y={cy+(long?16:-10)} textAnchor="middle" fontSize="9" fontWeight="bold">{m.direction}</text>}</g>})}
    {[0,Math.floor(bars.length/2),bars.length-1].map(i=><text key={i} x={x(i)} y={height-6} fill="currentColor" className="text-muted-foreground" textAnchor="middle" fontSize="10">{new Date(bars[i].closeTime+1).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text>)}
  </svg><p className="px-3 pb-3 text-[11px] text-muted-foreground">Green/red candles · Blue fast EMA · Amber trend EMA (when calculated). LONG/SHORT markers are strategy setups; executed trades are recorded in their trading ledger.</p></div>
}

export function StrategyAnalysis({symbol,scope='broker'}:{symbol:string;scope?:'paper'|'broker'}) {
  const [data,setData]=useState<AnalysisData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  useEffect(()=>{
    const controller=new AbortController();let pending=false
    setData(null);setLoading(true);setError('')
    async function refresh(){
      if(pending)return;pending=true
      try{
        const response=await fetch(`/api/strategy/analysis?${new URLSearchParams({symbol,scope})}`,{cache:'no-store',signal:controller.signal})
        const json=await response.json()
        if(!response.ok||!json.data)throw new Error(json.error??'Analysis unavailable')
        if(!controller.signal.aborted){setData(json.data);setError('')}
      }catch(cause){if(!controller.signal.aborted){setData(null);setError(cause instanceof Error?cause.message:'Analysis unavailable')}}
      finally{pending=false;if(!controller.signal.aborted)setLoading(false)}
    }
    void refresh();const timer=setInterval(()=>void refresh(),15000)
    return ()=>{controller.abort();clearInterval(timer)}
  },[symbol,scope])
  const snapshot=data?.snapshot
  return <section aria-label="Strategy signal analysis" className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Strategy signal · {canonicalSymbol(symbol)}</h2><p className="mt-1 text-xs text-muted-foreground">{data?`${data.source} · ${data.timeframe} · ${data.execution.environment.toUpperCase()}`:'Loading saved strategy and market data…'}</p></div><strong role="status" className={`rounded-xl px-4 py-2 text-lg ${data?.signal==='LONG'?'bg-green-500/10 text-green-700':data?.signal==='SHORT'?'bg-red-500/10 text-red-700':'bg-muted text-muted-foreground'}`}>{loading?'Loading…':error?'Unavailable':data?.signal==='LONG'?'LONG / BUY':data?.signal==='SHORT'?'SHORT / SELL':'WAIT'}</strong></div>
    {error && <p role="alert" className="text-sm text-destructive">{error} Retrying automatically.</p>}
    {data && <>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[['Latest close',number(data.candles.at(-1)?.close)],['Trend bias',snapshot?.direction??'Not confirmed'],['Long / short score',`${snapshot?.longScore??'—'} / ${snapshot?.shortScore??'—'}`],['Setup SL / TP',snapshot?.qualified?`${number(snapshot.sl)} / ${number(snapshot.tp)}`:'No qualified setup']].map(([label,value])=><div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>)}</div>
      <CandlePlot data={data}/>
      {snapshot && <div className="flex flex-wrap gap-2">{Object.entries(snapshot.factors).map(([name,pass])=><span key={name} className={`rounded-full px-2 py-1 text-[11px] ${pass?'bg-green-500/10 text-green-700':'bg-muted text-muted-foreground'}`}>{name.toUpperCase()} {pass?'✓':'—'}</span>)}</div>}
      <div className="rounded-xl border border-border bg-background p-3 text-sm"><p className="font-medium">Bot dispatch: {data.execution.enabled?'ON · entry checks apply':'OFF'}</p>{data.blockers.length?<ul className="mt-2 space-y-1 text-xs text-muted-foreground">{data.blockers.map(reason=><li key={reason}>{reason}</li>)}</ul>:<p className="mt-2 text-xs text-muted-foreground">{data.signal==='WAIT'?'Waiting for a qualified setup.':'Qualified analysis. The background worker checks risk, cooldown, open positions and price drift before submitting an entry.'}</p>}<p className="mt-2 text-xs text-muted-foreground">Latest {data.execution.environment} trade state for this symbol: {data.execution.lastState??'No execution recorded'}{data.execution.lastUpdatedAt?` · ${date(data.execution.lastUpdatedAt)}`:''}. <Link className="underline" href={scope==='paper'?'/backtest':'/automation'}>View execution history</Link>.</p></div>
      <p className="text-[11px] text-muted-foreground">Candle closed {date(data.candles.at(-1)?.closeTime==null?null:data.candles.at(-1)!.closeTime+1)} · Analysis checked {date(data.checkedAt)} · Strategy changed {date(data.strategyUpdatedAt)}. Refreshes every 15 seconds. Viewing this chart does not place an order.</p>
    </>}
  </section>
}
