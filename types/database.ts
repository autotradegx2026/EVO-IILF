// types/database.ts
// Hand-written types matching the schema in supabase/migrations/001_initial_schema.sql
// Replace with auto-generated types once Supabase project is set up:
// npx supabase gen types typescript --project-id YOUR_ID > types/database.ts

export type UserRole = 'trader' | 'admin'
export type BrokerName = 'angelone' | 'zerodha' | 'upstox' | 'binance' | 'bybit' | 'ibkr'
export type TradeDirection = 'LONG' | 'SHORT'
export type SignalState = 'LONG_READY' | 'SHORT_READY' | 'WAIT' | 'COOLDOWN' | 'REJECTED'
export type TradeStatus = 'OPEN' | 'CLOSED' | 'PARTIAL' | 'REJECTED' | 'PENDING'
export type CloseReason = 'SL_HIT' | 'TP_HIT' | 'MANUAL' | 'SESSION_END' | 'SIGNAL' | 'FORCE'
export type WebhookStatus = 'RECEIVED' | 'VALIDATED' | 'REJECTED' | 'DUPLICATE' | 'PROCESSED'
export type AlertType =
  | 'LONG_ENTRY' | 'SHORT_ENTRY' | 'SL_HIT' | 'TP_HIT'
  | 'EXECUTION_SUCCESS' | 'ORDER_REJECTED' | 'DAILY_LOSS_LOCK'
  | 'SESSION_END' | 'COOLDOWN_START' | 'SYSTEM'
