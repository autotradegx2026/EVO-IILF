import { createServiceClient } from '@/lib/supabase/server'
import { tokenDigest, verifyDeliveryToken } from '@/lib/strategy/delivery'
import { dispatchStrategyInbox } from '@/lib/paper/dispatch'
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'
const fail = (code: string, status: number) => Response.json({ error: code, code }, { status })
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return fail('CRON_NOT_CONFIGURED', 503)
  if (!verifyDeliveryToken(request.headers.get('authorization') ?? '', tokenDigest(`Bearer ${secret}`))) return fail('UNAUTHORIZED', 401)
  if (process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return fail('DEMO_READ_ONLY', 403)
  try { return Response.json({ data: await dispatchStrategyInbox(createServiceClient()) }) }
  catch { return fail('STRATEGY_DISPATCH_FAILED', 503) }
}
export const GET = POST
