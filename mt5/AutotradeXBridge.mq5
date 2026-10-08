//+------------------------------------------------------------------+
//| AutotradeX Bridge                                                |
//| Executes AutotradeX commands in this MT5 account and reports     |
//| account, symbol, command and position/deal state.                |
//| Requires: Algo Trading on, and WebRequest allowed for the URL.   |
//+------------------------------------------------------------------+
#property copyright "GrindX Technologies Pvt Ltd"
#property version   "1.00"
#property strict

input string BridgeUrl = "https://autotradex.io/api/mt5/bridge";
input int    PollMs    = 700;

#define BRIDGE_MAGIC 20261009
#define TOKEN_FILE   "autotradex_token.txt"

struct PendingResult { long id; string json; };

string        g_token = "";
string        g_requests[];   // symbol names requested by the platform
string        g_resolved[];   // matching broker symbol names ("" = not found)
long          g_track[];      // position ids to report
PendingResult g_results[];    // command results kept until the server ACKs them
string        g_error = "";

//--- small helpers --------------------------------------------------
string Esc(string s) { StringReplace(s, "\\", "\\\\"); StringReplace(s, "\"", "\\\""); return s; }
string Q(string s) { return "\"" + Esc(s) + "\""; }
string D(double v) { return DoubleToString(v, 8); }
string L(long v) { return IntegerToString(v); }
string B(bool v) { return v ? "true" : "false"; }

string ReadToken()
{
   int h = FileOpen(TOKEN_FILE, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return "";
   string t = FileReadString(h);
   FileClose(h);
   StringTrimLeft(t); StringTrimRight(t);
   return t;
}

//--- symbol resolution: exact name, else the shortest tradable name with the same prefix (EURUSD.std, EURUSD#),
//--- then common broker aliases (XM names gold GOLD).
string ResolveName(string request)
{
   if(SymbolSelect(request, true)) return request;
   string best = "";
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, false);
      if(StringFind(name, request) != 0 || StringLen(name) - StringLen(request) > 4) continue;
      if(SymbolInfoInteger(name, SYMBOL_TRADE_MODE) == SYMBOL_TRADE_MODE_DISABLED) continue;
      if(best == "" || StringLen(name) < StringLen(best)) best = name;
   }
   if(best != "") SymbolSelect(best, true);
   return best;
}

string Resolve(string request)
{
   string found = ResolveName(request);
   if(found != "") return found;
   string aliases[][2] = { {"XAUUSD", "GOLD"}, {"XAGUSD", "SILVER"}, {"GOLD", "XAUUSD"}, {"SILVER", "XAGUSD"},
                           {"US30", "DJ30"}, {"NAS100", "US100"}, {"NAS100", "USTEC"}, {"SPX500", "US500"}, {"UKOIL", "BRENT"}, {"USOIL", "WTI"} };
   for(int i = 0; i < ArrayRange(aliases, 0); i++)
      if(aliases[i][0] == request) { found = ResolveName(aliases[i][1]); if(found != "") return found; }
   return "";
}

string ResolvedFor(string request)
{
   for(int i = 0; i < ArraySize(g_requests); i++) if(g_requests[i] == request) return g_resolved[i];
   int n = ArraySize(g_requests);
   ArrayResize(g_requests, n + 1); ArrayResize(g_resolved, n + 1);
   g_requests[n] = request; g_resolved[n] = Resolve(request);
   return g_resolved[n];
}

