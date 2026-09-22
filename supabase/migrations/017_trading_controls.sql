BEGIN;
-- Dedicated paper control does not change broker mode, broker watchlist or kill switch.
ALTER TABLE public.settings
 ADD COLUMN paper_trading_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN paper_started_at timestamptz,
 ADD COLUMN paper_stopped_at timestamptz,
 ADD COLUMN paper_symbols text[] NOT NULL DEFAULT '{}',
 ADD COLUMN paper_timeframe text NOT NULL DEFAULT '15m' CHECK (paper_timeframe IN ('1m','5m','15m','1h'));
UPDATE public.settings SET paper_trading_enabled=(signal_delivery_mode='paper'),
 paper_symbols=ARRAY(SELECT x FROM unnest(screener_symbols) x WHERE x ~ '^BINANCE:[A-Z0-9]+USDT$'),
 paper_timeframe=screener_timeframe;

CREATE FUNCTION public.configure_paper_automation(p_user uuid,p_enabled boolean,p_native boolean DEFAULT true,p_symbols text[] DEFAULT '{}',p_timeframe text DEFAULT '15m')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.settings;
BEGIN
 SELECT * INTO s FROM settings WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPER_SETTINGS_UNAVAILABLE'; END IF;
 IF p_enabled THEN
  IF s.kill_switch_active THEN RAISE EXCEPTION 'Release the global entry pause in Risk before starting paper trading.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user AND is_active) THEN RAISE EXCEPTION 'ACCOUNT_DISABLED'; END IF;
  IF p_native THEN
   IF coalesce(cardinality(p_symbols),0) NOT BETWEEN 1 AND 5 OR EXISTS(SELECT 1 FROM unnest(p_symbols) x WHERE x IS NULL OR x !~ '^BINANCE:[A-Z0-9]+USDT$') OR p_timeframe NOT IN ('1m','5m','15m','1h') THEN RAISE EXCEPTION 'Choose one to five Binance USDT symbols and a supported timeframe.'; END IF;
  ELSIF s.signal_delivery_mode<>'paper' OR coalesce(cardinality(s.screener_symbols),0)=0 OR s.delivery_token_hash IS NULL THEN
   RAISE EXCEPTION 'Configure TradingView paper delivery, its watchlist and token in Strategy & Screener first.';
  END IF;
 END IF;
 UPDATE settings SET paper_trading_enabled=p_enabled,
  paper_started_at=CASE WHEN p_enabled AND NOT s.paper_trading_enabled THEN now() ELSE paper_started_at END,
  paper_stopped_at=CASE WHEN NOT p_enabled AND s.paper_trading_enabled THEN now() ELSE paper_stopped_at END,
  paper_auto_scan=CASE WHEN p_enabled THEN p_native ELSE paper_auto_scan END,
  paper_symbols=CASE WHEN p_enabled AND p_native THEN p_symbols ELSE paper_symbols END,
  paper_timeframe=CASE WHEN p_enabled AND p_native THEN p_timeframe ELSE paper_timeframe END,
  paper_last_scan_at=CASE WHEN p_enabled AND NOT s.paper_trading_enabled THEN NULL ELSE paper_last_scan_at END,
  paper_scan_error=CASE WHEN p_enabled THEN NULL ELSE paper_scan_error END,
  updated_at=now() WHERE user_id=p_user;
