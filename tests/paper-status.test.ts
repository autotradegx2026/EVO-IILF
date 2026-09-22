import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paperAutomationStatus, type PaperConfiguration } from '../lib/paper/status'

const now = Date.parse('2026-09-06T06:00:00Z')
const recent = new Date(now - 60000).toISOString()
const worker = { last_started_at: recent, last_finished_at: recent, status: 'DONE' }
const config: PaperConfiguration = { paper_trading_enabled: true, paper_auto_scan: true, signal_delivery_mode: 'paper', kill_switch_active: false, paper_last_scan_at: recent, paper_scan_error: null, session_start: '09:30', session_end: '15:30', session_timezone: 'Asia/Kolkata', rr_ratio: 3, risk_percent: 1, max_trades_per_day: 3, max_daily_loss_pct: 3, min_confluence_score: 5, updated_at: recent }

test('a healthy shared worker does not imply this account has enabled paper entries', () => {
  assert.equal(paperAutomationStatus({ ...config, paper_trading_enabled: false }, worker, now).label, 'Paper trading is off')
  assert.equal(paperAutomationStatus({ ...config, paper_auto_scan: false }, worker, now).label, 'TradingView paper delivery selected')
  assert.equal(paperAutomationStatus({ ...config, kill_switch_active: true }, worker, now).label, 'New paper entries paused')
})

test('scanner health needs both worker and account updates, independent of webhook arrivals', () => {
  assert.equal(paperAutomationStatus(config, worker, now).healthy, true)
  assert.equal(paperAutomationStatus(config, null, now).healthy, false)
  assert.equal(paperAutomationStatus(config, { ...worker, last_finished_at: new Date(now + 60000).toISOString() }, now).healthy, false)
  assert.equal(paperAutomationStatus({ ...config, paper_last_scan_at: null }, worker, now).label, 'Waiting for first paper scan')
  assert.equal(paperAutomationStatus({ ...config, paper_last_scan_at: new Date(now - 240000).toISOString() }, worker, now).label, 'Paper scanner update overdue')
  assert.equal(paperAutomationStatus({ ...config, paper_last_scan_at: 'invalid' }, worker, now).healthy, false)
})

test('failed runs and scan errors cannot appear as healthy automation', () => {
  assert.equal(paperAutomationStatus(config, { ...worker, status: 'FAILED' }, now).healthy, false)
  assert.equal(paperAutomationStatus({ ...config, paper_scan_error: 'MARKET_DATA_UNAVAILABLE' }, worker, now).detail, 'MARKET_DATA_UNAVAILABLE')
  assert.equal(paperAutomationStatus(null, worker, now).label, 'Automation settings unavailable')
})

test('enabled scanning outside the saved session is waiting for session, not connection', () => {
  const later = Date.parse('2026-09-06T16:00:00Z'), time = new Date(later - 60000).toISOString()
  assert.equal(paperAutomationStatus(config, { ...worker, last_finished_at: time }, later).label, 'Waiting for trading session')
})
