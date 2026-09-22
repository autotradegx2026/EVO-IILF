import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePaperDelivery } from '../lib/paper/delivery'
const token='a'.repeat(64),now=Date.parse('2026-09-06T10:01:00Z')
const bar={symbol:'BINANCE:BTCUSDT',tf:'1m',time:'2026-09-06T10:00:00Z',close_time:'2026-09-06T10:01:00Z',open:100,high:101,low:99,close:100}
const packet={kind:'BAR',token,strategy_version:'evo-iilf-1.0',bar}
test('paper candle delivery strips secrets and rejects incomplete/future/stale bars',()=>{
 const parsed=parsePaperDelivery(packet,now)
 assert.equal(parsed.token,token);assert.equal(JSON.stringify(parsed.payload).includes(token),false)
 assert.throws(()=>parsePaperDelivery(packet,now-1));assert.throws(()=>parsePaperDelivery(packet,now+300001))
 assert.throws(()=>parsePaperDelivery({...packet,bar:{...bar,low:102}},now))
})
test('entry must refer to the delivered candle and match its timeframe',()=>{
 const entry={symbol:bar.symbol,action:'LONG',price:100,sl:99,tp:103,rr:3,confluence:5,tf:'1m',timestamp:bar.close_time,strategy_version:'evo-iilf-1.0',factors:{trend:true,vwap:true,delta:true,volume:true,sweep:true,fvg:false,ob:false}}
 const parsed=parsePaperDelivery({...packet,entry:{...entry,token}},now)
 assert.equal(JSON.stringify(parsed.payload).includes(token),false)
 for(const change of [{price:100.5},{tf:'15m'},{symbol:'BINANCE:ETHUSDT'},{timestamp:'2026-09-06T10:00:00Z'}]) assert.throws(()=>parsePaperDelivery({...packet,entry:{...entry,...change}},now))
})
test('Pine hourly signals match the saved one-hour broker timeframe',()=>{
 const close='2026-09-06T11:00:00Z'
 const entry={symbol:bar.symbol,action:'SHORT',price:100,sl:101,tp:97,rr:3,confluence:5,tf:'60m',timestamp:close,strategy_version:'evo-iilf-1.0',factors:{trend:true,vwap:true,delta:true,volume:true,sweep:true,fvg:false,ob:false}}
 const parsed=parsePaperDelivery({...packet,bar:{...bar,tf:'60m',close_time:close},entry},Date.parse(close))
 assert.equal(parsed.payload.entry?.tf,'1h')
 assert.equal(parsed.payload.entry?.action,'SHORT')
})
