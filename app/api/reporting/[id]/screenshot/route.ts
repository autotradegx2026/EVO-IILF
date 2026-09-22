import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { EnvironmentSchema } from '@/lib/reporting/model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const BUCKET = 'trade-screenshots'
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024

type RouteContext = { params: Promise<{ id: string }> }
type AttachmentRow = { id: string; screenshot_path: string | null }

async function selection(request: Request, params: RouteContext['params']) {
  const query = new URL(request.url).searchParams
  const parsed = z.object({ environment: EnvironmentSchema }).strict().safeParse(Object.fromEntries(query))
  const id = z.string().uuid().safeParse((await params).id)
  if (!parsed.success || !id.success || query.getAll('environment').length !== 1) {
    throw Response.json({ error: 'Choose a valid ledger environment and trade.' }, { status: 400 })
  }
  const environment = parsed.data.environment
  const table = environment === 'paper' ? 'paper_trades' : environment === 'legacy' ? 'trades' : 'broker_executions'
  return { id: id.data, environment, table } as const
}

function imageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
    return { mime: 'image/png', extension: 'png' }
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { mime: 'image/jpeg', extension: 'jpg' }
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' }
  }
  return null
}

function ownedPath(path: unknown, userId: string, tradeId: string): path is string {
  if (typeof path !== 'string') return false
  const [owner, trade, filename, extra] = path.split('/')
  return owner === userId && trade === tradeId && extra === undefined
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(filename ?? '')
}

// Bound multipart parsing even when Content-Length is missing or untrustworthy.
async function uploadForm(request: Request): Promise<FormData> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (declaredLength > MAX_BODY_BYTES) throw Response.json({ error: 'Screenshots must be 5 MB or smaller.' }, { status: 413 })
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    throw Response.json({ error: 'Submit a screenshot as multipart form data.' }, { status: 400 })
  }
  const reader = request.body?.getReader()
  if (!reader) throw Response.json({ error: 'A screenshot file is required.' }, { status: 400 })
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_BODY_BYTES) {
        await reader.cancel()
        throw Response.json({ error: 'Screenshots must be 5 MB or smaller.' }, { status: 413 })
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData()
  } catch {
    throw Response.json({ error: 'The screenshot upload could not be read.' }, { status: 400 })
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { user } = await requireAuth()
    const supabase = createServiceClient()
    const { id, environment, table } = await selection(request, params)
    let lookup = supabase.from(table).select('id,screenshot_path').eq('id', id).eq('user_id', user.id)
    if (table === 'broker_executions') lookup = lookup.eq('environment', environment)
    const existing = await lookup.maybeSingle()
    if (existing.error) return Response.json({ error: 'Could not verify the trade.' }, { status: 503 })
    if (!existing.data) return Response.json({ error: 'Trade not found.' }, { status: 404 })
    const previous = existing.data as unknown as AttachmentRow
    const form = await uploadForm(request)
    const file = form.get('file')
    if (!file || typeof file === 'string' || file.size === 0) {
      return Response.json({ error: 'Choose a PNG, JPEG, or WebP screenshot.' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) return Response.json({ error: 'Screenshots must be 5 MB or smaller.' }, { status: 413 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const detected = imageType(bytes)
    if (!detected || file.type !== detected.mime) {
      return Response.json({ error: 'Only PNG, JPEG, or WebP files with a matching image type are supported.' }, { status: 400 })
    }
    const path = `${user.id}/${id}/${randomUUID()}.${detected.extension}`
    const storage = createServiceClient().storage.from(BUCKET)
    const uploaded = await storage.upload(path, bytes, { contentType: detected.mime, upsert: false })
    if (uploaded.error) return Response.json({ error: 'Screenshot upload failed. Please try again.' }, { status: 503 })
    const screenshotUrl = `/api/reporting/${encodeURIComponent(id)}/screenshot?environment=${environment}`
    // Attachments cannot change execution financial fields, version, or timestamps.
    let update = createServiceClient().from(table).update({ screenshot_path: path, screenshot_url: screenshotUrl })
      .eq('id', id).eq('user_id', user.id)
    if (table === 'broker_executions') update = update.eq('environment', environment)
    // Concurrent uploads must not replace or delete one another's accepted attachment.
    update = previous.screenshot_path == null ? update.is('screenshot_path', null) : update.eq('screenshot_path', previous.screenshot_path)
    const updated = await update.select('id,screenshot_url').maybeSingle()
    if (updated.error || !updated.data) {
      await storage.remove([path]).catch(() => undefined)
      return Response.json({ error: 'The screenshot could not be attached to this trade. Please try again.' }, { status: 503 })
    }
    if (ownedPath(previous.screenshot_path, user.id, id)) {
      await storage.remove([previous.screenshot_path]).catch(() => undefined)
    }
    return Response.json({ data: updated.data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: 'The screenshot could not be uploaded. Please try again.' }, { status: 503 })
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { user } = await requireAuth()
    const supabase = createServiceClient()
    const { id, environment, table } = await selection(request, params)
    let lookup = supabase.from(table).select('id,screenshot_path').eq('id', id).eq('user_id', user.id)
    if (table === 'broker_executions') lookup = lookup.eq('environment', environment)
    const result = await lookup.maybeSingle()
    if (result.error) return Response.json({ error: 'Could not load the screenshot.' }, { status: 503 })
    const attachment = result.data as unknown as AttachmentRow | null
    if (!attachment || !ownedPath(attachment.screenshot_path, user.id, id)) {
      return Response.json({ error: 'Screenshot not found.' }, { status: 404 })
    }
    const signed = await createServiceClient().storage.from(BUCKET).createSignedUrl(attachment.screenshot_path, 60)
    if (signed.error || !signed.data?.signedUrl) return Response.json({ error: 'Could not load the screenshot.' }, { status: 503 })
    return new Response(null, { status: 302, headers: {
      Location: signed.data.signedUrl,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    } })
  } catch (error) {
    if (error instanceof Response) return error
    return Response.json({ error: 'Could not load the screenshot.' }, { status: 503 })
  }
}