ENUM_ORDER_TYPE_FILLING Filling(string symbol)
{
   long mode = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((mode & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK) return ORDER_FILLING_FOK;
   if((mode & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC) return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
}

//--- report sections -------------------------------------------------
string AccountJson()
{
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string tm = mode == ACCOUNT_TRADE_MODE_REAL ? "REAL" : mode == ACCOUNT_TRADE_MODE_CONTEST ? "CONTEST" : "DEMO";
   long mm = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   string ms = mm == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING ? "HEDGING" : mm == ACCOUNT_MARGIN_MODE_RETAIL_NETTING ? "NETTING" : "EXCHANGE";
   bool allowed = TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && MQLInfoInteger(MQL_TRADE_ALLOWED)
                  && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
   return "{\"login\":" + L(AccountInfoInteger(ACCOUNT_LOGIN)) + ",\"server\":" + Q(AccountInfoString(ACCOUNT_SERVER))
        + ",\"company\":" + Q(AccountInfoString(ACCOUNT_COMPANY)) + ",\"trade_mode\":" + Q(tm) + ",\"margin_mode\":" + Q(ms)
        + ",\"currency\":" + Q(AccountInfoString(ACCOUNT_CURRENCY)) + ",\"balance\":" + D(AccountInfoDouble(ACCOUNT_BALANCE))
        + ",\"equity\":" + D(AccountInfoDouble(ACCOUNT_EQUITY)) + ",\"margin_free\":" + D(AccountInfoDouble(ACCOUNT_MARGIN_FREE))
        + ",\"leverage\":" + L(AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",\"trade_allowed\":" + B(allowed)
        + ",\"connected\":" + B(TerminalInfoInteger(TERMINAL_CONNECTED)) + ",\"build\":" + L(TerminalInfoInteger(TERMINAL_BUILD)) + "}";
}

string SymbolsJson()
{
   string out = "";
   for(int i = 0; i < ArraySize(g_requests); i++)
   {
      string r = g_requests[i], s = g_resolved[i];
      if(s == "") { g_resolved[i] = Resolve(r); s = g_resolved[i]; }
      if(out != "") out += ",";
      if(s == "")
      {
         out += "{\"request\":" + Q(r) + ",\"resolved\":\"\",\"base\":\"\",\"quote\":\"\",\"digits\":0,\"tick_size\":0,\"tick_value\":0,\"contract_size\":0,"
              + "\"volume_min\":0,\"volume_max\":0,\"volume_step\":0,\"bid\":0,\"ask\":0,\"margin_per_lot\":0,\"trade_mode\":0,\"quote_time\":0}";
         continue;
      }
      double bid = SymbolInfoDouble(s, SYMBOL_BID), ask = SymbolInfoDouble(s, SYMBOL_ASK), margin = 0;
      if(!OrderCalcMargin(ORDER_TYPE_BUY, s, 1.0, ask, margin)) margin = 0;
      out += "{\"request\":" + Q(r) + ",\"resolved\":" + Q(s)
           + ",\"base\":" + Q(SymbolInfoString(s, SYMBOL_CURRENCY_BASE)) + ",\"quote\":" + Q(SymbolInfoString(s, SYMBOL_CURRENCY_PROFIT))
           + ",\"digits\":" + L(SymbolInfoInteger(s, SYMBOL_DIGITS)) + ",\"tick_size\":" + D(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE))
           + ",\"tick_value\":" + D(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE)) + ",\"contract_size\":" + D(SymbolInfoDouble(s, SYMBOL_TRADE_CONTRACT_SIZE))
           + ",\"volume_min\":" + D(SymbolInfoDouble(s, SYMBOL_VOLUME_MIN)) + ",\"volume_max\":" + D(SymbolInfoDouble(s, SYMBOL_VOLUME_MAX))
           + ",\"volume_step\":" + D(SymbolInfoDouble(s, SYMBOL_VOLUME_STEP)) + ",\"bid\":" + D(bid) + ",\"ask\":" + D(ask)
           + ",\"margin_per_lot\":" + D(margin) + ",\"trade_mode\":" + L(SymbolInfoInteger(s, SYMBOL_TRADE_MODE))
           + ",\"quote_time\":" + L(SymbolInfoInteger(s, SYMBOL_TIME)) + "}";
   }
   return out;
}

string EntryName(long e) { return e == DEAL_ENTRY_IN ? "IN" : e == DEAL_ENTRY_OUT ? "OUT" : e == DEAL_ENTRY_INOUT ? "INOUT" : "OUT_BY"; }
string ReasonName(long r)
{
   switch((int)r)
   {
      case DEAL_REASON_SL: return "SL";
      case DEAL_REASON_TP: return "TP";
      case DEAL_REASON_SO: return "SO";
      case DEAL_REASON_EXPERT: return "EXPERT";
      case DEAL_REASON_CLIENT: return "CLIENT";
      case DEAL_REASON_MOBILE: return "MOBILE";
      case DEAL_REASON_WEB: return "WEB";
      default: return "OTHER";
   }
}

string PositionJson(long id)
{
   bool open = PositionSelectByTicket((ulong)id);
   string symbol = open ? PositionGetString(POSITION_SYMBOL) : "";
   double sl = open ? PositionGetDouble(POSITION_SL) : 0, tp = open ? PositionGetDouble(POSITION_TP) : 0;
   bool magic = open && PositionGetInteger(POSITION_MAGIC) == BRIDGE_MAGIC;
   string deals = "";
   if(HistorySelectByPosition(id))
   {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total && i < 50; i++)
      {
         ulong t = HistoryDealGetTicket(i);
         long type = HistoryDealGetInteger(t, DEAL_TYPE);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
         if(symbol == "") symbol = HistoryDealGetString(t, DEAL_SYMBOL);
         if(deals != "") deals += ",";
         deals += "{\"ticket\":" + L((long)t) + ",\"order\":" + L(HistoryDealGetInteger(t, DEAL_ORDER))
                + ",\"entry\":" + Q(EntryName(HistoryDealGetInteger(t, DEAL_ENTRY))) + ",\"reason\":" + Q(ReasonName(HistoryDealGetInteger(t, DEAL_REASON)))
                + ",\"volume\":" + D(HistoryDealGetDouble(t, DEAL_VOLUME)) + ",\"price\":" + D(HistoryDealGetDouble(t, DEAL_PRICE))
                + ",\"commission\":" + D(HistoryDealGetDouble(t, DEAL_COMMISSION)) + ",\"swap\":" + D(HistoryDealGetDouble(t, DEAL_SWAP))
                + ",\"fee\":" + D(HistoryDealGetDouble(t, DEAL_FEE)) + ",\"profit\":" + D(HistoryDealGetDouble(t, DEAL_PROFIT))
                + ",\"time\":" + L(HistoryDealGetInteger(t, DEAL_TIME)) + "}";
      }
   }
   return "{\"id\":" + L(id) + ",\"symbol\":" + Q(symbol) + ",\"open\":" + B(open) + ",\"magic\":" + B(magic)
        + ",\"sl\":" + D(sl) + ",\"tp\":" + D(tp) + ",\"deals\":[" + deals + "]}";
}

