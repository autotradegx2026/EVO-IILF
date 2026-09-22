> Current scope: user authorized automatic execution and selected Binance Spot testnet first alongside Angel One. See BROKER_AUTOMATION.md for the durable engine, dashboard credentials, migration 011 and remaining host/acceptance requirements. This supersedes the older manual-confirmation-only scope below.

# EVO-IILF Algo Automation Platform

> Update 6 September 2026: read STRATEGY.md for the latest user-supplied client strategy and broker scope. Its parameters supersede the older defaults below. The target now includes user-configured automation with Angel One (India) and MT5 (forex); current live execution remains gated pending the unfinished broker reconciliation work. Pine, native TradingView intake and automatic paper exits are implemented. Supabase migrations 005–010 are applied. See PAPER_AUTOMATION.md for current deployment acceptance.
## Claude Code Master Context File
### GrindX Technologies PVT LTD

---

## 🏢 Company & Project Identity

- **Company:** GrindX Technologies PVT LTD, Sector V, West Bengal, India
- **Product Name:** EVO-IILF Algo Automation Platform
- **Product Type:** Web-Based Institutional Trading Automation Platform
- **Version:** 1.0 (Phase 1)
- **Owner:** Sagnik (Founder, GrindX Technologies)
- **Contact:** support@grindx.io | www.grindx.io

---

## 🎯 What This Product Is

A **semi-automated institutional trading platform** that:
1. Receives trade signals from TradingView Pine Script via webhook
2. Validates signals through a multi-stage decision engine
3. Displays qualified signals to the user on a real-time dashboard
4. Lets the user click **EXECUTE TRADE** to confirm
5. Automatically places entry + stop loss + take profit orders via broker API
6. Monitors positions, logs trades, tracks performance

**This is NOT a blind trading bot.** Every trade requires explicit user confirmation.

---

## 🛠️ Tech Stack — STRICT, DO NOT DEVIATE

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 14 (App Router) | TypeScript, use app/ directory |
| Hosting | Vercel | Deploy from main branch |
| Database | Supabase PostgreSQL | Use Supabase JS client v2 |
| ORM | Supabase client (no Prisma, no Drizzle) | Raw SQL via supabase-js |
| Auth | Supabase Auth | JWT, middleware protection |
| Storage | Supabase Storage | Screenshots bucket |
| Email | Resend | Transactional alerts |
| Styling | Tailwind CSS + Shadcn/ui | Dark theme preferred |
| State | Zustand (client) + React Query (server) | |
| Charts | Recharts | Analytics module |
| Validation | Zod | All API inputs and webhook payloads |
| Broker (Phase 1) | Angel One SmartAPI | Free API, easy onboarding |

### ❌ NEVER USE:
- PostgreSQL / Prisma / Drizzle / Mongoose / MongoDB
- Express.js as standalone server (use Next.js API routes only)
- Redux / MobX
- Material UI / Chakra UI / Ant Design
- Any paid services not listed above

---

## 📁 Project Structure

