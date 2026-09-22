import { randomBytes } from 'crypto'
import { requireAuth } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { tokenDigest } from '@/lib/strategy/delivery'

export async function POST() {
  try {
    const { user } = await requireAuth()
    const token = randomBytes(32).toString('hex')
    const supabase = createServiceClient()
    const current = await supabase.from('settings').select('webhook_secret').eq('user_id', user.id).single()
    if (current.error) throw current.error
    const update = await supabase.from('settings').update({ delivery_token_hash: tokenDigest(token),
      ...(!current.data.webhook_secret ? { webhook_secret: randomBytes(32).toString('hex') } : {}),
    }).eq('user_id', user.id)
    if (update.error) throw update.error
    return Response.json({ data: { token, userId: user.id } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: 'TOKEN_CREATION_FAILED', code: 'TOKEN_CREATION_FAILED' }, { status: 503 })
  }
}
