import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildStrategyAnalysis, analysisHistorySize } from '../lib/strategy/analysis'
import { canonicalSymbol, signalFresh } from '../lib/strategy/signal-state'
import { StrategyConfigSchema } from '../lib/strategy/config'
import { evaluateStrategy } from '../lib/strategy/engine'
import type { Candle } from '../lib/strategy/indicators'

const time=Date.parse('2026-09-06T06:00:00Z')
const config=StrategyConfigSchema.parse({trendEmaLength:3,fastEmaLength:2,htfEmaLength:2,htfTimeframe:'1H',adxLength:2,atrLength:2,minConfluenceScore:1,sessionStart:'00:00',sessionEnd:'00:00'})
const bars=():Candle[]=>Array.from({length:41},(_,i)=>({time:time+i*3600000,closeTime:time+(i+1)*3600000-1,open:100,close:i===40?104:100,high:i===40?106:101,low:i===40?95:99,volume:i===40?1000:100,takerBuyVolume:50}))
test('chart LONG result and marker match the actual engine including stops and targets',()=>{
 const candles=bars(),end=candles.at(-1)!.closeTime+1, result=buildStrategyAnalysis(config,candles,candles,'1h',end+1000)
 assert.equal(result.signal,'LONG')
 assert.deepEqual(result.snapshot,evaluateStrategy(config,candles,candles,true).at(-1))
 assert.equal(result.markers.at(-1)?.direction,'LONG');assert.equal(result.markers.at(-1)?.time,end)
 assert.equal(result.markers.at(-1)?.sl,result.snapshot.sl);assert.equal(result.markers.at(-1)?.tp,result.snapshot.tp)
 assert.deepEqual(result.candles.map(c=>c.close),candles.map(c=>c.close))
})
test('chart SHORT setup is distinct from an order; stale results become WAIT',()=>{
 const candles=bars().map(b=>({...b,open:200-b.open,close:200-b.close,high:200-b.low,low:200-b.high}))
 const end=candles.at(-1)!.closeTime+1, result=buildStrategyAnalysis(config,candles,candles,'1h',end+1000)
 assert.equal(result.signal,'SHORT');assert.equal(result.markers.at(-1)?.direction,'SHORT')
 const stale=buildStrategyAnalysis(config,candles,candles,'1h',end+300001)
 assert.equal(stale.signal,'WAIT');assert.equal(stale.fresh,false);assert.equal(stale.markers.at(-1)?.direction,'SHORT')
 assert.equal('execution' in result,false)
})
test('saved confluence changes affect chart signal and preserve actual candles',()=>{
 const candles=bars(),now=candles.at(-1)!.closeTime+1000
 const strict=buildStrategyAnalysis({...config,minConfluenceScore:7},candles,candles,'1h',now)
 assert.equal(strict.signal,'WAIT');assert.ok(strict.snapshot.reasons.includes('Low confluence'))
 assert.equal(strict.candles.at(-1)?.close,104)
})
test('all native analysis paths reserve enough same-timeframe HTF and daily VWAP warmup',()=>{
 assert.ok(analysisHistorySize({...config,htfEmaLength:1000},'1h')>=1100)
 assert.ok(analysisHistorySize(config,'1m')>=1490)
})
test('display and routing reject expired or future signals and normalize Indian cash chart symbols',()=>{
 assert.equal(signalFresh(new Date(time).toISOString(),time+300000),true)
 assert.equal(signalFresh(new Date(time).toISOString(),time+300001),false)
 assert.equal(signalFresh(new Date(time+30001).toISOString(),time),false)
 assert.equal(signalFresh('invalid',time),false)
 assert.equal(canonicalSymbol('NSE:RELIANCE'),'NSE:RELIANCE-EQ')
 assert.equal(canonicalSymbol('NSE:RELIANCE-EQ'),'NSE:RELIANCE-EQ')
 assert.equal(canonicalSymbol('BINANCE:BTCUSDT'),'BINANCE:BTCUSDT')
})