string PositionsJson()
{
   long ids[];
   int n = 0;
   for(int i = 0; i < ArraySize(g_track); i++) { ArrayResize(ids, n + 1); ids[n++] = g_track[i]; }
   // Every open position carrying our magic is reported, so the platform can spot untracked exposure.
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != BRIDGE_MAGIC) continue;
      long id = PositionGetInteger(POSITION_IDENTIFIER);
      bool seen = false;
      for(int k = 0; k < n; k++) if(ids[k] == id) { seen = true; break; }
      if(!seen) { ArrayResize(ids, n + 1); ids[n++] = id; }
   }
   string out = "";
   for(int i = 0; i < n && i < 100; i++) { if(out != "") out += ","; out += PositionJson(ids[i]); }
   return out;
}

string ResultsJson()
{
   string out = "";
   for(int i = 0; i < ArraySize(g_results) && i < 40; i++) { if(out != "") out += ","; out += g_results[i].json; }
   return out;
}

void AddResult(long id, bool ok, long retcode, string message, ulong order, ulong deal, long position, double price, double volume)
{
   int n = ArraySize(g_results);
   ArrayResize(g_results, n + 1);
   g_results[n].id = id;
   g_results[n].json = "{\"id\":" + L(id) + ",\"status\":" + Q(ok ? "DONE" : "FAILED") + ",\"retcode\":" + L(retcode)
                     + ",\"message\":" + Q(StringSubstr(message, 0, 110)) + ",\"order\":" + L((long)order) + ",\"deal\":" + L((long)deal)
                     + ",\"position\":" + L(position) + ",\"price\":" + D(price) + ",\"volume\":" + D(volume) + "}";
}