```
evo-iilf/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx               # Dashboard shell with sidebar
│   │   ├── page.tsx                 # Module 1: Live Strategy Dashboard
│   │   ├── settings/page.tsx        # Module 2: Strategy Settings
│   │   ├── journal/page.tsx         # Module 3: Trade Journal
│   │   ├── analytics/page.tsx       # Module 4: Performance Analytics
│   │   ├── alerts/page.tsx          # Module 5: Alerts & Notifications
│   │   └── risk/page.tsx            # Module 6: Risk & Controls
│   └── api/
│       ├── webhook/route.ts         # POST — TradingView webhook receiver
│       ├── trades/
│       │   ├── route.ts             # GET list, POST execute
│       │   └── [id]/
│       │       ├── route.ts         # GET single trade
│       │       └── close/route.ts   # POST force close
│       ├── signals/
│       │   ├── route.ts             # GET signals list
│       │   └── current/route.ts     # GET latest active signal
│       ├── settings/route.ts        # GET/PUT user settings
│       ├── broker/
│       │   ├── connect/route.ts     # POST connect broker
│       │   ├── accounts/route.ts    # GET broker accounts
│       │   └── [id]/
│       │       ├── route.ts         # DELETE broker
│       │       └── balance/route.ts # GET live balance
│       ├── performance/
│       │   ├── route.ts             # GET overall metrics
│       │   └── monthly/route.ts     # GET monthly breakdown
│       └── alerts/route.ts          # GET alert history
├── components/
│   ├── dashboard/                   # Dashboard-specific components
│   ├── ui/                          # Shadcn components (auto-generated)
│   └── shared/                      # Shared components
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser Supabase client
│   │   ├── server.ts                # Server Supabase client (cookies)
│   │   └── middleware.ts            # Auth middleware helper
│   ├── brokers/
│   │   ├── index.ts                 # Broker factory / unified interface
│   │   ├── angelone.ts              # Angel One SmartAPI adapter
│   │   ├── zerodha.ts               # Zerodha Kite Connect adapter
│   │   └── upstox.ts                # Upstox API adapter
│   ├── webhook/
│   │   ├── validate.ts              # HMAC-SHA256 signature validation
│   │   ├── parser.ts                # Payload parser and normalizer
│   │   └── processor.ts             # Signal processing pipeline
│   ├── trading/
│   │   ├── position-size.ts         # Position sizing calculator
│   │   ├── risk-manager.ts          # Daily loss / trade limits
│   │   └── execution.ts             # Order execution orchestrator
│   ├── notifications/
│   │   └── email.ts                 # Resend email templates
│   └── utils.ts                     # General utilities
├── types/
│   ├── database.ts                  # Supabase generated types
│   ├── broker.ts                    # Broker interface types
│   ├── trading.ts                   # Signal, Trade, Position types
│   └── webhook.ts                   # Webhook payload types
├── hooks/
│   ├── use-signal.ts                # Real-time signal subscription
│   ├── use-positions.ts             # Live position data
│   └── use-performance.ts           # Performance metrics
├── middleware.ts                    # Route protection middleware
├── .env.local                       # (never commit) env vars
├── .env.example                     # Commit this with placeholders
├── CLAUDE.md                        # This file
├── PRD.md                           # Full product requirements
└── supabase/
    └── migrations/                  # SQL migration files
        ├── 001_initial_schema.sql
        ├── 002_rls_policies.sql
        └── 003_indexes.sql
```

---

## 🗄️ Database Schema — Complete

### Table: users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'trader' CHECK (role IN ('trader', 'admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: settings
```sql
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trend_ema_length SMALLINT DEFAULT 50,
  fast_ema_length SMALLINT DEFAULT 20,
  htf_ema_length SMALLINT DEFAULT 200,
  htf_timeframe VARCHAR(10) DEFAULT '4H',
  adx_threshold SMALLINT DEFAULT 25,
  volume_multiplier DECIMAL(4,2) DEFAULT 1.5,
  atr_multiplier DECIMAL(4,2) DEFAULT 1.5,
  min_confluence_score SMALLINT DEFAULT 5,
  risk_percent DECIMAL(5,2) DEFAULT 1.0,
  rr_ratio DECIMAL(4,2) DEFAULT 2.0,
  cooldown_bars SMALLINT DEFAULT 5,
  vwap_enabled BOOLEAN DEFAULT true,
  delta_enabled BOOLEAN DEFAULT true,
  fvg_enabled BOOLEAN DEFAULT true,
  ob_enabled BOOLEAN DEFAULT true,
  session_start TIME DEFAULT '09:15:00',
  session_end TIME DEFAULT '15:30:00',
  max_trades_per_day SMALLINT DEFAULT 3,
  max_daily_loss_pct DECIMAL(5,2) DEFAULT 3.0,
  webhook_secret VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

### Table: broker_accounts
```sql
CREATE TABLE broker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
```

### Table: signals
```sql
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  symbol VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  state VARCHAR(20) NOT NULL CHECK (state IN ('LONG_READY', 'SHORT_READY', 'WAIT', 'COOLDOWN', 'REJECTED')),
  entry_price DECIMAL(18,6) NOT NULL,
  stop_loss DECIMAL(18,6) NOT NULL,
  take_profit DECIMAL(18,6) NOT NULL,
  confluence_score SMALLINT NOT NULL,
  rr_ratio DECIMAL(5,2) NOT NULL,
  quantity DECIMAL(18,4),
  timeframe VARCHAR(10),
  payload_hash VARCHAR(64) UNIQUE,
  is_executed BOOLEAN DEFAULT false,
  raw_payload JSONB,
  received_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: trades
```sql
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  signal_id UUID REFERENCES signals(id),
  broker_account_id UUID REFERENCES broker_accounts(id),
  broker_order_id VARCHAR(100),
  sl_order_id VARCHAR(100),
  tp_order_id VARCHAR(100),
  symbol VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL,
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
```

### Table: positions
```sql
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  trade_id UUID NOT NULL REFERENCES trades(id),
  broker_account_id UUID REFERENCES broker_accounts(id),
  symbol VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL,
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
```

