-- ============================================================
-- EVO-IILF Algo Automation Platform
-- Migration 002: Row Level Security Policies
-- GrindX Technologies PVT LTD
-- ============================================================

-- ─── USERS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "service_role_users" ON public.users
  TO service_role USING (true) WITH CHECK (true);

-- ─── SETTINGS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_select_own" ON public.settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "settings_insert_own" ON public.settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings_update_own" ON public.settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "service_role_settings" ON public.settings
  TO service_role USING (true) WITH CHECK (true);

-- ─── BROKER ACCOUNTS ──────────────────────────────────────────────────────────
ALTER TABLE public.broker_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "broker_accounts_select_own" ON public.broker_accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "broker_accounts_insert_own" ON public.broker_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "broker_accounts_update_own" ON public.broker_accounts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "broker_accounts_delete_own" ON public.broker_accounts
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "service_role_broker_accounts" ON public.broker_accounts
  TO service_role USING (true) WITH CHECK (true);

-- ─── SIGNALS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signals_select_own" ON public.signals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "signals_insert_own" ON public.signals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service_role_signals" ON public.signals
  TO service_role USING (true) WITH CHECK (true);

-- ─── TRADES ───────────────────────────────────────────────────────────────────
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trades_select_own" ON public.trades
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "trades_insert_own" ON public.trades
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "trades_update_own" ON public.trades
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "service_role_trades" ON public.trades
  TO service_role USING (true) WITH CHECK (true);

-- ─── POSITIONS ────────────────────────────────────────────────────────────────
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "positions_select_own" ON public.positions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "positions_insert_own" ON public.positions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "positions_update_own" ON public.positions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "service_role_positions" ON public.positions
  TO service_role USING (true) WITH CHECK (true);

-- ─── WEBHOOK LOGS ─────────────────────────────────────────────────────────────
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_logs_select_own" ON public.webhook_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_webhook_logs" ON public.webhook_logs
  TO service_role USING (true) WITH CHECK (true);

-- ─── ALERTS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alerts_select_own" ON public.alerts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "alerts_update_own" ON public.alerts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "service_role_alerts" ON public.alerts
  TO service_role USING (true) WITH CHECK (true);

-- ─── PERFORMANCE SUMMARY ──────────────────────────────────────────────────────
ALTER TABLE public.performance_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "performance_select_own" ON public.performance_summary
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_performance" ON public.performance_summary
  TO service_role USING (true) WITH CHECK (true);
