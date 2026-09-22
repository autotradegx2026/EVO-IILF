import { z } from 'zod'
import { StrategyConfigSchema } from '../strategy/config'

export const WebhookPayloadSchema = z.object({
  // Do not fill missing reported inputs with defaults before comparing them.
  strategy_config: StrategyConfigSchema.partial().optional(),
  strategy_version: z.literal('evo-iilf-1.0').optional(),
  symbol: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9:_&. -]+$/).transform(s => s.toUpperCase()),
  action: z.enum(['LONG', 'SHORT', 'WAIT', 'COOLDOWN']),
  price: z.number().finite().positive(),
  sl: z.number().finite().positive(),
  tp: z.number().finite().positive(),
  rr: z.number().finite().positive().optional(),
  confluence: z.number().int().min(0).max(7),
  // Pine labels an hourly chart "60m"; the saved broker watchlist uses "1h".
  tf: z.string().regex(/^[1-9]\d{0,3}(s|m|h|d|w)?$/i).default('1m').transform(value => {
    const tf = /^\d+$/.test(value) ? `${value}m` : value.toLowerCase()
    return tf === '60m' ? '1h' : tf
  }),
  timestamp: z.string().datetime({ offset: true }),
  factors: z.record(z.boolean()).optional(),
}).superRefine((p, ctx) => {
  if (p.strategy_version) {
    const keys = ['trend', 'vwap', 'delta', 'volume', 'sweep', 'fvg', 'ob']
    if (!p.factors || keys.some(k => typeof p.factors?.[k] !== 'boolean') || Object.keys(p.factors).length !== 7 || keys.filter(k => p.factors?.[k]).length !== p.confluence || !p.factors.trend) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Versioned EVO alerts require exactly seven factors matching the score and a confirmed trend', path: ['factors'] })
    }
  }
  if ((p.action === 'LONG' && !(p.sl < p.price && p.tp > p.price)) ||
      (p.action === 'SHORT' && !(p.tp < p.price && p.sl > p.price))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SL and TP must bracket entry in the trade direction', path: ['sl'] })
  }
})