### Table: webhook_logs
```sql
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  raw_payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('RECEIVED', 'VALIDATED', 'REJECTED', 'DUPLICATE', 'PROCESSED')),
  rejection_reason TEXT,
  signal_id UUID REFERENCES signals(id),
  ip_address VARCHAR(45),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
```

### Table: alerts
```sql
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(30) NOT NULL CHECK (type IN ('LONG_ENTRY', 'SHORT_ENTRY', 'SL_HIT', 'TP_HIT', 'EXECUTION_SUCCESS', 'ORDER_REJECTED', 'DAILY_LOSS_LOCK', 'SESSION_END')),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  trade_id UUID REFERENCES trades(id),
  is_read BOOLEAN DEFAULT false,
  delivered_email BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: performance_summary
```sql
CREATE TABLE performance_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
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
```

---

## 🔌 Webhook Specification

### Endpoint
```
POST /api/webhook
Header: X-Webhook-Signature: sha256=<hmac_hex>
Header: Content-Type: application/json
```

### Payload Schema (from TradingView)
```json
{
  "symbol": "NIFTY",
  "action": "LONG",
  "price": 22250.25,
  "sl": 22110.00,
  "tp": 22410.50,
  "rr": 1.8,
  "confluence": 6,
  "tf": "15m",
  "timestamp": "2025-01-15T09:35:00Z"
}
```

### Validation Pipeline (in order)
1. HMAC-SHA256 signature verification
2. Zod schema validation
3. Duplicate check (SHA-256 hash of symbol+action+price+timestamp)
4. Session time check (within configured session_start/session_end)
5. Cooldown check (last trade within cooldown_bars)
6. Max daily trades check
7. Max daily loss check
8. Open positions check

### Response
```json
// Success
{ "status": "QUALIFIED", "signal_id": "uuid", "state": "LONG_READY" }

// Rejected
{ "status": "REJECTED", "reason": "DUPLICATE_SIGNAL" | "SESSION_CLOSED" | "COOLDOWN_ACTIVE" | "MAX_TRADES_REACHED" | "DAILY_LOSS_LOCKED" }
```

---

## 📊 Dashboard Modules — Build Specs

### Module 1: Live Strategy Dashboard (/)
**Real-time signal display. This is the main page.**

Components needed:
- `SignalHero` — large status card: LONG READY / SHORT READY / WAIT / COOLDOWN
- `ConfluenceGrid` — 7 factor indicator grid with colored badges
- `TradeDetails` — entry, SL, TP, RR, quantity cards
- `ActivePositions` — open trades with live P&L (poll every 5s or Supabase realtime)
- `RecentSignals` — last 10 signals table

Color system:
- LONG READY → green (#22c55e)
- SHORT READY → red (#ef4444)
- WAIT → yellow (#eab308)
- COOLDOWN → gray (#6b7280)

### Module 2: Strategy Settings (/settings)
Form with all strategy parameters. Auto-save or save button. Zod validation client-side.

### Module 3: Trade Journal (/journal)
Table with filtering (date range, symbol, direction, result). Expandable row for notes + screenshot. Export to CSV.

### Module 4: Performance Analytics (/analytics)
- Stats cards: Win Rate, Profit Factor, Max Drawdown, Avg RR
- PnL curve chart (Recharts LineChart)
- Monthly bar chart (Recharts BarChart)
- Win/Loss donut chart (Recharts PieChart)

### Module 5: Alerts (/alerts)
Alert feed with type badges. Mark as read. Filter by type.

### Module 6: Risk & Controls (/risk)
- Daily loss meter (progress bar)
- Trades today counter
- Kill switch (disable execution toggle)
- Cooldown status
- Position limits display

---

## 🏦 Broker Integration — Phase 1: Angel One SmartAPI

### Angel One Credentials Needed (from user)
- `api_key`
- `client_code`
- `password`
- `totp_secret` (for TOTP generation)

### Angel One SDK
```bash
npm install smartapi-javascript
```

### Adapter Interface (ALL brokers must implement this)
```typescript
interface BrokerAdapter {
  connect(): Promise<boolean>
  getBalance(): Promise<number>
  placeOrder(order: OrderRequest): Promise<OrderResponse>
  cancelOrder(orderId: string): Promise<boolean>
  getOrderStatus(orderId: string): Promise<OrderStatus>
  getPositions(): Promise<Position[]>
  closePosition(positionId: string): Promise<boolean>
}
```

### Order Request Type
```typescript
interface OrderRequest {
  symbol: string
  exchange: 'NSE' | 'BSE' | 'NFO' | 'MCX'
  transactionType: 'BUY' | 'SELL'
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M'
  productType: 'INTRADAY' | 'DELIVERY' | 'CARRYFORWARD'
  quantity: number
  price?: number
  triggerPrice?: number
}
```

---

## 🔐 Security Rules — ALWAYS FOLLOW

1. **Never store broker API keys in plaintext** — encrypt with AES-256 before writing to DB
2. **All API routes must verify Supabase JWT** — use `createServerClient` and check session
3. **Webhook endpoint uses HMAC-SHA256** — verify `X-Webhook-Signature` header always
4. **RLS must be enabled on all tables** — users can only SELECT/INSERT/UPDATE their own rows
5. **Never expose encryption keys** — use `ENCRYPTION_KEY` env var only server-side
6. **Rate limit webhook endpoint** — max 60 requests/minute per IP
7. **Validate ALL inputs with Zod** — no raw request body usage

---

## 🌐 Environment Variables

### Required in .env.local
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Encryption (generate 32-byte random hex)
ENCRYPTION_KEY=

# Resend
RESEND_API_KEY=

# Webhook security
WEBHOOK_SECRET=

# Angel One (Phase 1 broker)
ANGEL_ONE_API_KEY=
ANGEL_ONE_CLIENT_CODE=
ANGEL_ONE_PASSWORD=
ANGEL_ONE_TOTP_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## ⚡ Execution Flow — Code Logic

```typescript
// When user clicks EXECUTE TRADE:

