-- ============================================================
-- EVO-IILF Algo Automation Platform
-- Migration 001: Initial Schema
-- GrindX Technologies PVT LTD
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── USERS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'trader' CHECK (role IN ('trader', 'admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SETTINGS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Trend
  trend_ema_length SMALLINT DEFAULT 50,
  fast_ema_length SMALLINT DEFAULT 20,
  htf_ema_length SMALLINT DEFAULT 200,
  htf_timeframe VARCHAR(10) DEFAULT '4H',
  -- Filters
  adx_threshold SMALLINT DEFAULT 25,
  volume_multiplier DECIMAL(4,2) DEFAULT 1.5,
  atr_multiplier DECIMAL(4,2) DEFAULT 1.5,
  min_confluence_score SMALLINT DEFAULT 5,
  -- Risk
  risk_percent DECIMAL(5,2) DEFAULT 1.0,
  rr_ratio DECIMAL(4,2) DEFAULT 2.0,
  cooldown_bars SMALLINT DEFAULT 5,
  max_trades_per_day SMALLINT DEFAULT 3,
  max_daily_loss_pct DECIMAL(5,2) DEFAULT 3.0,
  -- Toggles
  vwap_enabled BOOLEAN DEFAULT true,
  delta_enabled BOOLEAN DEFAULT true,
  fvg_enabled BOOLEAN DEFAULT true,
  ob_enabled BOOLEAN DEFAULT true,
  -- Session
  session_start TIME DEFAULT '09:15:00',
  session_end TIME DEFAULT '15:30:00',
  -- Webhook
  webhook_secret VARCHAR(255),
  -- Kill switch
  kill_switch_active BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ─── BROKER ACCOUNTS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  broker_name VARCHAR(50) NOT NULL CHECK (broker_name IN ('angelone', 'zerodha', 'upstox', 'binance', 'bybit', 'ibkr')),
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  access_token_encrypted TEXT,
  client_id VARCHAR(100),
  account_balance DECIMAL(18,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT false,
  is_connected BOOLEAN DEFAULT false,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SIGNALS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('LONG', 'SHORT', 'WAIT')),
  state VARCHAR(20) NOT NULL CHECK (state IN ('LONG_READY', 'SHORT_READY', 'WAIT', 'COOLDOWN', 'REJECTED')),
  entry_price DECIMAL(18,6) NOT NULL,
  stop_loss DECIMAL(18,6) NOT NULL,
  take_profit DECIMAL(18,6) NOT NULL,
  confluence_score SMALLINT NOT NULL CHECK (confluence_score >= 0 AND confluence_score <= 10),
  rr_ratio DECIMAL(5,2),
  quantity DECIMAL(18,4),
  timeframe VARCHAR(10),
  payload_hash VARCHAR(64) UNIQUE,
  is_executed BOOLEAN DEFAULT false,
  raw_payload JSONB,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TRADES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  signal_id UUID REFERENCES public.signals(id),
  broker_account_id UUID REFERENCES public.broker_accounts(id),
  broker_order_id VARCHAR(100),
  sl_order_id VARCHAR(100),
  tp_order_id VARCHAR(100),
  symbol VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  entry_price DECIMAL(18,6) NOT NULL,
  stop_loss DECIMAL(18,6) NOT NULL,
  take_profit DECIMAL(18,6) NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'PARTIAL', 'REJECTED', 'PENDING')),
  close_price DECIMAL(18,6),
  pnl DECIMAL(18,2) DEFAULT 0,
  close_reason VARCHAR(20) CHECK (close_reason IN ('SL_HIT', 'TP_HIT', 'MANUAL', 'SESSION_END', 'SIGNAL', 'FORCE')),
  confluence_score SMALLINT,
  notes TEXT,
  screenshot_url TEXT,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

-- ─── POSITIONS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  broker_account_id UUID REFERENCES public.broker_accounts(id),
  symbol VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  quantity DECIMAL(18,4) NOT NULL,
  entry_price DECIMAL(18,6) NOT NULL,
  current_price DECIMAL(18,6),
  unrealized_pnl DECIMAL(18,2) DEFAULT 0,
  stop_loss DECIMAL(18,6),
  take_profit DECIMAL(18,6),
  broker_position_id VARCHAR(100),
  is_open BOOLEAN DEFAULT true,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ─── WEBHOOK LOGS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id),
  raw_payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('RECEIVED', 'VALIDATED', 'REJECTED', 'DUPLICATE', 'PROCESSED')),
  rejection_reason TEXT,
  signal_id UUID REFERENCES public.signals(id),
  ip_address VARCHAR(45),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ─── ALERTS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'LONG_ENTRY', 'SHORT_ENTRY', 'SL_HIT', 'TP_HIT',
    'EXECUTION_SUCCESS', 'ORDER_REJECTED', 'DAILY_LOSS_LOCK',
    'SESSION_END', 'COOLDOWN_START', 'SYSTEM'
  )),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  trade_id UUID REFERENCES public.trades(id),
  is_read BOOLEAN DEFAULT false,
  delivered_email BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PERFORMANCE SUMMARY ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.performance_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period VARCHAR(10) NOT NULL CHECK (period IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  period_start DATE NOT NULL,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,
  gross_profit DECIMAL(18,2) DEFAULT 0,
  gross_loss DECIMAL(18,2) DEFAULT 0,
  net_pnl DECIMAL(18,2) DEFAULT 0,
  profit_factor DECIMAL(8,4) DEFAULT 0,
  avg_rr_achieved DECIMAL(6,3) DEFAULT 0,
  max_drawdown DECIMAL(5,2) DEFAULT 0,
  avg_confluence_score DECIMAL(4,2) DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, period, period_start)
);

-- ─── AUTO-UPDATE TRIGGER ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_users_updated_at ON public.users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS set_settings_updated_at ON public.settings;
CREATE TRIGGER set_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── NEW USER TRIGGER ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  INSERT INTO public.settings (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
