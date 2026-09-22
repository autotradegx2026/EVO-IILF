# Paper trading diagnosis — 7 September 2026

The owner’s screenshots show actual strategy rejection, not a fabricated score or a requirement to force trades.

- Start: 7 September 03:05:12 IST (6 September 21:35:12 UTC).
- Market: Binance public Spot BTCUSDT, 15-minute completed candles.
- Saved session: 09:30–15:30 Asia/Kolkata. Entries outside that session are blocked even though crypto trades continuously.
- End: candle closing 7 September 14:45 IST. Binance timestamps its last millisecond as 09:14:59.999 UTC.
- Evaluations since Start: **47**. Qualified setups: **0**. No trade was inserted to demonstrate activity.

## Screenshot score

Close: **79,528.39 USDT**. SHORT bias. Score: **3/7**, below the saved **5/7** requirement. Trend, VWAP and delta passed; volume, sweep, FVG and order block failed. ATR was below its moving average, so volatility also blocked entry. The long score was zero. A SHORT bias alone is not a qualified SELL order. Binance Spot cannot open short positions; it uses BUY entries and SELL exits. Paper can model hypothetical shorts and labels its simulated results separately.

## Reproduction

The read-only replay fetched 700 actual BTCUSDT 15m bars and 400 hourly bars ending at the screenshot. For each of the 47 closed bars since the saved Start, it called the production strategy engine on the latest 500 base candles and latest 275 completed hourly candles, matching the worker’s rolling history. It used the saved parameters (included in the JSON evidence), with no parameter fitting. Overlapping rejection counts were: ADX 36, volatility 21, outside session 26, low confluence 45, neutral trend 15, invalid stop distance 15. Counts overlap because one candle can fail several gates.

[Machine-readable findings](paper-diagnosis-2026-09-07.json) retain configuration and market-derived results without owner identity. The final snapshot, qualification count and rejection counts all use the worker-sized rolling windows.

This verifies this observation window, not future signals, profitability, or broker fills. New release history records dated first evaluations per candle/configuration going forward; it does not invent overnight history or fills.