void Ack(long id)
{
   for(int i = ArraySize(g_results) - 1; i >= 0; i--)
      if(g_results[i].id == id)
      {
         for(int k = i; k < ArraySize(g_results) - 1; k++) g_results[k] = g_results[k + 1];
         ArrayResize(g_results, ArraySize(g_results) - 1);
      }
}

//--- execution ---------------------------------------------------------
long PositionOfDeal(ulong deal)
{
   for(int attempt = 0; attempt < 10; attempt++)
   {
      if(HistoryDealSelect(deal)) return HistoryDealGetInteger(deal, DEAL_POSITION_ID);
      HistorySelect(TimeCurrent() - 86400, TimeCurrent() + 86400);
      Sleep(100);
   }
   return 0;
}

bool Done(uint retcode) { return retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_DONE_PARTIAL || retcode == TRADE_RETCODE_PLACED; }

void Execute(long id, string kind, string client, string request, string side, double volume, double sl, double tp, long position)
{
   string symbol = ResolvedFor(request);
   if(symbol == "") { AddResult(id, false, 0, "SYMBOL_NOT_FOUND", 0, 0, 0, 0, 0); return; }
   MqlTradeRequest req;
   MqlTradeResult  res;
   ZeroMemory(req); ZeroMemory(res);
   req.magic = BRIDGE_MAGIC;
   req.symbol = symbol;
   req.deviation = 30;

   if(kind == "ENTRY")
   {
      double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
      req.action = TRADE_ACTION_DEAL;
      req.type = side == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      req.volume = NormalizeDouble(MathFloor(volume / step + 1e-9) * step, 8);
      req.price = side == "BUY" ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
      req.type_filling = Filling(symbol);
      req.comment = client;
      bool sent = OrderSend(req, res);
      if(!sent || !Done(res.retcode)) { AddResult(id, false, res.retcode, res.comment, res.order, res.deal, 0, 0, 0); return; }
      AddResult(id, true, res.retcode, res.comment, res.order, res.deal, PositionOfDeal(res.deal), res.price, res.volume);
      return;
   }
   bool open = PositionSelectByTicket((ulong)position);
   if(kind == "PROTECT" || kind == "UNPROTECT")
   {
      if(!open)
      {
         // Withdrawing protection from a closed position is complete; protecting one is not possible.
         AddResult(id, kind == "UNPROTECT", 0, kind == "UNPROTECT" ? "POSITION_CLOSED" : "POSITION_NOT_FOUND", 0, 0, position, 0, 0);
         return;
      }
      req.action = TRADE_ACTION_SLTP;
      req.position = (ulong)position;
      req.symbol = PositionGetString(POSITION_SYMBOL);
      int digits = (int)SymbolInfoInteger(req.symbol, SYMBOL_DIGITS);
      req.sl = kind == "PROTECT" ? NormalizeDouble(sl, digits) : 0;
      req.tp = kind == "PROTECT" ? NormalizeDouble(tp, digits) : 0;
      bool sent = OrderSend(req, res);
      bool ok = sent && (Done(res.retcode) || res.retcode == TRADE_RETCODE_NO_CHANGES);
      AddResult(id, ok, res.retcode, res.comment, res.order, 0, position, 0, 0);
      return;
   }
   if(kind == "CLOSE")
   {
      if(!open) { AddResult(id, true, 0, "ALREADY_CLOSED", 0, 0, position, 0, 0); return; }
      req.action = TRADE_ACTION_DEAL;
      req.position = (ulong)position;
      req.symbol = PositionGetString(POSITION_SYMBOL);
      long type = PositionGetInteger(POSITION_TYPE);
      req.type = type == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
      req.volume = MathMin(volume, PositionGetDouble(POSITION_VOLUME));
      req.price = type == POSITION_TYPE_BUY ? SymbolInfoDouble(req.symbol, SYMBOL_BID) : SymbolInfoDouble(req.symbol, SYMBOL_ASK);
      req.type_filling = Filling(req.symbol);
      req.comment = client;
      bool sent = OrderSend(req, res);
      bool ok = sent && Done(res.retcode);
      AddResult(id, ok, res.retcode, res.comment, res.order, res.deal, position, res.price, res.volume);
      return;
   }
   AddResult(id, false, 0, "UNKNOWN_COMMAND", 0, 0, 0, 0, 0);
}

