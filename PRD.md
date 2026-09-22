> Current implementation addendum: see [STRATEGY.md](STRATEGY.md) for the client EVO-IILF PRD supplied on 6 September 2026, corrected strategy defaults, Pine exports, screener/delivery workflow and Angel One + MT5 target. Older conflicting strategy details below are superseded.

# EVO-IILF Algo Automation Platform
## Full Product Requirements Document
### GrindX Technologies PVT LTD | Version 2.0 | Confidential

---

## 1. Executive Summary

The EVO-IILF Algo Automation Platform is a professional, web-based institutional trading automation system. It combines advanced institutional trading logic (SMC, ICT, Order Flow) with a semi-automated execution framework.

**Core principle:** The system surfaces high-probability setups. The user confirms. The system executes with discipline.

### What it is NOT:
- Not a blind trading bot
- Not a TradingView indicator
- Not a signal subscription service

### What it IS:
- A complete institutional execution infrastructure
- A controlled semi-automated trading platform
- A professional trade management and analytics system

---

## 2. System Architecture

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1 — TradingView Pine Script (Strategy Engine)    │
│  • EVO-IILF strategy logic                              │
│  • Confluence scoring (7 factors)                       │
│  • Signal generation + webhook alert                    │
└─────────────────────────────┬───────────────────────────┘
                              │ HTTPS POST (webhook)
┌─────────────────────────────▼───────────────────────────┐
│  LAYER 2 — Next.js Dashboard (Control Center)           │
│  • Webhook receiver + validation pipeline               │
│  • Signal display + user confirmation                   │
│  • Trade journal + analytics + settings                 │
└─────────────────────────────┬───────────────────────────┘
                              │ Broker SDK calls
┌─────────────────────────────▼───────────────────────────┐
│  LAYER 3 — Broker API Engine (Execution Layer)          │
│  • Order placement (entry, SL, TP)                      │
│  • Position monitoring                                   │
│  • Auto-exit management                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. End-to-End Flow (6 Stages from Blueprint)

### Stage 1 — Market & Strategy Engine (TradingView)
Pine Script continuously evaluates:
- Trend Analysis (EMA, HTF EMA)
- VWAP Bias
- Order Flow & Liquidity Sweep
- FVG & Order Blocks
- Volume & Delta Analysis
- ATR & Volatility Filter
- Confluence Scoring Engine

Outputs: Long Signal / Short Signal / Wait

### Stage 2 — Alert & Webhook Trigger (TradingView Alert)
TradingView fires alert with conditions:
- Long Entry Alert
- Short Entry Alert
- Stop Loss Hit
- Take Profit Hit
- Session End Alert
- Cooldown Alert

Webhook JSON payload:
```json
{
  "symbol": "NIFTY",
  "action": "LONG",
  "price": 22250.25,
  "sl": 22110,
  "tp": 22410.50,
  "rr": 1.8,
  "confluence": 6,
  "tf": "15m",
  "timestamp": "2025-01-15T09:35:00Z"
}
```

### Stage 3 — Webhook Receiver (Backend)
Sequential processing pipeline:
1. Payload Validation (HMAC-SHA256)
2. Duplicate Check (hash deduplication)
3. Signal Parser (normalize and type)
4. Confluence Verification (meets minimum threshold?)
5. Risk Validation (session, loss limits, trade limits)
6. Store to Database
7. Trigger Notification

### Stage 4 — Signal Processor & Decision Engine
Validation checks:
- Market Session Check (within configured hours?)
- Cooldown Check (cooldown period expired?)
- Max Daily Loss Check (daily loss limit breached?)
- Max Trades Check (daily trade limit reached?)
- Open Positions Check (concurrent position limit?)

Signal Status outputs:
- ✅ Ready to Execute
- ⚠️ Needs Attention
- ❌ Rejected

### Stage 5 — User Confirmation (Dashboard)
Dashboard displays:
- Signal Details (symbol, direction)
- Entry / SL / TP prices
- Risk Reward Ratio
- Confluence Score (e.g., 6/7)
- Market Conditions summary
- Quantity Suggestion

User actions:
- ✅ EXECUTE TRADE (green button)
- ❌ REJECT TRADE (red button)

### Stage 6 — Broker Execution Engine
After EXECUTE TRADE:
1. Place Entry Order (Market/Limit/Stop)
2. Confirm Order (acknowledgement from broker)
3. Place Stop Loss (SL-M order)
4. Place Take Profit (Limit order)
5. Monitor Position (live tracking)
6. Exit Conditions check (SL hit / TP hit / Opposite signal / Session end)
7. Close Position (market order)
8. Update Database & Journal
9. Send Notifications (Email / App / Dashboard)

---

## 4. Trading Strategy Logic — EVO-IILF

### Confluence Scoring System (7 Factors)

