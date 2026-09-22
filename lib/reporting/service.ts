import { executionDB,executionBroker } from '../execution/service'
import { periodStart } from '../trading/performance'
import { marketDayStart,timeframeMilliseconds } from '../trading/session'
import { brokerRow,paperRow,legacyRow,summarize,type AccountSummary,type LedgerRow,ReportQuery } from './model'
import type { Execution } from '../execution/model'
import type { PaperTrade,Trade } from '../../types/database'
import type { z } from 'zod'
export type ReportInput=z.infer<typeof ReportQuery>
export async function loadReport(userId:string,q:ReportInput){
 const db=executionDB(),now=new Date()
 const settings=await db.from('settings').select('*').eq('user_id',userId).single()
 if(settings.error)throw new Error('SETTINGS_UNAVAILABLE')
 const accounts=await db.from('execution_accounts').select('id,label,broker,environment,connected').eq('user_id',userId).order('created_at')
 if(accounts.error)throw new Error('ACCOUNTS_UNAVAILABLE')
 const choices=accounts.data.filter(a=>a.environment===q.environment)
 if(q.account&&!choices.some(a=>a.id===q.account))throw new Error('ACCOUNT_NOT_FOUND')
 let all:LedgerRow[]=[]
 if(q.environment==='paper'){
  const rows=await readReportPages<PaperTrade>(async(from,to)=>await db.from('paper_trades').select('*').eq('user_id',userId).lte('opened_at',now.toISOString()).order('opened_at').order('id').range(from,to))
  all=rows.map(paperRow)
 }else if(q.environment==='legacy'){
  const rows=await readReportPages<Trade>(async(from,to)=>await db.from('trades').select('*').eq('user_id',userId).lte('opened_at',now.toISOString()).order('opened_at').order('id').range(from,to))
  all=rows.map(legacyRow)
 }else{
  const brokerEnvironment=q.environment as 'testnet'|'live'
  const rows=await readReportPages<Execution>(async(from,to)=>await db.from('broker_executions').select('*').eq('user_id',userId).eq('environment',brokerEnvironment).lte('created_at',now.toISOString()).order('created_at').order('id').range(from,to))
  all=rows.map(e=>{const a=choices.find(a=>a.id===e.broker_account_id);if(!a)throw new Error('EXECUTION_ACCOUNT_MISSING');return brokerRow(e,a as AccountSummary)})
 }
 const eligible=all.filter(r=>!q.account||r.accountId===q.account)
 const configuredCurrencies=q.environment==='paper'?(safelyPaperCurrencies(settings.data.screener_symbols??[])):(q.environment==='legacy'?['UNKNOWN']:choices.filter(a=>!q.account||a.id===q.account).map(a=>a.broker==='angelone'?'INR':'USDT'))
 const currencies=[...new Set([...eligible.map(r=>r.currency),...configuredCurrencies])].sort()
 if(!currencies.length)currencies.push(q.environment==='legacy'?'UNKNOWN':choices.find(a=>a.id===q.account)?.broker==='angelone'?'INR':'USDT')
 const currency=q.currency??(currencies.includes('USDT')?'USDT':currencies[0])
 if(!currencies.includes(currency))throw new Error('CURRENCY_NOT_AVAILABLE')
 const scoped=eligible.filter(r=>r.currency===currency)
 const since=q.from??periodStart(q.period,now),until=q.to??now.toISOString()
 if(since&&since>until)throw new Error('INVALID_DATE_RANGE')
 const filtered=scoped.filter(r=>{
  const date=q.view==='analytics'?(r.closedAt??r.updatedAt):r.openedAt
  return (!since||date>=since)&&date<=until&&(!q.symbol||r.symbol.toLowerCase().includes(q.symbol.toLowerCase()))&&(!q.direction||r.direction===q.direction)&&(!q.status||r.state===q.status)
 }).sort((a,b)=>b.openedAt.localeCompare(a.openedAt)||a.id.localeCompare(b.id))
 const today=marketDayStart(now,settings.data.session_timezone),s=settings.data
 // Match the entry gates: paper daily trade count spans currencies; broker
 // count spans accounts in the selected environment. Losses remain per currency.
 const todayTrades=all.filter(r=>r.openedAt>=today&&r.state!=='REJECTED').length
 const lossRows=all.filter(r=>r.currency===currency&&(q.environment==='paper'?r.settled&&!!r.closedAt&&r.closedAt>=today:r.updatedAt>=today))
 const dailyLoss=lossRows.reduce((n,r)=>n+Math.max(0,-r.accountedPnl),0)
 let balance:number|null=null,balanceAt:string|null=null,balanceError:string|null=null
 if(q.environment==='paper'){balance=100000+all.filter(r=>r.currency===currency&&r.settled).reduce((n,r)=>n+r.grossPnl,0);balanceAt=now.toISOString()}
 else if(q.view==='risk'&&q.account){
  const account=await db.from('execution_accounts').select('*').eq('user_id',userId).eq('id',q.account).single()
  const symbol=scoped[0]?.symbol??s.screener_symbols?.find(symbol=>currency==='USDT'?/^BINANCE:.*USDT$/.test(symbol):currency==='INR'?/^(NSE|BSE):/.test(symbol):false)
  if(account.error||!account.data.connected)balanceError='Connect and verify this broker account first.'
  else if(currency!==(account.data.broker==='angelone'?'INR':'USDT'))balanceError='This account does not support the selected quote currency.'
  else if(!symbol)balanceError='Configure a supported watchlist symbol for this currency.'
  else try{const broker=executionBroker(account.data);await broker.connect();balance=await broker.availableQuote(symbol);if(!Number.isFinite(balance)||balance<0)throw new Error('BALANCE_UNAVAILABLE');balanceAt=new Date().toISOString()}catch{balance=null;balanceError='Broker balance unavailable. The execution gate will recheck it before an entry.'}
 }else balanceError='Select an account to read its available quote balance.'
 let latest=all.filter(r=>r.state!=='REJECTED').sort((a,b)=>b.openedAt.localeCompare(a.openedAt))[0]?.openedAt
 if(q.environment==='testnet'||q.environment==='live'){
  const last=await db.from('broker_executions').select('created_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(last.error)throw new Error('RISK_HISTORY_UNAVAILABLE');latest=last.data?.created_at??latest
 }
 const cooldownUntil=latest?new Date(Date.parse(latest)+s.cooldown_bars*timeframeMilliseconds(s.screener_timeframe??'15m')).toISOString():null
 const open=all.filter(r=>r.state!=='CLOSED'&&r.state!=='REJECTED'||r.remaining>1e-10)
 return {environment:q.environment,currency,currencies,accounts:choices,account:q.account??null,asOf:now.toISOString(),timezone:s.session_timezone,summary:summarize(filtered,currency,s.session_timezone),rows:filtered.slice((q.page-1)*q.limit,q.page*q.limit),count:filtered.length,page:q.page,limit:q.limit,
  risk:{killSwitch:s.kill_switch_active,riskPercent:s.risk_percent,maxDailyLossPct:s.max_daily_loss_pct,maxTradesPerDay:s.max_trades_per_day,cooldownBars:s.cooldown_bars,todayTrades,dailyLoss:currency==='UNKNOWN'?null:dailyLoss,dailyPnl:currency==='UNKNOWN'?null:lossRows.reduce((n,r)=>n+r.accountedPnl,0),balance,balanceAt,balanceError,lossBudget:balance===null?null:balance*s.max_daily_loss_pct/100,cooldownUntil,open:open.filter(r=>r.currency===currency&&(!q.account||r.accountId===q.account)),openAcrossCurrencies:open.length,scope:'Trade limits span accounts/currencies as enforced by this environment. Loss budgets use only the selected quote currency. Broker loss counts follow the execution gate’s reconciliation date; fees in other assets are not converted.'},exportRows:filtered}
}
function safelyPaperCurrencies(symbols:string[]){return symbols.flatMap(symbol=>/^BINANCE:[A-Z0-9]+USDT$/.test(symbol)?['USDT']:/^(NSE|BSE):[A-Z0-9&.-]+-EQ$/.test(symbol)?['INR']:/^OANDA:[A-Z]{6}$/.test(symbol)?[symbol.slice(-3)]:[])}
export type ReportData=Omit<Awaited<ReturnType<typeof loadReport>>,'exportRows'>

async function readReportPages<T>(read:(from:number,to:number)=>Promise<{data:T[]|null;error:unknown}>):Promise<T[]>{
 const rows:T[]=[];const deadline=Date.now()+20000
 while(true){
  if(rows.length>=10000||Date.now()>deadline)throw new Error('REPORT_HISTORY_LIMIT_EXCEEDED')
  const page=await read(rows.length,rows.length+499)
  if(page.error)throw page.error
  if(!page.data?.length)return rows
  rows.push(...page.data)
  if(page.data.length<500)return rows
 }
}
