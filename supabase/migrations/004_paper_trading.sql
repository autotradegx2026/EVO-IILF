-- Migration 004: Paper Trading / Backtesting table
-- Paper trades are simulated — no real broker orders placed.
-- Used as a safety gate before going live with a funded account.

CREATE TABLE IF NOT EXISTS paper_trades (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_id        UUID REFERENCES signals(id),
  symbol           VARCHAR(50) NOT NULL,
  direction        VARCHAR(10) NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  entry_price      DECIMAL(18,6) NOT NULL,
  stop_loss        DECIMAL(18,6) NOT NULL,
  take_profit      DECIMAL(18,6) NOT NULL,
  quantity         DECIMAL(18,4) NOT NULL,
  initial_capital  DECIMAL(18,2) NOT NULL DEFAULT 100000,
  risk_percent     DECIMAL(5,2)  NOT NULL DEFAULT 1.0,
  rr_ratio         DECIMAL(4,2),
  confluence_score SMALLINT,
  status           VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  close_price      DECIMAL(18,6),
  pnl              DECIMAL(18,2) DEFAULT 0,
  pnl_percent      DECIMAL(8,4)  DEFAULT 0,
  close_reason     VARCHAR(20) CHECK (close_reason IN ('SL_HIT', 'TP_HIT', 'MANUAL')),
  notes            TEXT,
  opened_at        TIMESTAMPTZ DEFAULT NOW(),
  closed_at        TIMESTAMPTZ
);

-- RLS
ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_trades_own" ON paper_trades
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "paper_trades_service_role" ON paper_trades
  FOR ALL TO service_role USING (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_paper_trades_user_opened ON paper_trades(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades(user_id, status);

-- Comments
COMMENT ON TABLE paper_trades IS 'Simulated paper trades for strategy validation before live trading.';
