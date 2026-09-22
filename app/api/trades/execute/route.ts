// app/api/trades/execute/route.ts
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { executeTrade } from '@/lib/trading/execution'

const ExecuteSchema = z.object({
  signal_id: z.string().uuid(),
  broker_account_id: z.string().uuid(),
  confirm: z.literal(true),
})

export async function POST(request: Request) {
  try {
    const { user } = await requireAuth()

    const body = await request.json()
    const parsed = ExecuteSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'INVALID_REQUEST', details: parsed.error.flatten() }, { status: 400 })
    }

    const result = await executeTrade(parsed.data.signal_id, parsed.data.broker_account_id, user.id)

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 400 })
    }

    return Response.json({ data: result, message: 'Trade queued. Follow broker fills in Broker Automation.' },{status:202})

  } catch (res) {
    if (res instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON', code: 'INVALID_JSON' }, { status: 400 })
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
