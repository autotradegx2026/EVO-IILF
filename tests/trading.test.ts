import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac } from 'node:crypto'
import { calculatePositionSize } from '../lib/trading/position-size'
import { marketDayStart, isWithinSession, timeframeMilliseconds } from '../lib/trading/session'
import { verifySignature } from '../lib/webhook/validate'
import { WebhookPayloadSchema } from '../lib/webhook/schema'
import { placeProtectedEntry } from '../lib/trading/order-flow'
import type { BrokerAdapter, OrderRequest } from '../types/trading'

test('sizing never exceeds risk budget or rounds up an unaffordable lot', () => {
  assert.equal(calculatePositionSize(10000, 1, 100, 99, 25), 100)
  assert.equal(calculatePositionSize(100, 1, 100, 99, 25), 0)
  for (const stop of [100, 0, NaN, Infinity]) assert.equal(calculatePositionSize(10000, 1, 100, stop), 0)
  assert.equal(calculatePositionSize(0, 1, 100, 90), 0)
  assert.equal(calculatePositionSize(10000, 1, 100, 90, 2.5), 0)
})

test('India session/day boundaries are independent of server timezone', () => {
  assert.equal(marketDayStart(new Date('2026-09-05T20:00:00Z')), '2026-09-05T18:30:00.000Z')
  assert.equal(isWithinSession(new Date('2026-09-07T03:45:00Z'), '09:15', '15:30'), true)
  assert.equal(isWithinSession(new Date('2026-09-07T03:44:00Z'), '09:15', '15:30'), false)
  assert.equal(isWithinSession(new Date('2026-09-07T18:00:00Z'), '22:00', '02:00'), true)
  assert.equal(timeframeMilliseconds('15m'), 900000)
  assert.equal(timeframeMilliseconds('4H'), 14400000)
  assert.equal(timeframeMilliseconds('garbage'), 0)
})

test('market days use the selected timezone rather than the server timezone', () => {
  const now = new Date('2026-09-05T20:00:00Z')
  assert.equal(marketDayStart(now, 'Etc/UTC'), '2026-09-05T00:00:00.000Z')
  assert.equal(marketDayStart(now, 'Asia/Kolkata'), '2026-09-05T18:30:00.000Z')
  assert.equal(marketDayStart(now, 'America/New_York'), '2026-09-05T04:00:00.000Z')
  assert.equal(marketDayStart(new Date('2026-09-05T18:30:00Z')), '2026-09-05T18:30:00.000Z')
})

test('New York market midnight uses the offset before a daylight-saving transition', () => {
  const zone = 'America/New_York'
  const springStart = marketDayStart(new Date('2026-03-08T16:00:00Z'), zone)
  const springNext = marketDayStart(new Date('2026-03-09T16:00:00Z'), zone)
  assert.equal(springStart, '2026-03-08T05:00:00.000Z')
  assert.equal(springNext, '2026-03-09T04:00:00.000Z')
  assert.equal(Date.parse(springNext) - Date.parse(springStart), 23 * 3_600_000)
  const fallStart = marketDayStart(new Date('2026-11-01T17:00:00Z'), zone)
  const fallNext = marketDayStart(new Date('2026-11-02T17:00:00Z'), zone)
  assert.equal(fallStart, '2026-11-01T04:00:00.000Z')
  assert.equal(fallNext, '2026-11-02T05:00:00.000Z')
  assert.equal(Date.parse(fallNext) - Date.parse(fallStart), 25 * 3_600_000)
  for (const repeatedHour of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) {
    assert.equal(marketDayStart(new Date(repeatedHour), zone), fallStart)
  }
})

test('a civil day starts at the first available instant when DST skips midnight', () => {
  assert.equal(marketDayStart(new Date('2018-11-04T15:00:00Z'), 'America/Sao_Paulo'), '2018-11-04T03:00:00.000Z')
})

test('sessions include their start, exclude their end and support overnight and all-day windows', () => {
  assert.equal(isWithinSession(new Date('2026-09-07T10:00:00Z'), '09:30', '15:30'), false)
  assert.equal(isWithinSession(new Date('2026-09-07T09:59:59Z'), '09:30:00', '15:30:00'), true)
  assert.equal(isWithinSession(new Date('2026-09-07T09:30:00Z'), '09:30', '15:30', 'Etc/UTC'), true)
  assert.equal(isWithinSession(new Date('2026-09-07T15:30:00Z'), '09:30', '15:30', 'Etc/UTC'), false)
  for (const time of ['22:00:00', '23:59:59', '00:00:00', '01:59:59']) {
    assert.equal(isWithinSession(new Date(`2026-09-07T${time}Z`), '22:00', '02:00', 'Etc/UTC'), true)
  }
  assert.equal(isWithinSession(new Date('2026-09-07T02:00:00Z'), '22:00', '02:00', 'Etc/UTC'), false)
  assert.equal(isWithinSession(new Date('2026-09-07T12:00:00Z'), '22:00', '02:00', 'Etc/UTC'), false)
  assert.equal(isWithinSession(new Date('2026-09-07T03:00:00Z'), '09:30', '09:30', 'Etc/UTC'), true)
})

