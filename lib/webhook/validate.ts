// lib/webhook/validate.ts
import crypto from 'crypto'

export function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export function computePayloadHash(symbol: string, action: string, price: number, timestamp?: string): string {
  const canonical = `${symbol}:${action}:${price}:${timestamp ?? ''}`
  return crypto.createHash('sha256').update(canonical).digest('hex')
}
