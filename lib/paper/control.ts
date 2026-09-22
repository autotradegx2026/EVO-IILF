import { z } from 'zod'

// Stop never requires a valid watchlist, healthy feed or broker connection.
export const PaperControlInput = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
z.object({
    enabled: z.literal(true), source: z.enum(['binance', 'tradingview']),
    symbols: z.array(z.string().trim().toUpperCase().regex(/^BINANCE:[A-Z0-9]+USDT$/)).max(5),
    timeframe: z.enum(['1m', '5m', '15m', '1h']),
  }).strict(),
]).superRefine((value, ctx) => {
  if (value.enabled && value.source === 'binance' && (!value.symbols.length || new Set(value.symbols).size !== value.symbols.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose one to five different Binance USDT symbols.' })
  }
})
