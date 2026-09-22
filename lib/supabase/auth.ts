// lib/supabase/auth.ts
import { createClient } from './server'
import { isPersonalAccount } from './personal-access'

export async function requireAuth() {
  if (process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    throw Response.json({ error: 'DEMO_READ_ONLY', code: 'DEMO_READ_ONLY' }, { status: 403 })
  }
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Response(
      JSON.stringify({ error: 'UNAUTHORIZED', code: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!isPersonalAccount(user.email)) throw Response.json({ error: 'ACCOUNT_NOT_ALLOWED', code: 'ACCOUNT_NOT_ALLOWED' }, { status: 403 })

  const profile = await supabase.from('users').select('is_active').eq('id', user.id).single()
  if (profile.error || !profile.data?.is_active) throw Response.json({ error: 'ACCOUNT_UNAVAILABLE', code: 'ACCOUNT_UNAVAILABLE' }, { status: 403 })
  return { user, supabase }
}