// A delivered command whose result was lost: find what actually happened before reporting.
void ResolveStale(long id, string kind, string client, long position, double sl, double tp)
{
   if(!TerminalInfoInteger(TERMINAL_CONNECTED)) return;   // never conclude anything while offline
   if(kind == "ENTRY" || kind == "CLOSE")
   {
      HistorySelect(TimeCurrent() - 3 * 86400, TimeCurrent() + 86400);
      for(int i = HistoryOrdersTotal() - 1; i >= 0; i--)
      {
         ulong t = HistoryOrderGetTicket(i);
         if(HistoryOrderGetInteger(t, ORDER_MAGIC) != BRIDGE_MAGIC || HistoryOrderGetString(t, ORDER_COMMENT) != client) continue;
         long state = HistoryOrderGetInteger(t, ORDER_STATE);
         if(state == ORDER_STATE_FILLED || state == ORDER_STATE_PARTIAL)
            AddResult(id, true, TRADE_RETCODE_DONE, "RESOLVED", t, 0, HistoryOrderGetInteger(t, ORDER_POSITION_ID), HistoryOrderGetDouble(t, ORDER_PRICE_OPEN), HistoryOrderGetDouble(t, ORDER_VOLUME_INITIAL) - HistoryOrderGetDouble(t, ORDER_VOLUME_CURRENT));
         else AddResult(id, false, 0, "RESOLVED_NOT_FILLED", t, 0, 0, 0, 0);
         return;
      }
      if(kind == "CLOSE" && !PositionSelectByTicket((ulong)position)) { AddResult(id, true, 0, "ALREADY_CLOSED", 0, 0, position, 0, 0); return; }
      AddResult(id, false, 0, "RESOLVED_NOT_FOUND", 0, 0, 0, 0, 0);
      return;
   }
   // PROTECT / UNPROTECT: the position's current stops show whether the change took effect.
   if(!PositionSelectByTicket((ulong)position)) { AddResult(id, kind == "UNPROTECT", 0, "POSITION_CLOSED", 0, 0, position, 0, 0); return; }
   double psl = PositionGetDouble(POSITION_SL), ptp = PositionGetDouble(POSITION_TP);
   double point = SymbolInfoDouble(PositionGetString(POSITION_SYMBOL), SYMBOL_POINT);
   bool applied = kind == "PROTECT" ? MathAbs(psl - sl) < point / 2 && MathAbs(ptp - tp) < point / 2 : psl == 0 && ptp == 0;
   AddResult(id, applied, 0, applied ? "RESOLVED" : "RESOLVED_NOT_APPLIED", 0, 0, position, 0, 0);
}

