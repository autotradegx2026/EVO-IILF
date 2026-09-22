import type { Signal, Settings } from '../../types/database'
import { signalFresh } from '../strategy/signal-state'

export function automaticSignalEligible(signal: Signal, account: {id:string;broker:'binance'|'angelone'}, settings: Pick<Settings,'screener_symbols'|'screener_timeframe'|'execution_config_updated_at'>, now=Date.now()) {
  return !signal.is_executed && ['LONG_READY','SHORT_READY'].includes(signal.state)
    && settings.screener_symbols?.includes(signal.symbol) && settings.screener_timeframe===signal.timeframe
    && signalFresh(signal.received_at,now) && signalFresh(String(signal.raw_payload?.timestamp??''),now)
    && (!signal.raw_payload?._execution_account_id || signal.raw_payload._execution_account_id===account.id)
    && (!settings.execution_config_updated_at || (signal.raw_payload?._execution_config_updated_at ? Date.parse(String(signal.raw_payload._execution_config_updated_at))===Date.parse(settings.execution_config_updated_at) : Date.parse(signal.received_at)>=Date.parse(settings.execution_config_updated_at)))
    && (account.broker==='binance' ? /^BINANCE:[A-Z0-9]+USDT$/.test(signal.symbol) : /^(NSE|BSE):/.test(signal.symbol))
    && (account.broker!=='binance' || signal.direction==='LONG')
}
export const EXPECTED_ENTRY_BLOCKS = new Set(['AUTOMATION_DISABLED','EXECUTION_DISABLED','SIGNAL_CONFIGURATION_CHANGED','SIGNAL_NOT_EXECUTABLE','SIGNAL_EXPIRED','SIGNAL_BROKER_ENVIRONMENT_MISMATCH','STRATEGY_CHANGED_WAIT_FOR_NEW_SIGNAL','BINANCE_SPOT_LONG_ONLY','PRICE_DRIFT_EXCEEDED','STOP_ALREADY_CROSSED','SESSION_CLOSED','TOO_CLOSE_TO_SESSION_END','ANGEL_SESSION_CLOSED','MAX_TRADES_REACHED','DAILY_LOSS_LOCKED','COOLDOWN_ACTIVE','RISK_BUDGET_EXCEEDED','SIGNAL_CONFLUENCE_OR_RR','LEGACY_EXPOSURE_REQUIRES_RECONCILIATION'])
