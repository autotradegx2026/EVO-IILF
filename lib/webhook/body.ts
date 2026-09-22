/** Bound memory while reading an unauthenticated request, including chunked bodies. */
export async function readWebhookBody(request: Request, limit = 16_384): Promise<string> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new Error('PAYLOAD_TOO_LARGE')
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('PAYLOAD_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