| # | Factor | LONG Condition | SHORT Condition |
|---|--------|---------------|----------------|
| 1 | MTF Trend | HTF EMA + Fast EMA bullish | HTF EMA + Fast EMA bearish |
| 2 | VWAP Bias | Price above VWAP | Price below VWAP |
| 3 | ADX Strength | ADX > threshold (default 25) | ADX > threshold (default 25) |
| 4 | Volume | Volume > avg * multiplier | Volume > avg * multiplier |
| 5 | Delta | Net buying delta | Net selling delta |
| 6 | Liquidity + Structure | Bullish sweep + FVG/OB | Bearish sweep + FVG/OB |
| 7 | ATR Regime | Healthy volatility range | Healthy volatility range |

Score example: 6/7 = LONG READY (if minimum = 5)
Score example: 3/7 = WAIT

### Stop Loss Calculation
- LONG SL = Entry - (ATR × ATR_Multiplier)
- SHORT SL = Entry + (ATR × ATR_Multiplier)
- Anchored to nearest Order Block or Liquidity Zone

### Take Profit Calculation
- LONG TP = Entry + (SL_Distance × RR_Ratio)
- SHORT TP = Entry - (SL_Distance × RR_Ratio)

### Position Sizing
```
Risk_Amount = Account_Balance × (Risk_Percent / 100)
SL_Distance = abs(Entry - SL)
Quantity = Risk_Amount / (SL_Distance × Point_Value)
Quantity = floor(Quantity / Lot_Size) × Lot_Size  // round to lot
```

---

## 5. Dashboard Modules — Detailed Requirements

### Module 1: Live Strategy Dashboard

**Purpose:** Real-time monitoring of strategy state and active signals.

**Components:**
- **Signal Hero Card** — dominant signal state display
  - LONG READY (green)
  - SHORT READY (red)
  - WAIT (yellow)
  - COOLDOWN ACTIVE (gray)
- **Market Indicators Grid** — color-coded status for each factor:
  - Trend Direction
  - VWAP Bias
  - ADX Strength
  - Volume Status
  - Delta Confirmation
  - Liquidity Sweep
  - FVG Status
  - Order Block Status
  - ATR Level
  - Market Bias
- **Confluence Score Display** — visual score (6/7) with progress bar
- **Trade Setup Panel** — entry, SL, TP, RR, suggested quantity
- **Active Position Monitor** — live P&L for open trades
- **Recent Signals Feed** — last 10 signals (time, direction, score, result)

**Real-time updates:** Supabase Realtime subscription on signals table

---

### Module 2: Strategy Settings Panel

**Purpose:** Configure strategy behavior without editing Pine Script.

**Parameter Groups:**

Trend Settings:
- Trend EMA Length (default: 50)
- Fast EMA Length (default: 20)
- HTF EMA Length (default: 200)
- HTF Timeframe (dropdown: 1H, 4H, 1D)

Signal Filters:
- ADX Threshold (default: 25)
- Volume Multiplier (default: 1.5)
- ATR Multiplier (default: 1.5)
- Minimum Confluence Score (default: 5)

Risk Management:
- Risk % per trade (default: 1.0)
- Risk:Reward Ratio (default: 2.0)
- Cooldown Bars (default: 5)
- Max Trades per Day (default: 3)
- Max Daily Loss % (default: 3.0)

Optional Filters (toggles):
- VWAP Filter ON/OFF
- Delta Filter ON/OFF
- FVG Filter ON/OFF
- Order Block Filter ON/OFF

Session Settings:
- Session Start Time (default: 09:15)
- Session End Time (default: 15:30)

Broker Settings:
- Connected broker selector
- Account type (Intraday/Delivery)

---

### Module 3: Trade Journal

**Purpose:** Complete record of all trades with filtering and annotation.

**Table columns:**
- Date/Time
- Symbol
- Direction (LONG/SHORT badge)
- Entry Price
- SL / TP
- Quantity
- Result (WIN/LOSS/OPEN badge)
- P&L (colored)
- R:R Achieved
- Confluence Score
- Duration
- Actions (expand, notes, screenshot)

**Filters:**
- Date range picker
- Symbol search
- Direction (All/Long/Short)
- Result (All/Win/Loss/Open)
- Broker

**Expandable row:**
- Full trade details
- Screenshot attachment (upload to Supabase Storage)
- Notes text area (auto-save)

**Export:** CSV download button

---

### Module 4: Performance Analytics

**Purpose:** Measure strategy performance and consistency.

**Metric Cards (top row):**
- Win Rate (% with color)
- Profit Factor (ratio)
- Max Drawdown (%)
- Total Net P&L (currency)
- Total Trades
- Avg R:R Achieved

**Charts:**
- Cumulative P&L curve (LineChart — Recharts)
- Monthly P&L bar chart (BarChart — Recharts)
- Win/Loss distribution (PieChart — Recharts)
- Confluence Score vs Win Rate scatter (optional Phase 2)

**Period selector:** Last 7 days / 30 days / 3 months / All time

---

### Module 5: Alerts & Notifications

**Purpose:** Complete alert history and delivery management.