async function executeTrade(signalId: string, brokerAccountId: string) {
  // 1. Final pre-execution validation
  const checks = await runPreExecutionChecks(userId)
  if (!checks.passed) throw new Error(checks.reason)

  // 2. Get signal details
  const signal = await getSignal(signalId)

  // 3. Calculate position size
  const balance = await broker.getBalance()
  const qty = calculatePositionSize(balance, settings.risk_percent, signal.entry_price, signal.stop_loss)

  // 4. Place entry order
  const entryOrder = await broker.placeOrder({ type: 'MARKET', ...signal, qty })

  // 5. Place SL order immediately after fill
  const slOrder = await broker.placeOrder({ type: 'SL-M', triggerPrice: signal.stop_loss, qty })

  // 6. Place TP order
  const tpOrder = await broker.placeOrder({ type: 'LIMIT', price: signal.take_profit, qty })

  // 7. Log to database
  await createTrade({ ...signal, entryOrder, slOrder, tpOrder, qty })

  // 8. Send notification
  await sendAlert('EXECUTION_SUCCESS', trade)
}
```

---

## 📏 Coding Standards

- **TypeScript strict mode** — no `any` types
- **Every API route** must have try/catch with proper error responses
- **All DB queries** use Supabase client, never raw fetch to PostgREST
- **Components** — functional only, no class components
- **File naming** — kebab-case for files, PascalCase for components
- **No console.log in production** — use a proper logger utility
- **Error responses** always return `{ error: string, code: string }`
- **Success responses** always return `{ data: T, message?: string }`

---

## 🚀 Phase 1 Build Order

Build in this exact sequence:

1. **Database** — Run migrations, set up RLS, generate types
2. **Auth** — Login/register pages, middleware, session handling
3. **Webhook** — `/api/webhook` endpoint with full validation pipeline
4. **Signal Display** — Module 1 dashboard showing incoming signals
5. **Settings** — Module 2 settings panel (needed for validation logic)
6. **Broker Connection** — Angel One adapter + connect UI
7. **Trade Execution** — Execute button → order placement → DB log
8. **Position Monitoring** — Live P&L polling / realtime
9. **Trade Journal** — Module 3
10. **Performance Analytics** — Module 4
11. **Alerts** — Module 5
12. **Risk Controls** — Module 6

---

## 🧪 Testing Approach

- Test webhook with Postman before connecting TradingView
- Use Angel One paper trading / sandbox where available
- Always test with minimum quantity (1 unit) before live trading
- Verify SL and TP orders appear in broker dashboard after execution

---

## ⚠️ Critical Rules for Claude Code

1. Always read this CLAUDE.md before starting any task
2. Check PRD.md for detailed requirements on any feature
3. Never deviate from the tech stack above
4. Ask before adding any new npm package
5. Always write TypeScript — no plain JS files
6. Keep broker credentials encrypted at all times
7. Run `npx tsc --noEmit` before declaring any task complete
8. Check agents/ folder — delegate to specialist agents when appropriate
