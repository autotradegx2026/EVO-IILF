import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildHtml, escapeHtml, sendAlertEmail } from '../lib/notifications/email'

test('email templates escape user-controlled content', () => {
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;')
  const html = buildHtml({ to: 'test@example.com', type: 'LONG_ENTRY', title: '<img src=x>', message: '<script>alert(1)</script>', tradeDetails: { symbol: '<b>ABC</b>', direction: 'LONG' } })
  assert.equal(html.includes('<script>'), false)
  assert.equal(html.includes('<img src=x>'), false)
  assert.ok(html.includes('&lt;img src=x&gt;'))
})

test('disabled email delivery performs no provider request', async () => {
  const original = process.env.ALERT_EMAILS_ENABLED, previousFetch = global.fetch
  process.env.ALERT_EMAILS_ENABLED = 'false'
  global.fetch = async () => { throw new Error('A disabled sender must not call fetch') }
  try { assert.equal(await sendAlertEmail({ to: 'test@example.com', type: 'SYSTEM', title: 'Test', message: 'Test' }, 'test-id'), false) }
  finally { if (original === undefined) delete process.env.ALERT_EMAILS_ENABLED; else process.env.ALERT_EMAILS_ENABLED = original; global.fetch = previousFetch }
})
