import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'

const environment = z.enum(['paper', 'testnet', 'live', 'system', 'legacy'])
const alertType = z.enum(['LONG_ENTRY', 'SHORT_ENTRY', 'SL_HIT', 'TP_HIT', 'EXECUTION_SUCCESS', 'ORDER_REJECTED', 'DAILY_LOSS_LOCK', 'SESSION_END', 'COOLDOWN_START', 'SYSTEM'])
const currency = z.string().regex(/^[A-Z0-9]{2,12}$/)
const filters = { environment: environment.default('paper'), currency: currency.optional(), type: alertType.optional() }
const querySchema = z.object({
  ...filters,
  unread: z.enum(['0', '1']).default('0'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict()
const patchSchema = z.union([
  z.object({ ...filters, ids: z.array(z.string().uuid()).min(1).max(200) }).strict(),
  z.object({ ...filters, mark_all: z.literal(true) }).strict(),
])
const publicColumns = 'id,type,title,message,is_read,created_at,environment,currency,source_id'

function failure(error: unknown) {
  if (error instanceof Response) return error
  if (error instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON' }, { status: 400 })
  return Response.json({ error: 'ALERTS_REQUEST_FAILED' }, { status: 500 })
}

export async function GET(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const params = new URL(request.url).searchParams
    // Reject ambiguous repeated parameters as well as unsupported filters.
    if (Array.from(params.keys()).some(key => params.getAll(key).length !== 1)) return Response.json({ error: 'VALIDATION_ERROR' }, { status: 400 })
    const parsed = querySchema.safeParse(Object.fromEntries(params))
    if (!parsed.success) return Response.json({ error: 'VALIDATION_ERROR' }, { status: 400 })
    const f = parsed.data
    let query = supabase.from('alerts').select(publicColumns, { count: 'exact' }).eq('user_id', user.id).eq('environment', f.environment)
    if (f.currency) query = query.eq('currency', f.currency)
    if (f.type) query = query.eq('type', f.type)
    if (f.unread === '1') query = query.eq('is_read', false)
    const { data, count, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range((f.page - 1) * f.limit, f.page * f.limit - 1)
    if (error) throw error

    // Read only IDs and currencies, across the owner's whole selected environment.
    // Keyset pagination keeps options independent from the feed page and filters.
    const currencies = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      let options = supabase.from('alerts').select('id,currency').eq('user_id', user.id).eq('environment', f.environment).not('currency', 'is', null).order('id', { ascending: true }).limit(1000)
      if (cursor) options = options.gt('id', cursor)
      const batch = await options
      if (batch.error) throw batch.error
      const rows = (batch.data ?? []) as unknown as Array<{ id: string; currency: string | null }>
      for (const row of rows) if (row.currency && currency.safeParse(row.currency).success) currencies.add(row.currency)
      if (rows.length < 1000) break
      cursor = rows[rows.length - 1].id
    }
    return Response.json({ data: data ?? [], count: count ?? 0, page: f.page, limit: f.limit, currencies: Array.from(currencies).sort() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await requireAuth()
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'VALIDATION_ERROR' }, { status: 400 })
    const f = parsed.data
    let query = supabase.from('alerts').update({ is_read: true }, { count: 'exact' }).eq('user_id', user.id).eq('environment', f.environment).eq('is_read', false)
    if (f.currency) query = query.eq('currency', f.currency)
    if (f.type) query = query.eq('type', f.type)
    if ('ids' in f) query = query.in('id', f.ids)
    const { error, count } = await query
    if (error) throw error
    return Response.json({ count: count ?? 0, message: 'Matching alerts marked read' })
  } catch (error) { return failure(error) }
}
