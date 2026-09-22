import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { configFromSettings } from '@/lib/strategy/config'
import { generatePine } from '@/lib/strategy/pine'

export async function GET(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const kind = z.enum(['strategy', 'indicator']).parse(new URL(request.url).searchParams.get('kind') ?? 'strategy')
    const settings = await supabase.from('settings').select('*').eq('user_id', user.id).single()
    if (settings.error || !settings.data) throw new Error('Settings unavailable')
    return new Response(generatePine(configFromSettings(settings.data), kind), { headers: {
      'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="autotradex-${kind}.pine"`, 'Cache-Control': 'private, no-store',
    } })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: error instanceof Error ? error.message : 'Script export failed', code: 'SCRIPT_EXPORT_FAILED' }, { status: 400 })
  }
}
