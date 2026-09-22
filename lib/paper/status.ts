import type { Settings } from '../../types/database'
import { isWithinSession } from '../trading/session'

export type PaperConfiguration = Pick<Settings, 'paper_trading_enabled' | 'paper_started_at' | 'paper_stopped_at' | 'paper_symbols' | 'paper_timeframe' | 'screener_timeframe' | 'paper_auto_scan' | 'signal_delivery_mode' | 'kill_switch_active' | 'paper_last_scan_at' | 'paper_scan_error' | 'session_start' | 'session_end' | 'session_timezone' | 'rr_ratio' | 'risk_percent' | 'max_trades_per_day' | 'max_daily_loss_pct' | 'min_confluence_score' | 'screener_symbols' | 'updated_at' | 'execution_config_updated_at'>
export type PaperWorkerHealth = { last_started_at: string | null; last_finished_at: string | null; status?: string }

export function paperAutomationStatus(config: PaperConfiguration | null, worker: PaperWorkerHealth | null, now: number) {
  const state = (label: string, detail: string, healthy = false) => ({ label, detail, healthy })
  if (!config) return state('Automation settings unavailable', 'Refresh to load your saved configuration.')
  if (!config.paper_trading_enabled) return state('Paper trading is off', 'Start paper trading to scan for new simulated entries. Existing positions continue to receive exit checks.')
  if (!config.paper_auto_scan && config.signal_delivery_mode !== 'paper') return state('Paper delivery needs configuration', 'Select paper delivery in Strategy & Screener for TradingView alerts, or use the Binance market scanner here.')
  if (config.kill_switch_active) return state('New paper entries paused', 'The entry kill switch is active. Existing paper positions still need market candles for exits.')
  if (!config.paper_auto_scan) return state('TradingView paper delivery selected', 'Automatic Binance scanning is off. Paper entries require qualifying TradingView alerts; keep candle alerts running for exits.')
  const heartbeat = Date.parse(worker?.last_finished_at ?? worker?.last_started_at ?? '')
  if (!Number.isFinite(heartbeat) || now - heartbeat > 180_000 || heartbeat - now > 5000) return state('Paper worker heartbeat unavailable or stale', 'Automatic scanning is enabled, but a recent worker heartbeat is missing.')
  if (worker?.status === 'FAILED') return state('Paper worker needs attention', 'The latest worker run failed. Automatic scanning is enabled, but healthy execution is not confirmed.')
  if (config.paper_scan_error) return state('Paper scanner needs attention', config.paper_scan_error)
  if (!isWithinSession(new Date(now), config.session_start, config.session_end, config.session_timezone)) return state('Waiting for trading session', `Scanning is enabled for ${config.session_start.slice(0, 5)}–${config.session_end.slice(0, 5)} (${config.session_timezone ?? 'Asia/Kolkata'}).`)
  const scan = Date.parse(config.paper_last_scan_at ?? '')
  if (!Number.isFinite(scan)) return state('Waiting for first paper scan', 'Automatic scanning is enabled. The next scheduled worker run will check for qualified setups.')
  if (now - scan > 180_000 || scan - now > 5000) return state('Paper scanner update overdue', 'The worker has a recent heartbeat, but this account has no recent scan update.')
  return state('Automatic paper scanning enabled', 'The worker and account scan have recent updates. Trades open only when the saved strategy and risk checks qualify a setup. No TradingView webhook is required for Binance scanning.', true)
}
