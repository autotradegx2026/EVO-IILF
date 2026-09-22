# Dashboard data and status

Operational information is read from the authenticated account and refreshed independently of whether a new trade exists. No generated signals, fills, connection statuses, or timestamps are used.

| Page or panel | Source | Refresh and meaning |
| --- | --- | --- |
| Dashboard entry controls | Saved settings and selected execution account | Every 15 seconds. The entry switch is the kill switch; it does not claim live automation is enabled. Broker verification shows its recorded time. |
| Signals and webhook deliveries | Account signal and webhook records | Realtime plus polling. Receipt is not trade qualification or a broker connection. Failed reads show unavailable. |
| Paper automation | `automation_runs` plus this account’s saved scan settings | Every 15 seconds. Worker start/finish times are scheduler runs, not the start of the user’s trading session. Account scan checks and session/enable/error states are shown separately. |
| Paper statistics | Saved paper trades, selected currency | Latest 100 records with the actual total count. Missing performance samples show no data. No records is distinct from a failed request. |
| Saved strategy and risk panel | Account settings | Shows the saved reward/risk and limits, plus their saved timestamp. These are configuration values, not achieved performance. |
| Historical backtest | Actual closed candles returned by the backtest API | One request per run. New results include start/finish and candle-range metadata. Browser-cached older results explicitly lack those timestamps; clearing results does not stop automation. |
| Broker API settings and automation | Execution accounts, ledger, worker and environment gates | Every 5 seconds. Unknown/loading states never claim disabled gates, disconnected accounts, or healthy workers. Prior successful snapshots are disclosed on refresh failure. |
| Risk, Analytics and Journal | Environment/currency-scoped execution ledger | Every 15 seconds with server report timestamp. Paper equity is a simulated calculation; broker balance timestamps refer to an actual balance read. Missing fees and marks remain unavailable. |
| Alerts | Account alert rows | Every 5 seconds with last successful read. Counts are unavailable if the request fails. |
| Charts and strategy reference | Saved settings plus TradingView market feed | Settings refresh every 15 seconds. Interval, timezone and study configuration come from saved settings. Chart prices are supplied by TradingView. |
| Strategy and Settings forms | Persisted settings loaded into an editable draft | Saved timestamps and unsaved-change notices distinguish draft edits from operational configuration. Screener monitoring refreshes separately every 15 seconds. |
| Profile | Supabase authenticated user | Read on page load; edits are acknowledged only after a successful Auth response. |

General usage instructions remain explanatory text. Research targets are not displayed as achieved results. Counts of zero represent a successful read with no matching records; undefined ratios are not reported as zero performance.


### Trading controls and page separation — 7 September 2026

Paper start/stop timestamps come from settings transitions; worker run timestamps are labeled separately. Native paper checks come from `paper_observations`, with actual Binance closed-candle values and strategy/entry-rejection reasons. No-data/error/stopped views never substitute sample observations. Native paper uses `paper_symbols` and `paper_timeframe`; broker watchlists remain in the strategy screener. Historical backtesting is a separate collapsed research section.

The Live Dashboard now shows the broker automation switch and real execution-account position summaries. Its earlier global entry-permission toggle and legacy position cards were removed; the global pause remains in Risk. Broker APIs handles credentials only; Broker Orders handles ledger/close operations with a Live/Testnet filter. All switches persist server-side and stop new entries without cancelling exit monitoring.
