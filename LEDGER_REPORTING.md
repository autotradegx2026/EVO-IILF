# Risk, analytics, journal and alerts

The four dashboard pages read the durable execution records. Select Paper, Testnet or Live explicitly; broker views also support an account filter. Earlier manual records remain available in a separate legacy view. No exchange rates are assumed: INR, USD, USDT and other quote currencies are never added together.

## Accounting rules

Analytics includes completed, fully exited workflows in close-time order. Gross PnL, recorded quote fees and PnL after those fees are separate values. Fully accounted net PnL is available only when all order snapshots are terminal, fees are known, no other-asset fees remain unconverted, and no unresolved error or residual inventory remains. Binance base-asset and BNB commissions are disclosed by asset. Angel One costs remain unavailable until supported by broker accounting. Paper results exclude execution costs.

Partial exits retain cumulative realized PnL in the journal but do not enter completed-trade statistics. The PnL chart is not account equity; audited percentage drawdown is unavailable. Monthly grouping uses the user's configured session timezone. Earlier manual records did not store a verified currency: they are labeled UNKNOWN and have no aggregated monetary statistics.

Risk displays the existing entry gate's daily count, selected-currency loss, cooldown, available quote balance and configured limits. Daily counts span accounts/currencies within the environment; broker cooldown follows the cross-environment execution history. Broker losses follow the gate's reconciliation date, not a separate cash-flow ledger. Account balance reads require a selected, connected account. Missing balance is unavailable, never zero. The global kill switch stops new entries; existing protection and closing continue. Other execution gates still apply.

## Journal and alert behavior

The journal supports symbol, direction, state, date, period, account and currency filters, server pagination, full filtered CSV, notes and private screenshots. CSV preserves negative numeric values and neutralizes spreadsheet formulas in text. Notes and attachments cannot update financial fields, execution versions or accounting timestamps. PNG/JPEG/WebP uploads are limited to 5 MiB and served only after ownership checks through a short-lived signed URL.

Database triggers create paper and broker lifecycle alerts transactionally: reservation, initial fill, protection, rejection, attention and closure. Repeated unchanged updates do not duplicate lifecycle alerts. The feed separates paper/testnet/live/legacy/system events, with currency, type, unread and page filters. Read updates are authenticated and scoped; failed requests remain visible. Ambiguous historical alerts remain System rather than being assigned an invented environment.

Email remains an optional separate integration. Configure and verify its sender and job before enabling delivery; this release does not activate email.

## APIs and limits

- `GET /api/reporting`: environment, currency, account, period (`7d`, `30d`, `90d`, `all`), view (`analytics`, `risk`, `journal`), page, limit (1–100), symbol, direction, status, from/to ISO timestamps and optional `format=csv`.
- `PATCH /api/reporting`: environment, record ID and notes only.
- `GET/POST /api/reporting/:id/screenshot?environment=...`: private viewing/upload.
- `/api/risk`, `/api/performance` and `/api/performance/monthly` use the same reporting service.
- `/api/alerts`: environment/currency/type/unread filters and scoped read updates.

The service reads fewer than 10,000 records per user/environment with a bounded paging budget. Larger histories fail explicitly with `REPORT_HISTORY_LIMIT_EXCEEDED`; totals and exports are never silently truncated. This capacity limit applies before period filtering. SQL aggregation/keyset reporting is required before exceeding it. Pages poll every 15 seconds; the alert feed polls every five seconds. Old manual endpoints remain for compatibility with historical records.

## Verification

Migrations 014 (transactional ledger alerts) and 015 (annotations) are applied to the linked Supabase project. `tests/sql/ledger-alerts.sql` verifies event isolation and update deduplication inside a rollback transaction. Reporting unit tests cover fee completeness, residual inventory, unknown currency, timezone grouping and CSV escaping.

The isolated acceptance script creates two temporary users and seeded paper/testnet/live records, checks currency totals, pagination, CSV, disconnected-account notices, annotation ownership, alert read scope and private screenshot access, then removes its fixtures. It makes no broker calls:

```sh
npx tsc --strict --target ES2022 --module commonjs --esModuleInterop --skipLibCheck --outDir .test-build/reporting scripts/verify-reporting-deployment.ts
VERIFICATION_URL=http://127.0.0.1:3101 node .test-build/reporting/scripts/verify-reporting-deployment.js
```

Use an explicit reviewed app origin and its matching Supabase configuration. `WRITE_BROWSER_FIXTURE=/absolute/private/path.json` retains the first temporary user for UI checks. Remove it afterward using `FIXTURE_FILE=/absolute/private/path.json`, the same verification origin, and `--cleanup-only`. The fixture file contains temporary login credentials and must never be committed.

Verified 6 September 2026 against local production and https://evo-iilf.vercel.app (release `506b619`): the complete authenticated acceptance script passed on both origins. Browser checks confirmed deployed totals, environment/currency filters, notes surviving refresh and saving, kill-switch persistence, and alert read updates. All 118 regression tests, lint, TypeScript and production build checks passed. The scheduled execution worker remained fresh, error-free and testnet-only. No broker orders or emails were sent. Temporary users and private attachments were cleaned up.
