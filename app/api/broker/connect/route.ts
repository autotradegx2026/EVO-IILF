// app/api/broker/connect/route.ts
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { encrypt } from '@/lib/crypto'

const ConnectSchema = z.object({
  broker_name: z.literal('angelone'),
  api_key:     z.string().min(1),
  api_secret:  z.string().min(1),    // password for Angel One
  totp_secret: z.string().min(16).max(128).regex(/^[A-Z2-7]+=*$/i), // Angel One TOTP
  client_id:   z.string().min(1).max(100), // client code for Angel One
})

export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const body = await request.json()
    const parsed = ConnectSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 })
    }

    const { broker_name, api_key, api_secret, totp_secret, client_id } = parsed.data

    // Encrypt credentials before storing
    const api_key_encrypted    = encrypt(api_key)
    const api_secret_encrypted = encrypt(api_secret)
    const access_token_encrypted = totp_secret ? encrypt(totp_secret) : null

    // Deactivate existing accounts for same broker
    await supabase
      .from('broker_accounts')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('broker_name', broker_name)

    const { data, error } = await supabase
      .from('broker_accounts')
      .insert({
        user_id: user.id,
        broker_name,
        api_key_encrypted,
        api_secret_encrypted,
        access_token_encrypted,
        client_id: client_id ?? null,
        is_active: true,
        is_connected: false,
        account_balance: 0,
        last_synced_at: null,
      })
      .select('id, broker_name, client_id, is_active, is_connected, created_at')
      .single()

    if (error) throw error

    return Response.json({ data, message: 'Broker account added. Test connection to verify.' }, { status: 201 })
  } catch (res) {
    if (res instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON', code: 'INVALID_JSON' }, { status: 400 })
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
