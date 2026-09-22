// app/api/trades/[id]/route.ts
import { requireAuth } from '@/lib/supabase/auth'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, supabase } = await requireAuth()

    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !data) {
      return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    }

    return Response.json({ data })
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
