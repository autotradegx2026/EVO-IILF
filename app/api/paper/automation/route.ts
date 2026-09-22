import { requireAuth } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { readWebhookBody } from '@/lib/webhook/body'
import { PaperControlInput } from '@/lib/paper/control'

export async function POST(request: Request) {
  try {
    const { user } = await requireAuth()
    const input = PaperControlInput.safeParse(JSON.parse(await readWebhookBody(request)))
    if (!input.success) return Response.json({ error: 'Choose one to five different Binance USDT symbols and a supported timeframe.' }, { status: 400 })
    const value = input.data
    const saved = await createServiceClient().rpc('configure_paper_automation', {
      p_user: user.id, p_enabled: value.enabled,
      p_native: value.enabled ? value.source === 'binance' : true,
      p_symbols: value.enabled ? value.symbols : [], p_timeframe: value.enabled ? value.timeframe : '15m',
    })
    if (saved.error) return Response.json({ error: saved.error.code === 'P0001' ? saved.error.message : 'Paper control could not be saved. Refresh and retry.' }, { status: 400 })
    return Response.json({ enabled: value.enabled, message: value.enabled ? 'Paper trading started. The server will check for qualified setups during your saved session.' : 'New paper entries stopped. Open paper positions remain monitored.' })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: 'Paper control unavailable. Refresh and retry.' }, { status: 400 })
  }
}
