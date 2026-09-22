import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PaperControlInput } from '../lib/paper/control'
import { paperAutomationStatus, type PaperConfiguration } from '../lib/paper/status'

test('paper stop needs no account, credentials, market feed or watchlist', () => {
  assert.deepEqual(PaperControlInput.parse({enabled:false}), {enabled:false})
  assert.equal(PaperControlInput.safeParse({enabled:false,auto_enabled:true}).success,false)
})
test('native paper start requires explicit valid, distinct symbols and timeframe', () => {
  const start={enabled:true,source:'binance',symbols:['BINANCE:BTCUSDT'],timeframe:'1m'}
  assert.equal(PaperControlInput.safeParse(start).success,true)
  for (const change of [{symbols:[]},{symbols:['BTCUSDT']},{symbols:['NSE:TEST-EQ']},{symbols:['BINANCE:BTCUSDT','BINANCE:BTCUSDT']},{timeframe:'1s'},{auto_enabled:true},{kill_switch_active:false}]) {
    assert.equal(PaperControlInput.safeParse({...start,...change}).success,false,JSON.stringify(change))
  }
})
test('paper market scanner runs independently of broker signal delivery', () => {
  const now=Date.now(), recent=new Date(now-1000).toISOString()
  const config={paper_trading_enabled:true,paper_auto_scan:true,signal_delivery_mode:'signals',kill_switch_active:false,paper_last_scan_at:recent,session_start:'00:00',session_end:'00:00',session_timezone:'Etc/UTC'} as PaperConfiguration
  assert.equal(paperAutomationStatus(config,{last_started_at:recent,last_finished_at:recent,status:'DONE'},now).healthy,true)
  assert.equal(paperAutomationStatus({...config,paper_trading_enabled:false},null,now).label,'Paper trading is off')
  assert.equal(paperAutomationStatus({...config,paper_auto_scan:false},null,now).label,'Paper delivery needs configuration')
})