END $$;
REVOKE ALL ON FUNCTION public.configure_paper_automation(uuid,boolean,boolean,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_paper_automation(uuid,boolean,boolean,text[],text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_paper_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.settings; equity numeric; risk numeric; loss numeric; day_start timestamptz; clock time; bar_seconds integer; last_open timestamptz;
BEGIN
 SELECT * INTO s FROM public.settings WHERE user_id=NEW.user_id FOR UPDATE;
 IF NOT FOUND OR s.kill_switch_active OR NOT s.paper_trading_enabled OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.user_id AND is_active) THEN RAISE EXCEPTION 'PAPER_EXECUTION_DISABLED'; END IF;
 clock := (now() AT TIME ZONE s.session_timezone)::time;
 IF s.session_start<>s.session_end AND NOT (CASE WHEN s.session_start<s.session_end THEN clock>=s.session_start AND clock<s.session_end ELSE clock>=s.session_start OR clock<s.session_end END) THEN RAISE EXCEPTION 'SESSION_CLOSED'; END IF;
 NEW.currency := CASE WHEN NEW.symbol ~ '^(NSE|BSE):[A-Z0-9&.-]+-EQ$' THEN 'INR' WHEN NEW.symbol ~ '^BINANCE:[A-Z0-9]+USDT$' THEN 'USDT' WHEN NEW.symbol ~ '^OANDA:[A-Z]{6}$' THEN right(NEW.symbol,3) ELSE NULL END;
 IF NEW.currency IS NULL THEN RAISE EXCEPTION 'UNSUPPORTED_PAPER_INSTRUMENT'; END IF;
 NEW.session_start:=s.session_start; NEW.session_end:=s.session_end; NEW.session_timezone:=s.session_timezone;
 IF NEW.payload_hash IS NOT NULL THEN
   IF NEW.source='binance' THEN
     IF NOT s.paper_auto_scan OR NOT (NEW.symbol=ANY(s.paper_symbols)) OR NEW.timeframe<>s.paper_timeframe THEN RAISE EXCEPTION 'PAPER_CONFIGURATION_CHANGED'; END IF;
   ELSE
     IF s.signal_delivery_mode<>'paper' OR NOT (NEW.symbol=ANY(s.screener_symbols)) OR NEW.timeframe<>s.screener_timeframe THEN RAISE EXCEPTION 'PAPER_CONFIGURATION_CHANGED'; END IF;
   END IF;
   NEW.risk_percent:=s.risk_percent;
   NEW.source:=CASE WHEN NEW.symbol LIKE 'BINANCE:%' AND NEW.source='binance' THEN 'binance' ELSE 'tradingview' END;
 END IF;
 bar_seconds:=CASE NEW.timeframe WHEN '1m' THEN 60 WHEN '5m' THEN 300 WHEN '15m' THEN 900 WHEN '1h' THEN 3600 WHEN '60m' THEN 3600 ELSE 0 END;
 IF bar_seconds=0 OR NEW.signal_time<now()-interval '5 minutes' OR NEW.signal_time>now()+interval '1 minute' THEN RAISE EXCEPTION 'STALE_PAPER_SIGNAL'; END IF;
 IF NEW.entry_price<=0 OR NEW.stop_loss<=0 OR NEW.take_profit<=0 OR NOT (CASE WHEN NEW.direction='LONG' THEN NEW.stop_loss<NEW.entry_price AND NEW.entry_price<NEW.take_profit ELSE NEW.take_profit<NEW.entry_price AND NEW.entry_price<NEW.stop_loss END) THEN RAISE EXCEPTION 'INVALID_PRICE_LEVELS'; END IF;
 NEW.rr_ratio:=abs(NEW.take_profit-NEW.entry_price)/abs(NEW.entry_price-NEW.stop_loss);
 IF NEW.payload_hash IS NOT NULL AND (coalesce(NEW.confluence_score,0)<s.min_confluence_score OR NEW.rr_ratio+0.000001<s.rr_ratio) THEN RAISE EXCEPTION 'PAPER_STRATEGY_REJECTED'; END IF;
 day_start:=date_trunc('day',now() AT TIME ZONE s.session_timezone) AT TIME ZONE s.session_timezone;
 IF (SELECT count(*) FROM public.paper_trades WHERE user_id=NEW.user_id AND opened_at>=day_start)>=s.max_trades_per_day THEN RAISE EXCEPTION 'MAX_TRADES_REACHED'; END IF;
 IF EXISTS(SELECT 1 FROM public.paper_trades WHERE user_id=NEW.user_id AND status='OPEN') THEN RAISE EXCEPTION 'OPEN_POSITION_EXISTS'; END IF;
 SELECT max(opened_at) INTO last_open FROM public.paper_trades WHERE user_id=NEW.user_id;
 IF last_open IS NOT NULL AND now()<last_open+make_interval(secs=>s.cooldown_bars*bar_seconds) THEN RAISE EXCEPTION 'COOLDOWN_ACTIVE'; END IF;
 SELECT 100000+coalesce(sum(pnl),0) INTO equity FROM public.paper_trades WHERE user_id=NEW.user_id AND currency=NEW.currency AND status='CLOSED';
 SELECT coalesce(-sum(least(pnl,0)),0) INTO loss FROM public.paper_trades WHERE user_id=NEW.user_id AND currency=NEW.currency AND status='CLOSED' AND closed_at>=day_start;
 IF equity<=0 OR loss>=equity*s.max_daily_loss_pct/100 THEN RAISE EXCEPTION 'DAILY_LOSS_LOCKED'; END IF;
 NEW.initial_capital:=equity; risk:=equity*NEW.risk_percent/100;
 IF NEW.payload_hash IS NOT NULL THEN
   NEW.quantity:=floor(least(risk/abs(NEW.entry_price-NEW.stop_loss),equity/NEW.entry_price)*(CASE WHEN NEW.currency='INR' THEN 1 ELSE 10000 END))/(CASE WHEN NEW.currency='INR' THEN 1 ELSE 10000 END);
 END IF;
 IF NEW.quantity<=0 OR NEW.quantity*abs(NEW.entry_price-NEW.stop_loss)>risk+0.01 OR NEW.quantity*NEW.entry_price>equity+0.01 THEN RAISE EXCEPTION 'INSUFFICIENT_RISK_BUDGET'; END IF;
 NEW.current_price:=NEW.entry_price; NEW.status:='OPEN'; NEW.opened_at:=now(); NEW.pnl:=0; NEW.closed_at:=NULL;
 RETURN NEW;
END $$;

CREATE TABLE public.paper_observations (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 symbol text NOT NULL, timeframe text NOT NULL, checked_at timestamptz NOT NULL,
 bar_close timestamptz, price numeric, score integer, status text NOT NULL, reasons text[] NOT NULL,
 PRIMARY KEY (user_id,symbol,timeframe)
);
ALTER TABLE public.paper_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY paper_observations_read ON public.paper_observations FOR SELECT TO authenticated USING (
 auth.uid()=user_id AND lower((select auth.jwt())->>'email')='autotradegx2026@gmail.com'
);
REVOKE ALL ON public.paper_observations FROM anon,authenticated;
GRANT SELECT ON public.paper_observations TO authenticated;
GRANT ALL ON public.paper_observations TO service_role;
ALTER TABLE public.execution_settings ADD COLUMN started_at timestamptz, ADD COLUMN stopped_at timestamptz;
CREATE FUNCTION public.stamp_execution_switch() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.auto_enabled AND (TG_OP='INSERT' OR NOT OLD.auto_enabled) THEN NEW.started_at:=now(); END IF;
 IF NOT NEW.auto_enabled AND TG_OP='UPDATE' AND OLD.auto_enabled THEN NEW.stopped_at:=now(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stamp_execution_switch BEFORE INSERT OR UPDATE ON public.execution_settings FOR EACH ROW EXECUTE FUNCTION public.stamp_execution_switch();
REVOKE ALL ON FUNCTION public.stamp_execution_switch() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.stop_broker_automation(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- Same lock order as broker queue/configuration; credentials and health are irrelevant to stopping.
 PERFORM 1 FROM settings WHERE user_id=p_user FOR UPDATE;
 UPDATE execution_settings SET auto_enabled=false,updated_at=now() WHERE user_id=p_user;
END $$;
REVOKE ALL ON FUNCTION public.stop_broker_automation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stop_broker_automation(uuid) TO service_role;
COMMIT;
