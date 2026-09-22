// lib/notifications/email.ts
// Resend email service — transactional alerts for AutotradeX
// Delivery is opt-in; this module never sends while demo mode is enabled.
import type { AlertType } from '@/types/database'

export type AlertEmailPayload = {
  to: string
  type: AlertType
  title: string
  message: string
  tradeDetails?: {
    symbol: string
    direction: string
    entry?: number
    sl?: number
    tp?: number
    pnl?: number
    quantity?: number
  }
}

const TYPE_EMOJI: Record<AlertType, string> = {
  LONG_ENTRY:        '🟢',
  SHORT_ENTRY:       '🔴',
  SL_HIT:            '❌',
  TP_HIT:            '✅',
  EXECUTION_SUCCESS: '⚡',
  ORDER_REJECTED:    '⚠️',
  DAILY_LOSS_LOCK:   '🔒',
  SESSION_END:       '🕐',
  COOLDOWN_START:    '⏳',
  SYSTEM:            '📊',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}

function dashboardUrl(): string | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? '')
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null
  } catch { return null }
}

export function buildHtml(payload: AlertEmailPayload): string {
  const emoji = TYPE_EMOJI[payload.type] ?? '📊'
  const details = payload.tradeDetails
  const appUrl = dashboardUrl()
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(payload.title)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #f0f0f0; margin: 0; padding: 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: #141414; border: 1px solid #222; border-radius: 12px; overflow: hidden;">

    <!-- Header -->
    <div style="background: #1a1a1a; padding: 20px 24px; border-bottom: 1px solid #222;">
      <div style="font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">
        AutotradeX · GrindX Technologies
      </div>
      <div style="font-size: 20px; font-weight: 700; color: #f0f0f0;">
        ${emoji} ${escapeHtml(payload.title)}
      </div>
    </div>

    <!-- Body -->
    <div style="padding: 20px 24px;">
      <p style="color: #bbb; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
        ${escapeHtml(payload.message)}
      </p>

      ${details ? `
      <!-- Trade Details -->
      <div style="background: #1a1a1a; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Trade Details</div>
        <table style="width: 100%; border-collapse: collapse;">
          ${details.symbol ? `<tr><td style="color: #888; font-size: 13px; padding: 4px 0;">Symbol</td><td style="color: #f0f0f0; font-size: 13px; text-align: right; font-weight: 600;">${escapeHtml(details.symbol)}</td></tr>` : ''}
          ${details.direction ? `<tr><td style="color: #888; font-size: 13px; padding: 4px 0;">Direction</td><td style="color: ${details.direction === 'LONG' ? '#22c55e' : '#ef4444'}; font-size: 13px; text-align: right; font-weight: 700;">${escapeHtml(details.direction)}</td></tr>` : ''}
          ${details.entry != null ? `<tr><td style="color: #888; font-size: 13px; padding: 4px 0;">Entry</td><td style="color: #f0f0f0; font-size: 13px; text-align: right; font-family: monospace;">₹${details.entry.toLocaleString('en-IN')}</td></tr>` : ''}
          ${details.sl != null ? `<tr><td style="color: #888; font-size: 13px; padding: 4px 0;">Stop Loss</td><td style="color: #ef4444; font-size: 13px; text-align: right; font-family: monospace;">₹${details.sl.toLocaleString('en-IN')}</td></tr>` : ''}
          ${details.tp != null ? `<tr><td style="color: #888; font-size: 13px; padding: 4px 0;">Take Profit</td><td style="color: #22c55e; font-size: 13px; text-align: right; font-family: monospace;">₹${details.tp.toLocaleString('en-IN')}</td></tr>` : ''}
          ${details.quantity != null ? `<tr><td style="color: #888; font-size: 13px; padding: 4px 0;">Quantity</td><td style="color: #f0f0f0; font-size: 13px; text-align: right;">${details.quantity}</td></tr>` : ''}
          ${details.pnl != null ? `<tr style="border-top: 1px solid #333;"><td style="color: #888; font-size: 13px; padding: 8px 0 4px;">P&amp;L</td><td style="color: ${details.pnl >= 0 ? '#22c55e' : '#ef4444'}; font-size: 16px; text-align: right; font-weight: 700; padding: 8px 0 4px;">₹${details.pnl >= 0 ? '+' : ''}${details.pnl.toLocaleString('en-IN')}</td></tr>` : ''}
        </table>
      </div>
      ` : ''}

      ${appUrl ? `<a href="${escapeHtml(appUrl)}"
         style="display: inline-block; background: #18181b; border: 1px solid #333; color: #f0f0f0; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;">
        View Dashboard →
      </a>` : ''}
    </div>

    <!-- Footer -->
    <div style="padding: 16px 24px; border-top: 1px solid #222; text-align: center;">
      <div style="font-size: 11px; color: #555;">
        AutotradeX · GrindX Technologies PVT LTD ·
        ${appUrl ? `<a href="${escapeHtml(appUrl)}/settings" style="color: #555;">Account settings</a>` : ''}
      </div>
    </div>

  </div>
</body>
</html>
`
}

export async function sendAlertEmail(payload: AlertEmailPayload, idempotencyKey?: string): Promise<boolean> {
  if (process.env.ALERT_EMAILS_ENABLED !== 'true' || process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return false
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false

  try {
    // Resend retains this key for 24 hours; the dispatcher only claims alerts younger than that.
    // https://resend.com/docs/dashboard/emails/idempotency-keys
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        // The Resend sandbox sender is the default; production requires your configured verified sender.
        from: process.env.RESEND_FROM_EMAIL || 'AutotradeX <onboarding@resend.dev>',
        to: [payload.to],
        subject: `${TYPE_EMOJI[payload.type]} ${payload.title}`,
        html: buildHtml(payload),
        text: `${payload.title}\n\n${payload.message}`,
      }),
    })
    if (!res.ok) return false
    const result: unknown = await res.json()
    return typeof result === 'object' && result !== null && 'id' in result && typeof result.id === 'string' && result.id.length > 0
  } catch {
    return false
  }
}

// Convenience wrappers
export async function sendTradeExecutedEmail(to: string, details: AlertEmailPayload['tradeDetails'] & { symbol: string; direction: string }) {
  return sendAlertEmail({
    to, type: 'EXECUTION_SUCCESS',
    title: `Trade Executed — ${details.symbol} ${details.direction}`,
    message: `Your ${details.direction} trade on ${details.symbol} has been executed successfully with entry, SL and TP orders placed.`,
    tradeDetails: details,
  })
}

export async function sendSignalEmail(to: string, type: 'LONG_ENTRY' | 'SHORT_ENTRY', details: AlertEmailPayload['tradeDetails'] & { symbol: string; direction: string; confluence: number }) {
  return sendAlertEmail({
    to, type,
    title: `${type === 'LONG_ENTRY' ? 'LONG' : 'SHORT'} Signal Ready — ${details.symbol}`,
    message: `New ${type === 'LONG_ENTRY' ? 'long' : 'short'} signal qualified with confluence score ${details.confluence}/7. Review and confirm on dashboard.`,
    tradeDetails: details,
  })
}

export async function sendPnLEmail(to: string, type: 'SL_HIT' | 'TP_HIT', details: AlertEmailPayload['tradeDetails'] & { symbol: string; direction: string }) {
  const label = type === 'TP_HIT' ? 'Take Profit Hit' : 'Stop Loss Hit'
  return sendAlertEmail({
    to, type,
    title: `${label} — ${details.symbol}`,
    message: `Your ${details.direction} position on ${details.symbol} has been closed. ${type === 'TP_HIT' ? 'Target reached.' : 'Stop loss triggered.'}`,
    tradeDetails: details,
  })
}

export async function sendDailyLossLockEmail(to: string, lossPercent: number) {
  return sendAlertEmail({
    to, type: 'DAILY_LOSS_LOCK',
    title: 'Daily Loss Limit Reached — Trading Locked',
    message: `Your daily loss of ${lossPercent.toFixed(1)}% has triggered the safety lock. No new trades will execute today. Trading resumes tomorrow at market open.`,
  })
}
