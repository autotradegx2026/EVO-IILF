import { createHash, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { WebhookPayloadSchema } from '../webhook/schema'
import { STRATEGY_VERSION } from './config'

export const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex')
export function verifyDeliveryToken(token: string, hash: string | null | undefined): boolean {
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return false
  return timingSafeEqual(Buffer.from(tokenDigest(token), 'hex'), Buffer.from(hash, 'hex'))
}
export function parseDelivery(raw: unknown, now = Date.now()) {
  const credentials = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), strategy_version: z.literal(STRATEGY_VERSION) }).parse(raw)
  const payload = WebhookPayloadSchema.parse(raw)
  if (!['LONG', 'SHORT'].includes(payload.action)) throw new Error('ENTRY_ALERT_REQUIRED')
  const age = now - Date.parse(payload.timestamp)
  if (age > 300_000 || age < -60_000) throw new Error('STALE_TIMESTAMP')
  // The token is never persisted in an inbox, signal or audit payload.
  return { token: credentials.token, payload }
}
