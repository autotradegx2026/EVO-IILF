import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluatePaperBar, PaperBarSchema, type PaperBar, type PaperExitTrade } from '../lib/paper/exit'

const trade: PaperExitTrade = {
  direction: 'LONG', entry_price: 100, stop_loss: 95, take_profit: 115,
  signal_time: '2026-09-07T10:00:00Z', last_bar_at: null,
  session_start: '09:30', session_end: '15:30', session_timezone: 'Etc/UTC',
}
function bar(changes: Partial<PaperBar> = {}): PaperBar {
  return { symbol: 'BINANCE:BTCUSDT', tf: '15m', time: '2026-09-07T10:00:00Z', close_time: '2026-09-07T10:15:00Z', open: 100, high: 110, low: 98, close: 105, ...changes }
}

test('paper bar schema rejects invalid ranges, nonfinite prices and mismatched intervals', () => {
  assert.equal(PaperBarSchema.safeParse(bar()).success, true)
  for (const changes of [{ high: 99 }, { low: 106 }, { open: Infinity }, { close: 0 }, { tf: '1m' }, { close_time: '2026-09-07T09:59:00Z' }, { close_time: '2026-09-07T10:00:00Z' }, { symbol: 'BTCUSDT' }]) {
    assert.equal(PaperBarSchema.safeParse(bar(changes as Partial<PaperBar>)).success, false)
  }
  assert.equal(PaperBarSchema.safeParse(bar({ tf: '60m', close_time: '2026-09-07T11:00:00Z' })).success, true)
  assert.equal(PaperBarSchema.safeParse(bar({ tf: '1h', close_time: '2026-09-07T11:00:00Z' })).success, true)
})

test('shortened final equity candle accepts ampersand symbols and closes at the actual session end', () => {
  const equity = { ...trade, signal_time: '2026-09-07T04:00:00Z', session_timezone: 'Asia/Kolkata' }
  const finalBar = bar({ symbol: 'NSE:M&M-EQ', tf: '1h', time: '2026-09-07T09:45:00Z', close_time: '2026-09-07T10:00:00Z' })
  assert.equal(PaperBarSchema.safeParse(finalBar).success, true)
  assert.deepEqual(evaluatePaperBar(equity, finalBar), { closePrice: 105, reason: 'SESSION_END' })
  assert.equal(PaperBarSchema.safeParse({ ...finalBar, close_time: '2026-09-07T10:46:00Z' }).success, false)
  assert.equal(PaperBarSchema.safeParse({ ...finalBar, close_time: finalBar.time }).success, false)
})

test('long and short exits prioritize stop when a candle touches both brackets', () => {
  assert.deepEqual(evaluatePaperBar(trade, bar({ high: 120, low: 90 })), { closePrice: 95, reason: 'SL_HIT' })
  const short = { ...trade, direction: 'SHORT' as const, stop_loss: 105, take_profit: 85 }
  assert.deepEqual(evaluatePaperBar(short, bar({ high: 110, low: 80 })), { closePrice: 105, reason: 'SL_HIT' })
  assert.deepEqual(evaluatePaperBar(trade, bar({ high: 115 })), { closePrice: 115, reason: 'TP_HIT' })
  assert.deepEqual(evaluatePaperBar(short, bar({ high: 104, low: 85, close: 95 })), { closePrice: 85, reason: 'TP_HIT' })
})

test('adverse gaps fill at open and favorable target gaps retain the target price', () => {
  assert.deepEqual(evaluatePaperBar(trade, bar({ open: 90, low: 89 })), { closePrice: 90, reason: 'SL_HIT' })
  assert.deepEqual(evaluatePaperBar(trade, bar({ open: 120, high: 125, low: 116, close: 122 })), { closePrice: 115, reason: 'TP_HIT' })
  const short = { ...trade, direction: 'SHORT' as const, stop_loss: 105, take_profit: 85 }
  assert.deepEqual(evaluatePaperBar(short, bar({ open: 110, high: 112 })), { closePrice: 110, reason: 'SL_HIT' })
  assert.deepEqual(evaluatePaperBar(short, bar({ open: 80, high: 84, low: 75, close: 82 })), { closePrice: 85, reason: 'TP_HIT' })
})

test('pre-entry, duplicate and older candles cannot close a paper trade', () => {
  const hit = bar({ low: 90 })
  assert.equal(evaluatePaperBar({ ...trade, signal_time: '2026-09-07T10:01:00Z' }, hit), null)
  assert.equal(evaluatePaperBar({ ...trade, last_bar_at: hit.close_time }, hit), null)
  assert.equal(evaluatePaperBar({ ...trade, last_bar_at: '2026-09-07T11:00:00Z' }, hit), null)
  assert.equal(evaluatePaperBar(trade, bar()), null)
})

test('session end is exclusive and a straddling candle closes at its observed close', () => {
  assert.deepEqual(evaluatePaperBar(trade, bar({ time: '2026-09-07T15:15:00Z', close_time: '2026-09-07T15:30:00Z' })), { closePrice: 105, reason: 'SESSION_END' })
  const crossing = bar({ time: '2026-09-07T15:20:00Z', close_time: '2026-09-07T15:35:00Z' })
  assert.deepEqual(evaluatePaperBar(trade, crossing), { closePrice: 105, reason: 'SESSION_END' })
  assert.deepEqual(evaluatePaperBar(trade, { ...crossing, low: 90 }), { closePrice: 95, reason: 'SL_HIT' })
  assert.equal(evaluatePaperBar({ ...trade, session_start: '00:00', session_end: '00:00' }, crossing), null)
})

test('a missed session deadline closes at the next bar open even several days later', () => {
  const reopened = bar({ time: '2026-09-10T10:00:00Z', close_time: '2026-09-10T10:15:00Z', open: 102, high: 120, low: 90 })
  assert.deepEqual(evaluatePaperBar(trade, reopened), { closePrice: 102, reason: 'SESSION_END' })
})

test('overnight sessions remain open across midnight and close at their next end', () => {
  const overnight = { ...trade, signal_time: '2026-09-07T22:30:00Z', session_start: '22:00:00', session_end: '02:00:00' }
  assert.equal(evaluatePaperBar(overnight, bar({ time: '2026-09-08T00:00:00Z', close_time: '2026-09-08T00:15:00Z' })), null)
  assert.deepEqual(evaluatePaperBar(overnight, bar({ time: '2026-09-08T01:45:00Z', close_time: '2026-09-08T02:00:00Z' })), { closePrice: 105, reason: 'SESSION_END' })
})

test('session boundaries use the saved timezone including spring DST skips', () => {
  const india = { ...trade, signal_time: '2026-09-07T04:00:00Z', session_timezone: 'Asia/Kolkata' }
  assert.deepEqual(evaluatePaperBar(india, bar({ time: '2026-09-07T09:45:00Z', close_time: '2026-09-07T10:00:00Z' })), { closePrice: 105, reason: 'SESSION_END' })
  const dst = { ...trade, signal_time: '2026-03-08T06:00:00Z', session_start: '01:00', session_end: '02:30', session_timezone: 'America/New_York' }
  assert.deepEqual(evaluatePaperBar(dst, bar({ time: '2026-03-08T06:45:00Z', close_time: '2026-03-08T07:00:00Z' })), { closePrice: 105, reason: 'SESSION_END' })
})
