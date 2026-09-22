// app/api/paper/[id]/close/route.ts
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import type { PaperTrade } from '@/types/database'

const CloseSchema = z.object({
  close_price:  z.number().positive(),
  close_reason: z.literal('MANUAL').default('MANUAL'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, supabase } = await requireAuth()

    // Load trade
    const { data: trade, error: tErr } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (tErr || !trade) {
      return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    const pt = trade as unknown as PaperTrade
    if (pt.status === 'CLOSED') {
      return Response.json({ error: 'ALREADY_CLOSED' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = CloseSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 })
    }

    const {close_price}=parsed.data
    const result=await createServiceClient().rpc('apply_paper_mark',{p_user_id:user.id,p_trade_id:id,p_expected_bar:pt.last_bar_at,p_bar_time:new Date().toISOString(),p_price:close_price,p_close_price:close_price,p_reason:'MANUAL'})
    if (result.error) throw result.error
    const outcome=result.data as {status:string;pnl?:number}
    if (outcome.status!=='CLOSED') return Response.json({error:outcome.status,code:outcome.status},{status:409})
    return Response.json({data:outcome,message:`Manual paper close recorded. PnL: ${outcome.pnl} ${pt.currency}`})
  } catch (res) {
    if (res instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON', code: 'INVALID_JSON' }, { status: 400 })
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