export type PerformancePeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export type User = {
  id: string
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Settings = {
  execution_config_updated_at?: string
  adx_length?: number
  atr_length?: number
  delta_length?: number
  swing_lookback?: number
  session_timezone?: string
  screener_symbols?: string[]
  screener_timeframe?: string
  signal_delivery_mode?: 'signals' | 'paper'
  paper_trading_enabled?: boolean
  paper_started_at?: string | null
  paper_stopped_at?: string | null
  paper_symbols?: string[]
  paper_timeframe?: string
  paper_auto_scan?: boolean
  paper_last_scan_at?: string | null
  paper_scan_error?: string | null
  delivery_token_hash?: string | null
  id: string
  user_id: string
  trend_ema_length: number
  fast_ema_length: number
  htf_ema_length: number
  htf_timeframe: string
  adx_threshold: number
  volume_multiplier: number
  atr_multiplier: number
  min_confluence_score: number
  risk_percent: number
  rr_ratio: number
  cooldown_bars: number
  max_trades_per_day: number
  max_daily_loss_pct: number
  vwap_enabled: boolean
  delta_enabled: boolean
  fvg_enabled: boolean
  ob_enabled: boolean
  session_start: string
  session_end: string
  webhook_secret: string | null
  kill_switch_active: boolean
  updated_at: string
}

export type BrokerAccount = {
  id: string
  user_id: string
  broker_name: BrokerName
  api_key_encrypted: string
  api_secret_encrypted: string
  access_token_encrypted: string | null
  client_id: string | null
  account_balance: number
  is_active: boolean
  is_connected: boolean
  last_synced_at: string | null
  created_at: string
}

export type Signal = {
  id: string
  user_id: string
  symbol: string
  direction: TradeDirection | 'WAIT'
  state: SignalState
  entry_price: number
  stop_loss: number
  take_profit: number
  confluence_score: number
  rr_ratio: number | null
  quantity: number | null
  timeframe: string | null
  payload_hash: string | null
  is_executed: boolean
  raw_payload: Record<string, unknown> | null
  received_at: string
}

export type Trade = {
  screenshot_path?: string | null
  close_order_id?: string | null
  execution_error?: string | null
  exchange?: string
  closing_requested?: boolean
  id: string
  user_id: string
  signal_id: string | null
  broker_account_id: string | null
  broker_order_id: string | null
  sl_order_id: string | null
  tp_order_id: string | null
  symbol: string
  direction: TradeDirection
  entry_price: number
  stop_loss: number
  take_profit: number
  quantity: number
  status: TradeStatus
  close_price: number | null
  pnl: number
  close_reason: CloseReason | null
  confluence_score: number | null
  notes: string | null
  screenshot_url: string | null
  opened_at: string
  closed_at: string | null
}

export type Position = {
  id: string
  user_id: string
  trade_id: string
  broker_account_id: string | null
  symbol: string
  direction: TradeDirection
  quantity: number
  entry_price: number
  current_price: number | null
  unrealized_pnl: number
  stop_loss: number | null
  take_profit: number | null
  broker_position_id: string | null
  is_open: boolean
  last_updated: string
}

export type WebhookLog = {
  id: string
  user_id: string | null
  raw_payload: Record<string, unknown>
  status: WebhookStatus
  rejection_reason: string | null
  signal_id: string | null
  ip_address: string | null
  received_at: string
  processed_at: string | null
}

export type Alert = {
  environment?:'paper'|'testnet'|'live'|'legacy'|'system';currency?:string|null;source_id?:string|null;event_key?:string|null;metadata?:Record<string,unknown>
  email_attempts?: number
  email_last_attempt_at?: string | null
  id: string
  user_id: string
  type: AlertType
  title: string
  message: string
  trade_id: string | null
  is_read: boolean
  delivered_email: boolean
  created_at: string
}

export type PerformanceSummary = {
  id: string
  user_id: string
  period: PerformancePeriod
  period_start: string
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  gross_profit: number
  gross_loss: number
  net_pnl: number
  profit_factor: number
  avg_rr_achieved: number
  max_drawdown: number
  avg_confluence_score: number
  calculated_at: string
}

export type PaperCloseReason = 'SL_HIT' | 'TP_HIT' | 'MANUAL' | 'SESSION_END'
export type PaperTradeStatus = 'OPEN' | 'CLOSED'

export type PaperTrade = {
  screenshot_path?:string|null;screenshot_url?:string|null
  timeframe: string
  signal_time: string
  last_bar_at: string | null
  current_price: number | null
  unrealized_pnl: number
  monitor_error: string | null
  last_checked_at: string | null
  currency: string
  source: 'manual' | 'tradingview' | 'binance'
  session_start: string
  session_end: string
  session_timezone: string
  payload_hash?: string | null
  id: string
  user_id: string
  signal_id: string | null
  symbol: string
  direction: TradeDirection
  entry_price: number
  stop_loss: number
  take_profit: number
  quantity: number
  initial_capital: number
  risk_percent: number
  rr_ratio: number | null
  confluence_score: number | null
  status: PaperTradeStatus
  close_price: number | null
  pnl: number
  pnl_percent: number
  close_reason: PaperCloseReason | null
  notes: string | null
  opened_at: string
  closed_at: string | null
}

export type PaperObservation = {
  analysis?: {direction:string|null;longScore:number;shortScore:number;factors:Record<string,boolean>;adx:number|null;atr:number|null;minimumScore:number;configRevision:string|null}|null
  user_id: string; symbol: string; timeframe: string; checked_at: string; bar_close: string | null;
  price: number | null; score: number | null; status: string; reasons: string[]
}

// R<T>: widens T to satisfy Record<string, unknown> required by Supabase GenericSchema.
// Without this, TypeScript conditional types reject plain object types lacking index
// signatures, causing SupabaseClient<Database> to resolve Schema as `never` and all
// .from() queries to return never-typed data.
type R<T> = T & Record<string, unknown>

// Supabase Database type — must match GenericSchema from @supabase/postgrest-js
// Required shape: Tables (with Relationships), Views, Functions, Enums, CompositeTypes
export type Database = {
  public: {
    Tables: {
      paper_analysis_history: {
        Row: R<PaperObservation & {id:string;config_revision:string}>
        Insert: R<PaperObservation & {id?:string;config_revision:string}>
        Update: R<Partial<PaperObservation>>
        Relationships: []
      }
      paper_observations: {
        Row: R<PaperObservation>
        Insert: R<PaperObservation>
        Update: R<Partial<PaperObservation>>
        Relationships: []
      }
      execution_accounts: {
        Row: R<{id:string;user_id:string;broker:'angelone'|'binance';environment:'testnet'|'live';label:string;credentials_encrypted:string;connected:boolean;last_checked_at:string|null;error:string|null;created_at:string}>
        Insert: R<{user_id:string;broker:'angelone'|'binance';environment:'testnet'|'live';label:string;credentials_encrypted:string}>
        Update: R<{connected?:boolean;last_checked_at?:string;error?:string|null}>
        Relationships: []
      }
      execution_observations: {
        Row: R<{id:number;user_id:string;account_id:string;environment:string;symbol:string;timeframe:string;bar_close:string;observed_at:string;config_hash:string;config:Record<string,unknown>;qualified:boolean;direction:string|null;score:number;price:number;reasons:string[]}>
        Insert: R<{user_id:string;account_id:string;environment:string;symbol:string;timeframe:string;bar_close:string;config_hash:string;config:Record<string,unknown>;qualified:boolean;direction:string|null;score:number;price:number;reasons:string[]}>
        Update: R<{qualified?:boolean}>
        Relationships: []
      }
      execution_settings: {
        Row: R<{user_id:string;account_id:string|null;auto_enabled:boolean;max_price_drift_bps:number;updated_at:string}>
        Insert: R<{user_id:string;account_id?:string|null;auto_enabled?:boolean;max_price_drift_bps?:number}>
        Update: R<{account_id?:string|null;auto_enabled?:boolean;max_price_drift_bps?:number;updated_at?:string}>
        Relationships: []
      }
      broker_executions: {
        Row: R<import('../lib/execution/model').Execution>
        Insert: R<Partial<import('../lib/execution/model').Execution>>
        Update: R<Partial<import('../lib/execution/model').Execution>>
        Relationships: []
      }
      execution_events: {
        Row: R<{id:number;execution_id:string;user_id:string;state:string;detail:Record<string,unknown>;created_at:string}>
        Insert: R<{execution_id:string;user_id:string;state:string;detail:Record<string,unknown>}>
        Update: R<{detail:Record<string,unknown>}>
        Relationships: []
      }
      execution_worker: {
        Row: R<{name:string;lease_id:string|null;lease_until:string|null;heartbeat_at:string|null;last_error:string|null;enabled_environments:string[]}>
        Insert: R<{name:string}>
        Update: R<{last_error?:string|null}>
        Relationships: []
      }
      strategy_inbox: {
        Row: R<{ id: string; user_id: string; payload: Record<string, unknown>; paper: boolean; status: string; attempts: number; result: Record<string, unknown> | null; received_at: string }>
        Insert: R<{ user_id: string; payload: Record<string, unknown>; payload_hash: string; paper: boolean }>
        Update: R<{ status?: string; result?: Record<string, unknown> }>
        Relationships: []
      }

      users: {
        Row: R<User>
        Insert: R<Omit<User, 'created_at' | 'updated_at'>>
        Update: R<Partial<Omit<User, 'id'>>>
        Relationships: []
      }
      settings: {
        Row: R<Settings>
        Insert: R<Omit<Settings, 'id' | 'updated_at'>>
        Update: R<Partial<Omit<Settings, 'id'>>>
        Relationships: []
      }
      broker_accounts: {
        Row: R<BrokerAccount>
        Insert: R<Omit<BrokerAccount, 'id' | 'created_at'>>
        Update: R<Partial<Omit<BrokerAccount, 'id'>>>
        Relationships: []
      }
      signals: {
        Row: R<Signal>
        Insert: R<{
          // Required
          user_id: string
          symbol: string
          direction: TradeDirection | 'WAIT'
          state: SignalState
          entry_price: number
          stop_loss: number
          take_profit: number
          confluence_score: number
          // Optional — nullable or have DB defaults
          rr_ratio?: number | null
          quantity?: number | null
          timeframe?: string | null
          payload_hash?: string | null
          is_executed?: boolean
          raw_payload?: Record<string, unknown> | null
        }>
        Update: R<Partial<Omit<Signal, 'id'>>>
        Relationships: []
      }
      trades: {
        Row: R<Trade>
        Insert: R<{
          // Required
          user_id: string
          symbol: string
          direction: TradeDirection
          entry_price: number
          stop_loss: number
          take_profit: number
          quantity: number
          // Optional — nullable or have DB defaults
          signal_id?: string | null
          broker_account_id?: string | null
          broker_order_id?: string | null
          sl_order_id?: string | null
          tp_order_id?: string | null
          status?: TradeStatus
          close_price?: number | null
          pnl?: number
          close_reason?: CloseReason | null
          confluence_score?: number | null
          notes?: string | null
          screenshot_url?: string | null
          closed_at?: string | null
        }>
        Update: R<Partial<Omit<Trade, 'id'>>>
        Relationships: []
      }
      positions: {
        Row: R<Position>
        Insert: R<{
          // Required
          user_id: string
          trade_id: string
          symbol: string
          direction: TradeDirection
          quantity: number
          entry_price: number
          // Optional — nullable or have DB defaults
          broker_account_id?: string | null
          current_price?: number | null
          unrealized_pnl?: number
          stop_loss?: number | null
          take_profit?: number | null
          broker_position_id?: string | null
          is_open?: boolean
        }>
        Update: R<Partial<Omit<Position, 'id'>>>
        Relationships: []
      }
      webhook_logs: {
        Row: R<WebhookLog>
        Insert: R<Omit<WebhookLog, 'id' | 'received_at'>>
        Update: R<Partial<Omit<WebhookLog, 'id'>>>
        Relationships: []
      }
      alerts: {
        Row: R<Alert>
        Insert: R<{
          // Required
          user_id: string
          type: AlertType
          title: string
          message: string
          // Optional — nullable or have DB defaults
          trade_id?: string | null
          is_read?: boolean
          delivered_email?: boolean
        }>
        Update: R<Partial<Omit<Alert, 'id'>>>
        Relationships: []
      }
      performance_summary: {
        Row: R<PerformanceSummary>
        Insert: R<Omit<PerformanceSummary, 'id' | 'calculated_at'>>
        Update: R<Partial<Omit<PerformanceSummary, 'id'>>>
        Relationships: []
      }
      automation_runs: {
        Row: R<{name: string; last_started_at: string | null; last_finished_at: string | null; result: Record<string, unknown> | null; lease_id: string | null; lease_until: string | null}>
        Insert: R<{name: string}>
        Update: R<{last_finished_at?: string; result?: Record<string, unknown>; lease_until?: string | null}>
        Relationships: []
      }
      paper_trades: {
        Row: R<PaperTrade>
        Insert: R<{
          user_id: string
          symbol: string
          direction: TradeDirection
          entry_price: number
          stop_loss: number
          take_profit: number
          quantity: number
          initial_capital?: number
          risk_percent?: number
          rr_ratio?: number | null
          confluence_score?: number | null
          signal_id?: string | null
          notes?: string | null
          status?: PaperTradeStatus
        }>
        Update: R<Partial<Omit<PaperTrade, 'id'>>>
        Relationships: []
      }
    }
    Views: Record<string, {
      Row: Record<string, unknown>
      Relationships: never[]
    }>
    Functions: Record<string, {
      Args: Record<string, unknown>
      Returns: unknown
    }>
    Enums: Record<string, string>
    CompositeTypes: Record<string, Record<string, unknown>>
  }
}
