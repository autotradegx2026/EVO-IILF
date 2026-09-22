import { evaluateStrategy, type StrategySnapshot, type Factors } from './engine'
import { calculateEMA, type Candle } from './indicators'
import type { StrategyConfig } from './config'
import { timeframeMilliseconds } from '../trading/session'

export function analysisHistorySize(config: StrategyConfig, timeframe: string) {
  return Math.max(500, Math.ceil(86400000 / timeframeMilliseconds(timeframe)) + 50, config.trendEmaLength + 100, config.htfEmaLength + 100)
}
export function buildStrategyAnalysis(config: StrategyConfig, candles: Candle[], higher: Candle[], timeframe: string, now = Date.now()) {
  const snapshots = evaluateStrategy(config, candles, higher, timeframe === config.htfTimeframe.toLowerCase())
  const last = snapshots.at(-1)
  if (!last) throw new Error('No completed market candles available')
  const fresh = now - (last.time + 1) <= 300000 && last.time + 1 <= now + 5000
  const fast = calculateEMA(candles.map(c => c.close),config.fastEmaLength)
  const trend = calculateEMA(candles.map(c => c.close),config.trendEmaLength)
  const start = Math.max(0,candles.length - 80)
  return {
    snapshot: last, fresh, signal: last.qualified && fresh ? last.direction! : 'WAIT' as 'LONG'|'SHORT'|'WAIT',
    candles: candles.slice(start).map((bar,index) => ({...bar,fast:fast[start+index],trend:trend[start+index]})),
    markers: snapshots.slice(start).filter(s => s.qualified && s.direction).map(s=>({time:s.time+1,direction:s.direction!,price:s.price,sl:s.sl,tp:s.tp})),
  }
}
export type AnalysisCandle = Pick<Candle,'time'|'closeTime'|'open'|'high'|'low'|'close'> & { fast?: number|null; trend?:number|null }
export type AnalysisData = {
  symbol:string; timeframe:string; source:string; checkedAt:string; strategyUpdatedAt:string|null;
  signal:'LONG'|'SHORT'|'WAIT'; fresh:boolean; snapshot:(Omit<StrategySnapshot,'longScore'|'shortScore'|'longFactors'|'shortFactors'> & {longScore:number|null;shortScore:number|null;longFactors:Factors|null;shortFactors:Factors|null})|null;
  candles:AnalysisCandle[]; markers:{time:number;direction:'LONG'|'SHORT';price:number;sl:number|null;tp:number|null}[];
  blockers:string[]; execution:{enabled:boolean;environment:string;lastState:string|null;lastUpdatedAt:string|null};
}
