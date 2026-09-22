import { z } from 'zod'

export const STRATEGY_VERSION = 'evo-iilf-1.0'
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const StrategyConfigSchema = z.object({
  fastEmaLength: z.number().int().min(1).max(200).default(20),
  trendEmaLength: z.number().int().min(2).max(500).default(200),
  htfEmaLength: z.number().int().min(1).max(1000).default(50),
  htfTimeframe: z.enum(['1H', '2H', '4H', '1D', '1W']).default('1H'),
  adxLength: z.number().int().min(2).max(50).default(14),
  adxThreshold: z.number().min(0).max(100).default(20),
  atrLength: z.number().int().min(2).max(50).default(14),
  deltaLength: z.number().int().min(1).max(50).default(14),
  swingLookback: z.number().int().min(2).max(100).default(10),
  volumeMultiplier: z.number().min(0).max(10).default(1.5),
  atrMultiplier: z.number().min(0.000001).max(10).default(1.5),
  minConfluenceScore: z.number().int().min(1).max(7).default(5),
  vwapEnabled: z.boolean().default(true), deltaEnabled: z.boolean().default(true),
  fvgEnabled: z.boolean().default(true), obEnabled: z.boolean().default(true),
  riskPct: z.number().min(0.000001).max(10).default(1),
  rrRatio: z.number().min(0.000001).max(20).default(3),
  cooldownBars: z.number().int().min(0).max(100).default(10),
  sessionStart: clock.default('09:30'), sessionEnd: clock.default('15:30'),
  sessionTimezone: z.enum(['Asia/Kolkata', 'Etc/UTC', 'America/New_York', 'Europe/London']).default('Asia/Kolkata'),
}).strict()
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>
export const CLIENT_DEFAULTS = StrategyConfigSchema.parse({})

export function validateStrategy(config: StrategyConfig): string | null {
  if (config.fastEmaLength >= config.trendEmaLength) return 'Fast EMA must be shorter than trend EMA'
  const maximum = 3 + Number(config.vwapEnabled) + Number(config.deltaEnabled) + Number(config.fvgEnabled) + Number(config.obEnabled)
  if (config.minConfluenceScore > maximum) return `Only ${maximum} scoring factors are enabled; lower the minimum score`
  return null
}

const settingKeys: Record<keyof StrategyConfig, string> = {
  fastEmaLength: 'fast_ema_length', trendEmaLength: 'trend_ema_length', htfEmaLength: 'htf_ema_length', htfTimeframe: 'htf_timeframe',
  adxLength: 'adx_length', adxThreshold: 'adx_threshold', atrLength: 'atr_length', deltaLength: 'delta_length', swingLookback: 'swing_lookback',
  volumeMultiplier: 'volume_multiplier', atrMultiplier: 'atr_multiplier', minConfluenceScore: 'min_confluence_score',
  vwapEnabled: 'vwap_enabled', deltaEnabled: 'delta_enabled', fvgEnabled: 'fvg_enabled', obEnabled: 'ob_enabled',
  riskPct: 'risk_percent', rrRatio: 'rr_ratio', cooldownBars: 'cooldown_bars', sessionStart: 'session_start', sessionEnd: 'session_end', sessionTimezone: 'session_timezone',
}
export function configFromSettings(settings: Record<string, unknown>): StrategyConfig {
  const value = Object.fromEntries(Object.entries(settingKeys).map(([key, column]) => [key, settings[column]]))
  for (const key of ['sessionStart', 'sessionEnd']) if (typeof value[key] === 'string') value[key] = value[key].slice(0, 5)
  return StrategyConfigSchema.parse(value)
}
export function configToSettings(config: StrategyConfig): Record<string, unknown> {
  return Object.fromEntries(Object.entries(settingKeys).map(([key, column]) => [column, config[key as keyof StrategyConfig]]))
}
export function localParts(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(time)
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return { day: `${get('year')}-${get('month')}-${get('day')}`, clock: `${get('hour')}:${get('minute')}` }
}
export function strategySession(time: number, config: Pick<StrategyConfig, 'sessionStart' | 'sessionEnd' | 'sessionTimezone'>): boolean {
  const clock = localParts(time, config.sessionTimezone).clock
  return config.sessionStart === config.sessionEnd || (config.sessionStart < config.sessionEnd
    ? clock >= config.sessionStart && clock < config.sessionEnd : clock >= config.sessionStart || clock < config.sessionEnd)
}