test('New York sessions follow local wall time across DST changes', () => {
  const zone = 'America/New_York'
  assert.equal(isWithinSession(new Date('2026-03-06T14:30:00Z'), '09:30', '16:00', zone), true)
  assert.equal(isWithinSession(new Date('2026-03-09T13:30:00Z'), '09:30', '16:00', zone), true)
  assert.equal(isWithinSession(new Date('2026-03-09T13:29:59Z'), '09:30', '16:00', zone), false)
  assert.equal(isWithinSession(new Date('2026-11-02T14:30:00Z'), '09:30', '16:00', zone), true)
  assert.equal(isWithinSession(new Date('2026-11-02T21:00:00Z'), '09:30', '16:00', zone), false)
})

test('webhook signatures bind exact raw bytes and reject missing signatures', () => {
  const raw = '{"action":"LONG"}', secret = 'test-secret'
  const signature = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
  assert.equal(verifySignature(raw, signature, secret), true)
  assert.equal(verifySignature(raw + ' ', signature, secret), false)
  assert.equal(verifySignature(raw, null, secret), false)
  assert.equal(verifySignature(raw, 'sha256=abc', secret), false)
})

test('payload requires replay timestamp, seven factors, and directional price geometry', () => {
  const payload = { symbol: 'NSE:INFY-EQ', action: 'LONG', price: 100, sl: 90, tp: 120, confluence: 6, timestamp: '2026-09-06T10:00:00Z' }
  assert.equal(WebhookPayloadSchema.safeParse(payload).success, true)
  for (const patch of [{ sl: 110 }, { tp: 80 }, { confluence: 8 }, { timestamp: undefined }]) {
    assert.equal(WebhookPayloadSchema.safeParse({ ...payload, ...patch }).success, false)
  }
})

const entry: OrderRequest = { symbol: 'INFY-EQ', exchange: 'NSE', transactionType: 'BUY', orderType: 'MARKET', productType: 'INTRADAY', quantity: 10 }
function fixture(options: { partial?: boolean; reject?: boolean; unknown?: boolean; slFailed?: boolean } = {}) {
  const calls: OrderRequest[] = []
  const broker = {
    async placeOrder(order: OrderRequest) {
      calls.push(order)
      if (options.reject || (options.slFailed && calls.length === 2)) return { status: 'FAILED', orderId: '', message: 'rejected' }
      if (options.unknown) return { status: 'PENDING', orderId: '', message: 'timeout' }
      return { status: 'SUCCESS', orderId: String(calls.length), message: 'ok' }
    },
    async getOrder(id: string) { return { orderId: id, status: id === '1' ? 'COMPLETE' : 'OPEN', filledQuantity: id === '1' ? (options.partial ? 5 : 10) : 0, averagePrice: id === '1' ? 101 : null } },
  } as unknown as BrokerAdapter
  return { broker, calls }
}

test('entry is persisted and confirmed filled before protective orders', async () => {
  const { broker, calls } = fixture(), saved: string[] = []
  await placeProtectedEntry(broker, entry, 90, 120, async (stage, id, price) => { saved.push(`${stage}:${id}:${price ?? ''}`) })
  assert.deepEqual(calls.map(c => c.orderType), ['MARKET', 'SL-M', 'LIMIT'])
  assert.deepEqual(saved, ['entry:1:', 'entry:1:101', 'sl:2:', 'tp:3:'])
  assert.equal(calls[1].transactionType, 'SELL')
})

test('partial fills, rejections and ambiguous submissions cannot create full-size exits', async () => {
  for (const options of [{ partial: true }, { reject: true }, { unknown: true }]) {
    const { broker, calls } = fixture(options)
    await assert.rejects(placeProtectedEntry(broker, entry, 90, 120, async () => {}))
    assert.equal(calls.length, 1)
  }
})

test('failed stop loss or database persistence stops further submissions', async () => {
  const failedSL = fixture({ slFailed: true })
  await assert.rejects(placeProtectedEntry(failedSL.broker, entry, 90, 120, async () => {}), /STOP_LOSS/)
  assert.equal(failedSL.calls.length, 2)
  const failedDB = fixture()
  await assert.rejects(placeProtectedEntry(failedDB.broker, entry, 90, 120, async () => { throw new Error('database unavailable') }), /database unavailable/)
  assert.equal(failedDB.calls.length, 1)
})

test('chunked webhook payloads cannot exceed the memory limit', async () => {
  const { readWebhookBody } = await import('../lib/webhook/body')
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10)); controller.enqueue(new Uint8Array(10)); controller.close() } })
  const request = new Request('http://localhost', { method: 'POST', body, duplex: 'half' } as RequestInit)
  await assert.rejects(readWebhookBody(request, 16), /PAYLOAD_TOO_LARGE/)
  assert.equal(await readWebhookBody(new Request('http://localhost', { method: 'POST', body: 'hello' })), 'hello')
})
