import { StrategyConfigSchema, type StrategyConfig } from './config'

// Compare the actual inputs reported by Pine, not just the script's release name.
export function strategyMatches(actual: unknown, expected: StrategyConfig): boolean {
  if (!actual || typeof actual !== 'object' || Object.keys(expected).some(key => !Object.hasOwn(actual, key) || (actual as Record<string, unknown>)[key] === undefined)) return false
  const parsed = StrategyConfigSchema.safeParse(actual)
  return parsed.success && Object.keys(expected).every(key => parsed.data[key as keyof StrategyConfig] === expected[key as keyof StrategyConfig])
}