**Alert types with icons:**
- 🟢 LONG_ENTRY — New long signal qualified
- 🔴 SHORT_ENTRY — New short signal qualified
- ❌ SL_HIT — Stop loss hit
- ✅ TP_HIT — Take profit hit
- ⚡ EXECUTION_SUCCESS — Trade executed successfully
- ⚠️ ORDER_REJECTED — Broker order rejected
- 🔒 DAILY_LOSS_LOCK — Daily loss limit reached
- 🕐 SESSION_END — Session ended, positions closed

**Delivery channels:**
- Dashboard (in-app notification bell)
- Email via Resend
- Mark as read / unread

---

### Module 6: Risk & Controls

**Purpose:** Real-time risk monitoring and safety controls.

**Displays:**
- Daily P&L meter (progress bar: green→red as loss increases)
- Trades today counter (X / max_trades_per_day)
- Cooldown status (active / inactive with timer)
- Active positions count

**Controls:**
- Master Kill Switch (disable all execution — prominent toggle)
- Max daily loss lock status
- Reset daily counters (admin only)

---

## 6. API Endpoints — Complete Reference

### Webhook
```
POST /api/webhook
  Headers: X-Webhook-Signature (HMAC-SHA256)
  Body: WebhookPayload
  Response: { status, signal_id, state } | { error, reason }
```

### Signals
```
GET  /api/signals          — List signals (paginated, filtered)
GET  /api/signals/current  — Latest active signal for dashboard
```

### Trades
```
POST /api/trades/execute   — Execute trade from signal
GET  /api/trades           — List trades (paginated, filtered)
GET  /api/trades/:id       — Single trade with full details
POST /api/trades/:id/close — Force close open position
PUT  /api/trades/:id/notes — Update notes/screenshot
```

### Settings
```
GET /api/settings          — Get user settings
PUT /api/settings          — Update settings (Zod validated)
```

### Broker
```
POST   /api/broker/connect       — Add broker account
GET    /api/broker/accounts      — List connected accounts
DELETE /api/broker/:id           — Remove broker account
GET    /api/broker/:id/balance   — Fetch live balance
```

### Performance
```
GET /api/performance         — Overall metrics
GET /api/performance/monthly — Monthly breakdown
```

### Alerts
```
GET  /api/alerts           — Alert history
POST /api/alerts/:id/read  — Mark as read
```

---

## 7. Broker Integration

### Phase 1: Angel One SmartAPI
- API: https://smartapi.angelone.in/
- SDK: `npm install smartapi-javascript`
- Auth: API Key + Client Code + Password + TOTP
- Cost: Free
- Rate limit: 20 req/s order APIs

### Phase 2 (Future): Zerodha Kite Connect
- Cost: Free (execution) + ₹500/mo (data)
- SDK: `npm install kiteconnect`
- Static IP required

### Phase 3 (Future): Upstox API v2
- Cost: Free
- SDK: `npm install upstox-js-sdk`
- Rate limit: 50 req/s (highest in India)

### Unified Broker Interface
All broker adapters implement the same `BrokerAdapter` interface.
The execution engine only calls interface methods — never broker-specific code directly.

---

## 8. Security Requirements

| Requirement | Implementation |
|-------------|----------------|
| Auth on all routes | Supabase JWT middleware |
| Broker key encryption | AES-256-CBC with ENCRYPTION_KEY env |
| Webhook authentication | HMAC-SHA256 signature |
| Row Level Security | Supabase RLS on all tables |
| Rate limiting | Vercel middleware per IP |
| Input validation | Zod on all API inputs |
| Audit trail | webhook_logs + trade history immutable |
| HTTPS only | Vercel enforces TLS |

---

## 9. Infrastructure

| Component | Service | Tier |
|-----------|---------|------|
| Frontend + API | Vercel | Pro (or Hobby for dev) |
| Database | Supabase | Free → Pro |
| Storage | Supabase Storage | Free (500MB) |
| Auth | Supabase Auth | Included |
| Email | Resend | Free (3k/mo) |
| Monitoring | Vercel Analytics | Free |

---

## 10. Cost Analysis

### Platform (Monthly)
| Service | Free | Paid |
|---------|------|------|
| Vercel | Free hobby | $20/mo Pro |
| Supabase | Free (500MB) | $25/mo Pro |
| Resend | 3,000 emails free | $20/mo |

### TradingView (Client's expense)
- **Essential plan: $12.95/month** — minimum for webhooks
- **Premium plan: $59.95/month** — recommended (non-expiring alerts)

### Broker APIs (Client's expense)
- Angel One: **Free**
- Upstox: **Free**
- Zerodha: Free execution + ₹500/mo for data

---

## 11. Confidentiality

This document and all described systems are the intellectual property of **GrindX Technologies PVT LTD**.

No part may be copied, redistributed, reverse-engineered, or transferred without written approval.

© 2025 GrindX Technologies PVT LTD. All Rights Reserved.
