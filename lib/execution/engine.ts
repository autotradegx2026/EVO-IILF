import { assertQuantity, roundStep, terminal, type Execution, type ExecutionBroker, type Intent } from './model'

export type ExecutionControls = { entriesAllowed: boolean; maxPriceDriftBps: number }
export type ExecutionStore = { save(value: Execution): Promise<Execution>; fence(): Promise<void>; authorizeEntry?(value:Execution):Promise<boolean> }
const epsilon = 1e-10
const clientId = (id: string, purpose: string, number = 0) => `e${id.replace(/-/g, '').slice(0, 14)}${purpose}${String(number).padStart(3,'0')}`

/** A persisted SUBMITTING intent is never sent again, even if a later lookup finds nothing.
 * A timeout cannot prove rejection. Reconcile by permanent client ID; uncertainty stays visible.
 */
export async function advanceExecution(initial: Execution, broker: ExecutionBroker, store: ExecutionStore, controls: ExecutionControls, at?: number): Promise<Execution> {
  const clock=at===undefined?Date.now:()=>at
  const now=clock()
  let e: Execution = structuredClone(initial)
  if (['CLOSED','REJECTED'].includes(e.state)) return e
  const save = async () => { e = await store.save(e); return e }
  const fail = async (code: string) => { e.state='ATTENTION'; e.error=code; return save() }
  const sync = async () => {
    let missing = false
    for (const intent of e.intents) {
      if (intent.state==='PREPARED' || intent.state==='REJECTED') continue
      const found=await broker.lookup(e.symbol,intent)
      if (!found) { missing=true; continue }
      if (intent.snapshot && found.filled+epsilon<intent.snapshot.filled) throw new Error('BROKER_FILL_REGRESSION')
      if (found.filled < 0 || found.filled>intent.quantity+epsilon || (found.filled>0 && !(found.averagePrice>0))) throw new Error('INVALID_BROKER_FILL')
      intent.snapshot=found; intent.orderId=found.orderId; intent.state='ACKNOWLEDGED'
    }
    const entry=e.intents.find(i=>i.purpose==='ENTRY')?.snapshot
    const exits=e.intents.filter(i=>i.purpose!=='ENTRY').flatMap(i=>i.snapshot?[i.snapshot]:[])
    e.entry_quantity=entry?.filled??0; e.entry_price=entry?.averagePrice??0
    e.exit_quantity=exits.reduce((n,s)=>n+s.filled,0)
    const exitQuote=exits.reduce((n,s)=>n+s.quoteAmount,0)
    e.exit_price=e.exit_quantity?exitQuote/e.exit_quantity:0
    e.gross_pnl=(e.exit_price-e.entry_price)*e.exit_quantity*(e.direction==='LONG'?1:-1)
    const snapshots=[...(entry?[entry]:[]),...exits]
    e.quote_fees=snapshots.reduce((n,s)=>n+s.quoteFee,0)
    e.other_fees={}
    for (const snapshot of snapshots) for (const [asset,amount] of Object.entries(snapshot.otherFees)) e.other_fees[asset]=(e.other_fees[asset]??0)+amount
    // Base commissions reduce owned inventory, but remain separately disclosed, not silently treated as quote fees.
    const baseFees=snapshots.reduce((n,s)=>n+s.baseFee,0)
    if (baseFees) e.other_fees.BASE=baseFees
    e.residual_quantity=Math.max(0,e.entry_quantity-e.exit_quantity-(broker.longOnly?baseFees:0))
    await save()
    if (missing) throw new Error('SUBMISSION_UNKNOWN_RECONCILE_REQUIRED')
    if (e.exit_quantity>e.entry_quantity+epsilon) throw new Error('BROKER_OVERFILL_REQUIRES_RECONCILIATION')
  }
  const send = async (intents: Intent[], oco = false) => {
    for (const intent of intents) { intent.state='SUBMITTING'; intent.submittedAt=new Date(now).toISOString() }
    e.intents.push(...intents)
    await save() // write intent and lease fence BEFORE the external side effect
    await store.fence()
    if(intents[0].purpose==='ENTRY'){
      let authorized=false
      try{authorized=clock()<Date.parse(e.deadline_at)&&clock()-Date.parse(e.created_at)<=300000&&(store.authorizeEntry?await store.authorizeEntry(e):controls.entriesAllowed)}catch{authorized=false}
      if(!authorized||clock()>=Date.parse(e.deadline_at)||clock()-Date.parse(e.created_at)>300000){
        e.intents.find(i=>i.clientId===intents[0].clientId)!.state='REJECTED'
        e.state='REJECTED';e.error='ENTRY_AUTHORIZATION_CHANGED';await save();return
      }
      // Authorization reads may outlast the lease; fence again after they settle.
      await store.fence()
    }
    const result=oco
      ? await broker.protect!(e.symbol,intents[0],intents[1],clientId(e.id,'L'))
      : await broker.submit(e.symbol,intents[0])
    for (const value of intents) {
      const persisted=e.intents.find(i=>i.clientId===value.clientId)!
      if (result.outcome==='REJECTED') persisted.state='REJECTED'
      else if (result.outcome==='ACCEPTED' && !oco) persisted.orderId=result.orderId
    }
    if (result.outcome!=='ACCEPTED') e.error=result.reason
    await save()
  }
  const cancel = async (intent: Intent) => { await store.fence(); await broker.cancel(e.symbol,intent) }
  try {
    if (broker.environment!==e.environment) return fail('BROKER_ENVIRONMENT_MISMATCH')
    await broker.connect()
    await sync()
    const rules=await broker.instrument(e.symbol)
    if (broker.longOnly && e.direction!=='LONG') { e.state='REJECTED';e.error='SPOT_SHORT_NOT_SUPPORTED';return save() }
    let entry=e.intents.find(i=>i.purpose==='ENTRY')
    if (!entry) {
      if (!controls.entriesAllowed || e.closing_requested || now>=Date.parse(e.deadline_at) || now-Date.parse(e.created_at)>300000) {
        e.state='REJECTED'; e.error='ENTRY_DISABLED_OR_EXPIRED'; return save()
      }
      const drift=Math.abs(rules.price-e.signal_price)/e.signal_price*10000
      if (drift>controls.maxPriceDriftBps || Math.abs(rules.price-e.stop_loss)*e.requested_quantity>e.risk_budget*1.01 || (e.direction==='LONG'?rules.price<=e.stop_loss:rules.price>=e.stop_loss)) {
        e.state='REJECTED';e.error='ENTRY_PRICE_OR_RISK_CHANGED';return save()
      }
      assertQuantity(e.requested_quantity,rules.price,rules)
      if (e.requested_quantity*rules.price>await broker.availableQuote(e.symbol)) { e.state='REJECTED';e.error='INSUFFICIENT_AVAILABLE_BALANCE';return save() }
      e.state='ENTERING';e.error=null
      await send([{clientId:clientId(e.id,'E'),purpose:'ENTRY',side:e.direction==='LONG'?'BUY':'SELL',type:'MARKET',quantity:e.requested_quantity,state:'PREPARED'}])
      if((e as Execution).state==='REJECTED')return e
      await sync();entry=e.intents.find(i=>i.purpose==='ENTRY')!
    }
    if (entry.state==='REJECTED' || (entry.snapshot && terminal(entry.snapshot.state) && entry.snapshot.filled===0)) {
      e.state='REJECTED';e.error='ENTRY_REJECTED_OR_UNFILLED';return save()
    }
    if (!entry.snapshot) return fail('ENTRY_OUTCOME_UNKNOWN')
    if (!terminal(entry.snapshot.state)) {
      if (entry.snapshot.filled>0 || !controls.entriesAllowed || e.closing_requested || now-Date.parse(entry.submittedAt!)>=15000 || now>=Date.parse(e.deadline_at)) {
        await cancel(entry);await sync();entry=e.intents.find(i=>i.purpose==='ENTRY')!
      }
      if (!entry.snapshot || !terminal(entry.snapshot.state)) { e.state='ENTERING';e.error=entry.snapshot?.filled?'PARTIAL_ENTRY_CANCEL_PENDING':null;return save() }
      if (!entry.snapshot.filled) { e.state='REJECTED';e.error='ENTRY_CANCELED_UNFILLED';return save() }
    }
    const stops=e.intents.filter(i=>i.purpose==='STOP'||i.purpose==='TARGET')
    const exits=e.intents.filter(i=>i.purpose!=='ENTRY')
    if (now>=Date.parse(e.deadline_at)) { e.closing_requested=true;e.close_reason??='SESSION_END' }
    if (e.closing_requested) e.close_reason??='MANUAL'
    if (e.entry_quantity*Math.abs(e.entry_price-e.stop_loss)>e.risk_budget*1.10 || (e.direction==='LONG'?e.entry_price<=e.stop_loss:e.entry_price>=e.stop_loss)) {
      e.closing_requested=true;e.close_reason??='FILL_RISK_EXCEEDED'
    }
    if (exits.some(i=>(i.snapshot?.filled??0)>0)) {
      e.closing_requested=true;e.close_reason??=exits.find(i=>(i.snapshot?.filled??0)>0)?.purpose==='STOP'?'SL_HIT':'TP_HIT'
    }
    if (stops.some(i=>i.state==='REJECTED'||(i.snapshot && terminal(i.snapshot.state) && i.snapshot.filled===0))) {
      e.closing_requested=true;e.close_reason??='PROTECTION_ENDED'
    }
    if (!stops.length && !e.closing_requested) {
      e.take_profit=roundStep(e.entry_price+(e.direction==='LONG'?1:-1)*Math.abs(e.entry_price-e.stop_loss)*e.rr,rules.tick,e.direction==='LONG'?'ceil':'floor')
      if (e.direction==='LONG'?rules.price<=e.stop_loss||rules.price>=e.take_profit:rules.price>=e.stop_loss||rules.price<=e.take_profit) {
        e.closing_requested=true;e.close_reason='BRACKET_CROSSED_BEFORE_PROTECTION'
      } else {
        const quantity=roundStep(e.residual_quantity,rules.step)
        if (quantity<rules.minQuantity || quantity*rules.price<rules.minNotional) return fail('PARTIAL_FILL_BELOW_PROTECTION_MINIMUM')
        e.state='PROTECTING'; e.error=null
        const side=e.direction==='LONG'?'SELL':'BUY'
        const stop: Intent={clientId:clientId(e.id,'S'),purpose:'STOP',side,type:'STOP',quantity,trigger:e.stop_loss,state:'PREPARED'}
        if (broker.nativeOco) await send([stop,{clientId:clientId(e.id,'T'),purpose:'TARGET',side,type:'LIMIT',quantity,price:e.take_profit,state:'PREPARED'}],true)
        else await send([stop])
        return e
      }
    }
    if (!broker.nativeOco && (e.direction==='LONG'?rules.price>=e.take_profit:rules.price<=e.take_profit)) {
      e.closing_requested=true;e.close_reason??='TP_HIT'
    }
    if (!e.closing_requested) { e.state='OPEN';e.error=null;return save() }
    e.state='CLOSING';await save()
    // All protective/previous close orders must be terminal before another market exit.
    for (const intent of e.intents.filter(i=>i.purpose!=='ENTRY')) {
      if (intent.state==='REJECTED') continue
      if (!intent.snapshot) return fail('EXIT_OUTCOME_UNKNOWN')
      if (!terminal(intent.snapshot.state)) await cancel(intent)
    }
    await sync()
    if (e.intents.some(i=>i.purpose!=='ENTRY' && i.state!=='REJECTED' && (!i.snapshot||!terminal(i.snapshot.state)))) { e.error='EXIT_CANCELLATION_PENDING';return save() }
    if (e.residual_quantity<=epsilon) { e.state='CLOSED';e.residual_quantity=0;e.error=null;return save() }
    const quantity=roundStep(e.residual_quantity,rules.step)
    if (quantity<rules.minQuantity || quantity*rules.price<rules.minNotional) {
      // End the order workflow while retaining and displaying the actual unsellable inventory.
      e.state='CLOSED';e.error='RESIDUAL_INVENTORY_BELOW_EXCHANGE_MINIMUM';return save()
    }
    if (broker.longOnly && quantity>await broker.availableBase(e.symbol)+epsilon) return fail('BROKER_INVENTORY_MISMATCH')
    const closeCount=e.intents.filter(i=>i.purpose==='CLOSE').length
    if (closeCount>=3) return fail('CLOSE_RETRIES_EXHAUSTED')
    assertQuantity(quantity,rules.price,rules)
    await send([{clientId:clientId(e.id,'C',closeCount),purpose:'CLOSE',side:e.direction==='LONG'?'SELL':'BUY',type:'MARKET',quantity,state:'PREPARED'}])
    return e
  } catch (error) {
    if (error instanceof Error && ['WORKER_LEASE_LOST','EXECUTION_VERSION_CHANGED','EXECUTION_SAVE_FAILED'].includes(error.message)) throw error
    return fail(error instanceof Error && /^[A-Z0-9_: -]{1,120}$/.test(error.message)?error.message:'BROKER_UNAVAILABLE_RETRYING_READS')
  }
}
