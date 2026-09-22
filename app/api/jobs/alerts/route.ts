import { createHash, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { sendAlertEmail } from '@/lib/notifications/email'
import type { Alert } from '@/types/database'

export const runtime = 'nodejs'
export const maxDuration = 300

const fail = (error: string, status: number) => Response.json({ error, code: error }, { status })

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret?.trim()) return fail('CRON_NOT_CONFIGURED', 503)
  const authorization = request.headers.get('authorization') ?? ''
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) return fail('UNAUTHORIZED', 401)
  if (process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return fail('DEMO_READ_ONLY', 403)
  if (process.env.ALERT_EMAILS_ENABLED !== 'true') return fail('ALERT_EMAILS_DISABLED', 403)
  if (!process.env.RESEND_API_KEY) return fail('EMAIL_NOT_CONFIGURED', 503)

  try {
    const supabase = createServiceClient()
    // The database leases at most 20 pending alerts using SKIP LOCKED and a five-minute retry delay.
    const claim = await supabase.rpc('claim_email_alerts', {})
    if (claim.error || !Array.isArray(claim.data)) return fail('ALERT_CLAIM_FAILED', 503)
    const alerts = (claim.data as Alert[]).slice(0, 20)
    if (!alerts.length) return Response.json({ claimed: 0, sent: 0, failed: 0, skipped: 0 })
    const recipients = await supabase.from('users').select('id, email').in('id', Array.from(new Set(alerts.map(alert => alert.user_id)))).eq('is_active', true)
    if (recipients.error) return fail('RECIPIENT_LOOKUP_FAILED', 503)
    const emails = new Map((recipients.data ?? []).map(user => [user.id, user.email]))
    let sent = 0, failed = 0, skipped = 0
    for (const alert of alerts) {
      const to = emails.get(alert.user_id)
      if (!to) { skipped++; continue }
      const accepted = await sendAlertEmail({ to, type: alert.type, title: alert.title, message: alert.message }, alert.id)
      if (!accepted) { failed++; continue }
      // A crash between provider acceptance and this write is safe to retry using the alert UUID.
      const update = await supabase.from('alerts').update({ delivered_email: true }).eq('id', alert.id).eq('user_id', alert.user_id)
      if (update.error) { failed++; continue }
      sent++
    }
    return Response.json({ claimed: alerts.length, sent, failed, skipped })
  } catch {
    return fail('ALERT_DISPATCH_FAILED', 503)
  }
}
