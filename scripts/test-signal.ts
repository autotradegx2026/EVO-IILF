import { createHmac } from 'node:crypto'

async function main() {
  const secret = process.env.WEBHOOK_SECRET
  const userId = process.env.TEST_USER_ID
  const origin = process.env.TEST_APP_URL ?? 'http://localhost:3000'
  if (!secret || !userId) throw new Error('Set WEBHOOK_SECRET and TEST_USER_ID')
  const url = new URL('/api/webhook/paper', origin)
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('This test sender only targets a local app')
  url.searchParams.set('uid', userId)
  const body = JSON.stringify({ symbol: 'NSE:INFY-EQ', action: 'LONG', price: 100, sl: 95, tp: 110,
    confluence: 6, tf: '15m', timestamp: new Date().toISOString() })
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature }, body })
  process.stdout.write(`${response.status} ${await response.text()}\n`)
  if (!response.ok) process.exitCode = 1
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Test failed'}\n`); process.exitCode = 1 })