//--- poll loop -----------------------------------------------------------
void HandleResponse(string text)
{
   string lines[];
   int count = StringSplit(text, '\n', lines);
   if(count < 1 || StringFind(lines[0], "OK|") != 0) { g_error = "BAD_RESPONSE"; return; }
   string requests[];
   long track[];
   for(int i = 1; i < count; i++)
   {
      string f[];
      int k = StringSplit(lines[i], '|', f);
      if(k < 2) continue;
      if(f[0] == "ACK") Ack(StringToInteger(f[1]));
      else if(f[0] == "SYM") { int n = ArraySize(requests); ArrayResize(requests, n + 1); requests[n] = f[1]; }
      else if(f[0] == "TRACK") { int n = ArraySize(track); ArrayResize(track, n + 1); track[n] = StringToInteger(f[1]); }
   }
   // Keep resolutions for symbols still requested; new requests resolve on first use.
   string keepR[], keepS[];
   for(int i = 0; i < ArraySize(requests); i++)
   {
      ArrayResize(keepR, i + 1); ArrayResize(keepS, i + 1);
      keepR[i] = requests[i]; keepS[i] = "";
      for(int k = 0; k < ArraySize(g_requests); k++) if(g_requests[k] == requests[i]) keepS[i] = g_resolved[k];
   }
   ArrayCopy(g_requests, keepR); ArrayResize(g_requests, ArraySize(keepR));
   ArrayCopy(g_resolved, keepS); ArrayResize(g_resolved, ArraySize(keepS));
   ArrayCopy(g_track, track); ArrayResize(g_track, ArraySize(track));
   for(int i = 1; i < count; i++)
   {
      string f[];
      int k = StringSplit(lines[i], '|', f);
      if(k < 2) continue;   // blank trailing line
      if(f[0] == "CMD" && k >= 10)
         Execute(StringToInteger(f[1]), f[2], f[3], f[4], f[5], StringToDouble(f[6]), StringToDouble(f[7]), StringToDouble(f[8]), StringToInteger(f[9]));
      else if(f[0] == "RESOLVE" && k >= 7)
      {
         bool pending = false;
         for(int r = 0; r < ArraySize(g_results); r++) if(g_results[r].id == StringToInteger(f[1])) pending = true;
         if(!pending) ResolveStale(StringToInteger(f[1]), f[2], f[3], StringToInteger(f[4]), StringToDouble(f[5]), StringToDouble(f[6]));
      }
   }
}

void Poll()
{
   string body = "{\"v\":1" + (g_error != "" ? ",\"error\":" + Q(g_error) : "") + ",\"account\":" + AccountJson()
               + ",\"symbols\":[" + SymbolsJson() + "],\"results\":[" + ResultsJson() + "],\"positions\":[" + PositionsJson() + "]}";
   char data[], reply[];
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + g_token + "\r\n", replyHeaders;
   int size = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, size > 0 ? size - 1 : 0);   // drop the terminating zero
   ResetLastError();
   int status = WebRequest("POST", BridgeUrl, headers, 5000, data, reply, replyHeaders);
   if(status == -1)
   {
      int err = GetLastError();
      g_error = err == 4014 ? "WEBREQUEST_URL_NOT_ALLOWED" : "WEBREQUEST_" + IntegerToString(err);
      if(err == 4014) Comment("AutotradeX: allow WebRequest for https://autotradex.io in Tools > Options > Expert Advisors");
      return;
   }
   if(status != 200) { g_error = "HTTP_" + IntegerToString(status); return; }
   g_error = "";
   Comment("AutotradeX Bridge connected · ", TimeToString(TimeLocal(), TIME_SECONDS));
   HandleResponse(CharArrayToString(reply, 0, WHOLE_ARRAY, CP_UTF8));
}

int OnInit()
{
   g_token = ReadToken();
   if(StringLen(g_token) != 64)
   {
      Comment("AutotradeX: token file MQL5\\Files\\" + TOKEN_FILE + " is missing");
      return INIT_FAILED;
   }
   EventSetMillisecondTimer(MathMax(PollMs, 300));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); Comment(""); }
void OnTimer() { Poll(); }
