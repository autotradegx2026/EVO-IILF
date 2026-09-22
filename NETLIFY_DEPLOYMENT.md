# Import AutotradeX into Netlify

Repository: https://github.com/autotradegx2026/EVO-IILF

The user will import this repository in Netlify. `netlify.toml` sets `npm run build`, `.next` as the publish directory and Node 22. Netlify detects Next.js and installs its OpenNext adapter automatically. Keep the Next.js API routes and middleware; do not configure this application as a static export or add a catch-all redirect to `index.html`.

## Environment before the first build

Use Netlify's project environment settings to set production values for both builds and functions. Variables in `netlify.toml` are build configuration, not a safe store for runtime credentials. Do not commit a filled environment file to this public repository.

Required:

- `NEXT_PUBLIC_SUPABASE_URL`: existing Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: existing public anon/publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: existing server-only key.
- `ENCRYPTION_KEY`: the exact existing key; changing it makes stored broker credentials unreadable.
- `NEXT_PUBLIC_APP_URL`: the final HTTPS Netlify site origin (no trailing slash).
- `CRON_SECRET`: the same value stored in Supabase Vault as `evo_paper_cron_secret`.
- `DEMO_MODE=false`, `NEXT_PUBLIC_DEMO_MODE=false`, `LIVE_TRADING_ENABLED=false` for the initial migration.

Keep the intended `BROKER_TESTNET_ENABLED` value and any existing optional mail, broker calendar or worker configuration. If `EXECUTION_WORKER_SECRET` is set, it must match the credential the execution scheduler sends. Broker API keys are still connected through the dashboard, not added to the repository. Give production secrets only to trusted production deploys, not untrusted pull-request previews.

## Verify the deployment before switching background jobs

1. Confirm the Netlify build completes with the Next.js adapter and server functions.
2. In Supabase Authentication URL Configuration, add the Netlify origin to the redirect allowlist and update Site URL when cutting over. Keep localhost for development if needed. Sign in using the existing personal account; do not create a new database or import dummy records.
3. Check Dashboard, Strategy, Paper Trade, Broker APIs, Risk, Analytics, Journal and Alerts. Confirm each page reads the existing account. Missing credentials must keep broker Start disabled.
4. Check that unauthenticated calls to `/api/jobs/paper`, `/api/jobs/execution` and private account APIs are rejected. Then verify an authenticated paper worker pass and the intended testnet worker heartbeat against the new host.
5. In Supabase Vault, change **only** `evo_paper_app_url` to the verified Netlify origin, with no trailing slash. Both existing Supabase cron invokers read this value. Preserve `evo_paper_cron_secret` and the existing cron schedules. Do not add duplicate Netlify/Vercel schedules.
6. Verify later scheduled paper passes finish and actual account observations advance. If testnet scheduling is active, verify its heartbeat and HTTP outcomes as well. Update existing TradingView webhook URLs to the Netlify host.
7. Retire the old Vercel deployment only after these checks pass. To roll back, restore the previous Vault origin and auth URL settings. The repository preparation does not itself change the hosted scheduler or account automation switches.

## Runtime boundaries

The paper worker has a 45-second work budget and is invoked through a normal HTTP route by Supabase Cron. Netlify documents a 60-second synchronous function limit, but a 30-second scheduled-function limit; use the existing Supabase HTTP invoker rather than moving this worker into a Netlify scheduled function. Observe real runtime and backlog after deployment.

The optional email job previously declared a 300-second Vercel allowance. That declaration does not extend Netlify's function limit. Leave email delivery disabled until its batch runtime has been accepted or the email worker is hosted separately.

The HTTP execution route remains testnet-only. Changing dashboard hosting does not supply an always-on live execution process or Angel One static egress. Real-money hosting and broker acceptance requirements remain in [CLIENT_HANDOFF.md](CLIENT_HANDOFF.md) and [BROKER_AUTOMATION.md](BROKER_AUTOMATION.md).

Sources: [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [function limits](https://docs.netlify.com/build/functions/configuration/), [Vercel migration checklist](https://docs.netlify.com/resources/checklists/vercel-to-netlify-migration/).
