import { z } from 'zod'
import { timeframeMilliseconds } from '../trading/session'
import { PaperBarSchema } from './exit'
import { parseDelivery } from '../strategy/delivery'
import { STRATEGY_VERSION } from '../strategy/config'

export function parsePaperDelivery(raw: unknown, now = Date.now()) {
  const envelope = z.object({ kind: z.literal('BAR'), token: z.string().regex(/^[a-f0-9]{64}$/), strategy_version: z.literal(STRATEGY_VERSION), bar: PaperBarSchema, entry: z.unknown().optional() }).parse(raw)
  const age = now - Date.parse(envelope.bar.close_time)
  if (age < 0 || age > 300_000) throw new Error('STALE_BAR')
  const entry = envelope.entry == null ? null : parseDelivery({ ...(z.record(z.unknown()).parse(envelope.entry)), token: envelope.token }, now).payload
  if (entry && (entry.symbol !== envelope.bar.symbol || Date.parse(entry.timestamp) !== Date.parse(envelope.bar.close_time) || entry.price !== envelope.bar.close || timeframeMilliseconds(entry.tf) !== timeframeMilliseconds(envelope.bar.tf))) throw new Error('ENTRY_BAR_MISMATCH')
  return { token: envelope.token, payload: { kind: 'BAR' as const, bar: envelope.bar, entry }, symbol: envelope.bar.symbol, tf: envelope.bar.tf }
}
