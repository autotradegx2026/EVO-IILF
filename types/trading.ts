// types/broker.ts

export type ExchangeType = 'NSE' | 'BSE' | 'NFO' | 'MCX' | 'CDS' | 'BINANCE' | 'BYBIT'
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M'
export type ProductType = 'INTRADAY' | 'DELIVERY' | 'CARRYFORWARD' | 'FUTURES' | 'OPTIONS'
export type TransactionType = 'BUY' | 'SELL'
export type OrderStatus = 'PENDING' | 'OPEN' | 'COMPLETE' | 'CANCELLED' | 'REJECTED' | 'UNKNOWN'

export interface OrderRequest {
  symbol: string
  exchange: ExchangeType
  transactionType: TransactionType
  orderType: OrderType
  productType: ProductType
  quantity: number
  price?: number
  triggerPrice?: number
  tag?: string
}

export interface OrderResponse {
  orderId: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  message: string
  rawResponse?: unknown
}

export interface BrokerPosition {
  symbol: string
  exchange: string
  quantity: number
  averagePrice: number
  currentPrice: number
  unrealizedPnl: number
  productType: string
  direction: 'LONG' | 'SHORT'
}

export interface BrokerOrder {
  orderId: string
  status: OrderStatus
  filledQuantity: number
  averagePrice: number | null
}

export interface BrokerAdapter {
  getOrder(orderId: string): Promise<BrokerOrder>
  connect(): Promise<boolean>
  getBalance(): Promise<number>
  placeOrder(order: OrderRequest): Promise<OrderResponse>
  cancelOrder(orderId: string, variety?: 'NORMAL' | 'STOPLOSS'): Promise<boolean>
  getOrderStatus(orderId: string): Promise<OrderStatus>
  getPositions(): Promise<BrokerPosition[]>
  closePosition(symbol: string, exchange: ExchangeType, quantity: number, direction: 'LONG' | 'SHORT'): Promise<boolean>
}

// types/trading.ts
export interface WebhookPayload {
  symbol: string
  action: 'LONG' | 'SHORT' | 'WAIT' | 'COOLDOWN'
  price: number
  sl: number
  tp: number
  rr?: number
  confluence: number
  tf?: string
  timestamp?: string
}

export interface ValidationResult {
  status: 'QUALIFIED' | 'REJECTED'
  reason?: string
  state?: import('./database').SignalState
}

export interface ExecutionResult {
  success: boolean
  tradeId?: string
  error?: string
  entryOrderId?: string
  slOrderId?: string
  tpOrderId?: string
}

export interface PerformanceMetrics {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  grossProfit: number
  grossLoss: number
  netPnl: number
  profitFactor: number | null
  avgRR: number | null
  maxDrawdown: number | null
  maxDrawdownAmount?: number
  breakevenTrades?: number
  rrSampleSize?: number
  maxWinStreak: number
  maxLossStreak: number
  avgConfluenceScore: number
  equityCurve: EquityPoint[]
}

export interface EquityPoint {
  date: string
  pnl: number
  cumulative: number
  symbol: string
  direction: string
}

export interface MonthlyPerformance {
  month: string
  net_pnl: number
  total_trades: number
  win_rate: number
  winning_trades: number
  losing_trades: number
}
