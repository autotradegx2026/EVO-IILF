import test from 'node:test'
import assert from 'node:assert/strict'
import {CLIENT_DEFAULTS} from '../lib/strategy/config'
import {strategyMatches} from '../lib/strategy/identity'
import {generatePine} from '../lib/strategy/pine'
import {WebhookPayloadSchema} from '../lib/webhook/schema'
test('an old TradingView strategy cannot pass with only the same release version',()=>{
 assert.equal(strategyMatches(undefined,CLIENT_DEFAULTS),false)
 assert.equal(strategyMatches({},CLIENT_DEFAULTS),false)
 const partial=WebhookPayloadSchema.parse({strategy_config:{},symbol:'BINANCE:BTCUSDT',action:'LONG',price:100,sl:99,tp:103,confluence:5,timestamp:new Date().toISOString()})
 assert.equal(strategyMatches(partial.strategy_config,CLIENT_DEFAULTS),false)
 assert.equal(strategyMatches(CLIENT_DEFAULTS,CLIENT_DEFAULTS),true)
 for(const change of [{minConfluenceScore:3},{riskPct:2},{htfTimeframe:'4H'},{sessionTimezone:'Etc/UTC'},{volumeMultiplier:2}]) assert.equal(strategyMatches({...CLIENT_DEFAULTS,...change},CLIENT_DEFAULTS),false)
})
test('both Pine exports report actual editable inputs for server configuration checks',()=>{
 for(const kind of ['strategy','indicator'] as const){
  const source=generatePine(CLIENT_DEFAULTS,kind)
  assert.ok(source.includes('strategyConfig() =>'))
  assert.ok(source.includes('str.tostring(minimumScore)'))
  assert.ok(source.includes('jsonBool(useFVG)'))
  assert.ok(source.includes('jsonQuote(sessionZone)'))
  assert.ok(source.includes('strategy_config'))
 }
})
