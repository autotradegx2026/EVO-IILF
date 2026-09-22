import assert from 'node:assert/strict'
import { test } from 'node:test'
import { automaticSignalEligible } from '../lib/execution/routing'
import type { Signal } from '../types/database'
const now=Date.now(),timestamp=new Date(now-1000).toISOString()
const signal:Signal={id:'signal',user_id:'owner',symbol:'BINANCE:BTCUSDT',direction:'LONG',state:'LONG_READY',entry_price:50000,stop_loss:49000,take_profit:53000,confluence_score:7,rr_ratio:3,quantity:1,payload_hash:null,timeframe:'1m',is_executed:false,received_at:timestamp,raw_payload:{timestamp}}
const account={id:'account',broker:'binance' as const}, settings={screener_symbols:['BINANCE:BTCUSDT'],screener_timeframe:'1m'}
test('an incompatible latest signal does not mask the eligible candidate',()=>{
 const values=[{...signal,id:'short',direction:'SHORT' as const,state:'SHORT_READY' as const},{...signal,id:'wrong-account',raw_payload:{timestamp,_execution_account_id:'other'}},signal]
 assert.deepEqual(values.filter(s=>automaticSignalEligible(s,account,settings,now)).map(s=>s.id),['signal'])
})
test('Angel One permits SHORT candidates, while expired and changed-watchlist signals are excluded',()=>{
 const short={...signal,symbol:'NSE:RELIANCE-EQ',direction:'SHORT' as const,state:'SHORT_READY' as const}
 assert.equal(automaticSignalEligible(short,{id:'angel',broker:'angelone'},{screener_symbols:[short.symbol],screener_timeframe:'1m'},now),true)
 assert.equal(!!automaticSignalEligible(signal,account,{...settings,screener_symbols:[]},now),false)
 assert.equal(!!automaticSignalEligible({...signal,raw_payload:{timestamp:new Date(now-300001).toISOString()}},account,settings,now),false)
 assert.equal(!!automaticSignalEligible({...signal,is_executed:true},account,settings,now),false)
 assert.equal(!!automaticSignalEligible(signal,account,{...settings,execution_config_updated_at:new Date(now).toISOString()},now),false)
 assert.equal(!!automaticSignalEligible({...signal,symbol:'NSE:RELIANCE-EQ'},account,{...settings,screener_symbols:['NSE:RELIANCE-EQ']},now),false)
})
