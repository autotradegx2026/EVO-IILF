export type Environment = 'testnet' | 'live'
export type OrderState = 'NEW' | 'PARTIAL' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED' | 'UNKNOWN'
export type Purpose = 'ENTRY' | 'STOP' | 'TARGET' | 'CLOSE'
export type Intent = {
  clientId: string; purpose: Purpose; side: 'BUY' | 'SELL'; type: 'MARKET' | 'STOP' | 'LIMIT'
  quantity: number; price?: number; trigger?: number
  state: 'PREPARED' | 'SUBMITTING' | 'ACKNOWLEDGED' | 'REJECTED'
  orderId?: string; submittedAt?: string; snapshot?: OrderSnapshot
}
export type OrderSnapshot = {
  orderId: string; clientId: string; state: OrderState; quantity: number; filled: number
  averagePrice: number; quoteAmount: number; baseFee: number; quoteFee: number
  otherFees: Record<string, number>; listId?: string
}
export type Instrument = {
  symbol: string; base: string; quote: string; price: number; tick: number; step: number
  minQuantity: number; maxQuantity: number; minNotional: number; maxNotional?: number
}
export type Submission = { outcome: 'ACCEPTED'; orderId?: string } | { outcome: 'REJECTED'; reason: string } | { outcome: 'UNKNOWN'; reason: string }
export interface ExecutionBroker {
  readonly venue: 'angelone' | 'binance'
  readonly environment: Environment
  readonly nativeOco: boolean
  readonly longOnly: boolean
  connect(): Promise<void>
  instrument(symbol: string): Promise<Instrument>
  availableQuote(symbol: string): Promise<number>
  availableBase(symbol: string): Promise<number>
  lookup(symbol: string, intent: Intent): Promise<OrderSnapshot | null>
  submit(symbol: string, intent: Intent): Promise<Submission>
  cancel(symbol: string, intent: Intent): Promise<void>
  protect?(symbol: string, stop: Intent, target: Intent, listClientId: string): Promise<Submission>
}
export type Execution = {
  notes?:string|null; screenshot_path?:string|null; screenshot_url?:string|null
  id: string; user_id: string; broker_account_id: string; signal_id: string; automatic?: boolean
  environment: Environment; symbol: string; direction: 'LONG' | 'SHORT'; currency: string
  state: 'QUEUED' | 'ENTERING' | 'PROTECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'REJECTED' | 'ATTENTION'
  requested_quantity: number; signal_price: number; stop_loss: number; take_profit: number; rr: number; risk_budget: number
  intents: Intent[]; entry_quantity: number; exit_quantity: number; entry_price: number; exit_price: number
  gross_pnl: number; quote_fees: number; other_fees: Record<string, number>; residual_quantity: number
  close_reason: string | null; error: string | null; closing_requested: boolean
  session_end: string; session_timezone: string; session_start: string; deadline_at: string
  created_at: string; updated_at: string; version: number
}
export const terminal = (state: OrderState) => ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(state)
// Convert decimal strings to integer units before rounding; do not use binary remainder for exchange steps.
export function roundStep(value: number, step: number, direction: 'floor' | 'ceil' = 'floor'): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(step) || step <= 0) throw new Error('INVALID_PRECISION')
  const scale = BigInt(1000000000000)
  const integer = (n: number) => BigInt(n.toFixed(12).replace('.', ''))
  const v = integer(value), s = integer(step)
  if (s <= BigInt(0)) throw new Error('UNSUPPORTED_PRECISION')
  const units = direction === 'ceil' ? (v + s - BigInt(1)) / s : v / s
  return Number(units * s) / Number(scale)
}
export function assertQuantity(quantity: number, price: number, rules: Instrument) {
  if (!Number.isFinite(quantity) || quantity < rules.minQuantity || quantity > rules.maxQuantity || quantity * price < rules.minNotional || (rules.maxNotional && quantity * price > rules.maxNotional)) throw new Error('INSTRUMENT_LIMITS')
}
