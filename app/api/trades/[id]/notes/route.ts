// app/api/trades/[id]/notes/route.ts
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/auth'

const NotesSchema = z.object({
  notes: z.string().max(2000).optional(),
  screenshot_url: z.string().url().regex(/^https?:\/\//i).max(2048).optional().nullable(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user } = await requireAuth()
    const supabase = createServiceClient()
    const body = await request.json()
    const parsed = NotesSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, { status: 400 })
    }

    const existing = await supabase.from('trades').select('screenshot_url').eq('id', id).eq('user_id', user.id).single()
    if (existing.error || !existing.data) return Response.json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, { status: 404 })
    const replaceScreenshot = Object.prototype.hasOwnProperty.call(parsed.data, 'screenshot_url') && parsed.data.screenshot_url !== existing.data.screenshot_url
    const { data, error } = await supabase
      .from('trades')
      .update({ ...parsed.data, ...(replaceScreenshot ? { screenshot_path: null } : {}) })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, notes, screenshot_url')
      .single()

    if (error || !data) {
      return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    }

    return Response.json({ data, message: 'Notes updated' })
  } catch (res) {
    if (res instanceof SyntaxError) return Response.json({ error: 'INVALID_JSON', code: 'INVALID_JSON' }, { status: 400 })
    if (res instanceof Response) return res
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
