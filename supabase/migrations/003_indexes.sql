-- ============================================================
-- EVO-IILF Algo Automation Platform
-- Migration 003: Performance Indexes
-- ============================================================

-- signals
CREATE INDEX idx_signals_user_received   ON public.signals(user_id, received_at DESC);
CREATE INDEX idx_signals_hash            ON public.signals(payload_hash);
CREATE INDEX idx_signals_state           ON public.signals(state);
CREATE INDEX idx_signals_executed        ON public.signals(user_id, is_executed);

-- trades
CREATE INDEX idx_trades_user_opened      ON public.trades(user_id, opened_at DESC);
CREATE INDEX idx_trades_status           ON public.trades(user_id, status);
CREATE INDEX idx_trades_symbol           ON public.trades(symbol);
CREATE INDEX idx_trades_closed           ON public.trades(user_id, closed_at DESC) WHERE closed_at IS NOT NULL;

-- positions
CREATE INDEX idx_positions_user_open     ON public.positions(user_id, is_open);
CREATE INDEX idx_positions_trade         ON public.positions(trade_id);

-- webhook_logs
CREATE INDEX idx_webhook_logs_user       ON public.webhook_logs(user_id, received_at DESC);
CREATE INDEX idx_webhook_logs_status     ON public.webhook_logs(status);

-- alerts
CREATE INDEX idx_alerts_user_unread      ON public.alerts(user_id, is_read, created_at DESC);
CREATE INDEX idx_alerts_type             ON public.alerts(user_id, type);

-- performance_summary
CREATE INDEX idx_perf_user_period        ON public.performance_summary(user_id, period, period_start DESC);

-- broker_accounts
CREATE INDEX idx_broker_user_active      ON public.broker_accounts(user_id, is_active);
