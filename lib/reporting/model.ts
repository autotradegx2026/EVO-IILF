import { z } from 'zod'
import { terminal, type Execution } from '../execution/model'
import type { PaperTrade,Trade } from '../../types/database'
import { calculateMetrics,type PerformanceTrade } from '../trading/performance'
export const EnvironmentSchema=z.enum(['paper','testnet','live','legacy'])
export type LedgerEnvironment=z.infer<typeof EnvironmentSchema>
export const ReportQuery=z.object({environment:EnvironmentSchema.default('paper'),currency:z.string().regex(/^[A-Z0-9]{2,16}$/).optional(),account:z.string().uuid().optional(),period:z.enum(['7d','30d','90d','all']).default('30d'),view:z.enum(['analytics','risk','journal']).default('analytics'),page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20),symbol:z.string().trim().max(50).default(''),direction:z.enum(['LONG','SHORT']).optional(),status:z.string().regex(/^[A-Z_]{2,30}$/).optional(),from:z.string().datetime().optional(),to:z.string().datetime().optional(),format:z.literal('csv').optional()}).strict()
export type LedgerRow={id:string;environment:LedgerEnvironment;accountId:string|null;accountLabel:string;symbol:string;direction:string;currency:string;state:string;openedAt:string;closedAt:string|null;updatedAt:string;entry:number;exit:number|null;quantity:number;filled:number;exited:number;remaining:number;stop:number;target:number;grossPnl:number;quoteFees:number;otherFees:Record<string,number>;accountedPnl:number;netPnl:number|null;feeBasis:string;unrealized:number|null;markAt:string|null;reason:string|null;error:string|null;notes:string|null;screenshot:string|null;confluence:number|null;timeframe:string;settled:boolean}
export type AccountSummary={id:string;label:string;broker:string;environment:'live'|'testnet';connected:boolean}
const finite=(v:number)=>{if(!Number.isFinite(v))throw new Error('LEDGER_AMOUNT_UNAVAILABLE');return v}
export function brokerRow(e:Execution&{notes?:string|null;screenshot_url?:string|null},a:AccountSummary):LedgerRow{
 const otherFees:Record<string,number>={}
 if(!e.other_fees||typeof e.other_fees!=='object'||Array.isArray(e.other_fees))throw new Error('LEDGER_AMOUNT_UNAVAILABLE')
 for(const [asset,value]of Object.entries(e.other_fees)){
  const name=asset==='BASE'&&a.broker==='binance'&&e.symbol.startsWith('BINANCE:')&&e.symbol.endsWith(e.currency)
   ?e.symbol.slice('BINANCE:'.length,-e.currency.length):asset
  otherFees[name]=finite((otherFees[name]??0)+finite(value))
 }
 const binance=a.broker==='binance',unconverted=Object.values(otherFees).some(n=>n!==0)
 const settled=e.state==='CLOSED'&&e.residual_quantity<=1e-10
 const reconciled=settled&&!e.error&&e.entry_quantity>0
  &&e.intents.some(i=>i.purpose==='ENTRY'&&i.state!=='REJECTED'&&(i.snapshot?.filled??0)>0)
  &&e.intents.every(i=>i.state==='REJECTED'||!!i.snapshot&&terminal(i.snapshot.state))
 const gross=finite(e.gross_pnl),fees=finite(e.quote_fees),pnl=gross-fees
 return {id:e.id,environment:e.environment,accountId:a.id,accountLabel:a.label,symbol:e.symbol,direction:e.direction,currency:e.currency,state:e.state,openedAt:e.created_at,closedAt:e.state==='CLOSED'?e.updated_at:null,updatedAt:e.updated_at,entry:e.entry_price||e.signal_price,exit:e.exit_quantity?e.exit_price:null,quantity:e.requested_quantity,filled:e.entry_quantity,exited:e.exit_quantity,remaining:e.residual_quantity,stop:e.stop_loss,target:e.take_profit,grossPnl:gross,quoteFees:fees,otherFees,accountedPnl:pnl,netPnl:binance&&reconciled&&!unconverted?pnl:null,feeBasis:!binance?'Broker fees unavailable':!reconciled?'Execution or fee reconciliation incomplete':unconverted?'Other-asset fees not converted':'Recorded exchange fees',unrealized:null,markAt:null,reason:e.close_reason,error:e.error,notes:e.notes??null,screenshot:e.screenshot_url??null,confluence:null,timeframe:'',settled}
}
export function paperRow(t:PaperTrade&{screenshot_url?:string|null}):LedgerRow{
 const closed=t.status==='CLOSED',gross=closed?finite(t.pnl):0
 return {id:t.id,environment:'paper',accountId:null,accountLabel:'Paper portfolio',symbol:t.symbol,direction:t.direction,currency:t.currency,state:t.status,openedAt:t.opened_at,closedAt:t.closed_at,updatedAt:t.last_checked_at??t.closed_at??t.opened_at,entry:t.entry_price,exit:t.close_price,quantity:t.quantity,filled:t.quantity,exited:closed?t.quantity:0,remaining:closed?0:t.quantity,stop:t.stop_loss,target:t.take_profit,grossPnl:gross,quoteFees:0,otherFees:{},accountedPnl:gross,netPnl:null,feeBasis:'Simulation excludes fees and slippage',unrealized:closed?0:finite(t.unrealized_pnl),markAt:t.last_bar_at,reason:t.close_reason,error:t.monitor_error,notes:t.notes,screenshot:t.screenshot_url??null,confluence:t.confluence_score,timeframe:t.timeframe,settled:closed}
}
export function legacyRow(t:Trade):LedgerRow{
 const gross=t.status==='CLOSED'?finite(t.pnl):0
 return {id:t.id,environment:'legacy',accountId:t.broker_account_id,accountLabel:'Earlier manual ledger',symbol:t.symbol,direction:t.direction,currency:'UNKNOWN',state:t.status,openedAt:t.opened_at,closedAt:t.closed_at,updatedAt:t.closed_at??t.opened_at,entry:t.entry_price,exit:t.close_price,quantity:t.quantity,filled:t.status==='PENDING'||t.status==='REJECTED'?0:t.quantity,exited:t.status==='CLOSED'?t.quantity:0,remaining:t.status==='CLOSED'||t.status==='REJECTED'?0:t.quantity,stop:t.stop_loss,target:t.take_profit,grossPnl:gross,quoteFees:0,otherFees:{},accountedPnl:gross,netPnl:null,feeBasis:'Historical currency and fees unverified',unrealized:null,markAt:null,reason:t.close_reason,error:null,notes:t.notes,screenshot:t.screenshot_url,confluence:t.confluence_score,timeframe:'',settled:t.status==='CLOSED'}
}
export function summarize(rows:LedgerRow[],currency:string,timezone='Asia/Kolkata'){
 if(rows.some(r=>r.currency!==currency))throw new Error('MIXED_CURRENCIES_FORBIDDEN')
 const monthFormatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',calendar:'iso8601',numberingSystem:'latn'})
 // UNKNOWN can contain unrelated quote currencies. Keep journal rows available,
 // but do not manufacture a shared monetary unit or a completed performance sample.
 const verified=currency!=='UNKNOWN'
 const completed=verified?rows.filter(r=>r.settled):[]
 const trades:PerformanceTrade[]=completed.map(r=>({id:r.id,status:'CLOSED',closed_at:r.closedAt,pnl:r.accountedPnl,symbol:r.symbol,direction:r.direction as Trade['direction'],entry_price:r.entry,stop_loss:r.stop,quantity:r.filled,confluence_score:r.confluence}))
 const calculated=calculateMetrics(trades)
 const metrics={...calculated,grossProfit:verified?calculated.grossProfit:null,grossLoss:verified?calculated.grossLoss:null,netPnl:verified?calculated.netPnl:null,maxDrawdownAmount:verified?calculated.maxDrawdownAmount:null}
 const groups=new Map<string,PerformanceTrade[]>()
 for(const trade of trades){
  if(!trade.closed_at||!Number.isFinite(Date.parse(trade.closed_at)))continue
  const parts=monthFormatter.formatToParts(new Date(trade.closed_at))
  const month=parts.find(p=>p.type==='year')!.value+'-'+parts.find(p=>p.type==='month')!.value
  const group=groups.get(month)??[];group.push(trade);groups.set(month,group)
 }
 const monthly=Array.from(groups.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([month,group])=>{
  const m=calculateMetrics(group)
  return {month:month+'-01',net_pnl:m.netPnl,total_trades:m.totalTrades,winning_trades:m.winningTrades,losing_trades:m.losingTrades,breakeven_trades:m.breakevenTrades,win_rate:m.winRate,gross_profit:m.grossProfit,gross_loss:m.grossLoss,profit_factor:m.profitFactor,avg_confluence:m.avgConfluenceScore}
 })
 const otherFees:Record<string,number>={}
 for(const r of completed)for(const [asset,amount]of Object.entries(r.otherFees))otherFees[asset]=finite((otherFees[asset]??0)+finite(amount))
 return {metrics,monthly,grossPnl:verified?completed.reduce((n,r)=>n+finite(r.grossPnl),0):null,quoteFees:verified?completed.reduce((n,r)=>n+finite(r.quoteFees),0):null,accountedPnl:verified?completed.reduce((n,r)=>n+finite(r.accountedPnl),0):null,netPnl:verified&&completed.every(r=>r.netPnl!==null)?completed.reduce((n,r)=>n+finite(r.netPnl!),0):null,otherFees,feeNotes:[...new Set([...rows.map(r=>r.feeBasis),...(verified?[]:['Historical currencies are unverified; monetary totals and completed performance are unavailable.'])])],unsettled:rows.filter(r=>!r.settled&&r.state!=='REJECTED').length}
}
export function ledgerCsv(rows:LedgerRow[]){
 const cell=(v:unknown)=>{const s=String(v??'');return '"'+(typeof v==='string'&&(/^[\t\r\n]/.test(s)||/^\s*[=+\-@]/.test(s))?"'"+s:s).replace(/"/g,'""')+'"'}
 const header=['ID','Environment','Account','Currency','Symbol','Direction','State','Opened UTC','Closed UTC','Entry','Exit','Requested','Filled','Exited','Residual','Gross PnL','Quote fees','PnL after recorded quote fees','Net PnL','Fee basis','Other-asset fees','Notes']
 return [header,...rows.map(r=>[r.id,r.environment,r.accountLabel,r.currency,r.symbol,r.direction,r.state,r.openedAt,r.closedAt,r.entry,r.exit,r.quantity,r.filled,r.exited,r.remaining,r.grossPnl,r.quoteFees,r.accountedPnl,r.netPnl,r.feeBasis,JSON.stringify(r.otherFees),r.notes])].map(row=>row.map(cell).join(',')).join('\r\n')
}
