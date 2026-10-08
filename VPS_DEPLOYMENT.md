# Production hosting — Hostinger VPS

Since 8 October 2026 AutotradeX runs entirely on one dedicated Hostinger VPS. This supersedes [NETLIFY_DEPLOYMENT.md](NETLIFY_DEPLOYMENT.md) and the Vercel/Supabase-cloud hosting described in older docs.

| | |
|---|---|
| Server | `91.108.104.102`, Ubuntu 26.04, 2 vCPU / 8 GB RAM / 96 GB, 4 GB swap |
| Public site | `https://autotradex.io` (`www` redirects here) |
| Supabase API | `https://api.autotradex.io` (self-hosted Supabase, Postgres 17.6) |
| Broker egress IP | `91.108.104.102` over IPv4. Register this static IP with Angel One. |
| DNS | Hostinger: `A @` and `A api` → `91.108.104.102`; `CNAME www` → `autotradex.io` |

## Layout on the server

| Path | Contents |
|---|---|
| `/opt/supabase` | Official self-hosted Supabase (`self-hosted/v0.8.2`). `.env` holds generated secrets (root-only). `docker-compose.local.yml` binds Postgres 5432, pooler 6543 and the API gateway 8000 to `127.0.0.1`. Docker port publishing bypasses ufw, so never publish a Supabase port publicly. |
| `/opt/caddy` | Caddy, the only public listener (80/443, automatic Let's Encrypt). `api.autotradex.io` exposes only `/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1`, `/functions/v1` and `/graphql/v1`; Studio returns 404 publicly. |
| `/opt/autotradex` | `docker-compose.yml` for `app` (Next.js, `Dockerfile.app`, `127.0.0.1:3000`) and `worker` (`Dockerfile.execution`), `app.env` (root-only runtime env shared by both) and `src/` (deployed source). |
| `/opt/backups` | Nightly 03:00 IST (`/etc/cron.d/autotradex-backup`): full Postgres dump plus storage files; 14 days retained. |

Firewall: ufw allows 22, 80 and 443 only. Unattended security upgrades are on. All containers use `restart: unless-stopped`.

## Deploying a change

From the repository root on a machine with SSH key access:

```sh
sed 's#^#/#' .dockerignore > /tmp/rsync-excl   # anchor patterns: a bare "supabase" would also drop lib/supabase
rsync -az --delete --exclude-from=/tmp/rsync-excl --exclude=.DS_Store ./ root@91.108.104.102:/opt/autotradex/src/
ssh root@91.108.104.102 'cd /opt/autotradex && docker compose build app worker && docker compose up -d'
```

Run `npm run check` and `npm run build` locally first. `NEXT_PUBLIC_*` values are build arguments taken from `app.env`, so changing them requires a rebuild.

## Schedulers and worker

- Supabase Cron in the self-hosted database: `evo-paper-worker` (every minute, POSTs `https://autotradex.io/api/jobs/paper`) and `evo-testnet-history-retention` (daily; also trims all cron run history older than 7 days).
- Vault: `evo_paper_cron_secret` equals `CRON_SECRET` in `app.env`; `evo_paper_app_url` is `https://autotradex.io`. Change both sides together.
- The five-second HTTP `evo-testnet-execution` job is intentionally **not** scheduled: the always-on `autotradex-worker` container holds the execution lease instead (see [BROKER_AUTOMATION.md](BROKER_AUTOMATION.md)). It runs with `BROKER_TESTNET_ENABLED=true` and `LIVE_TRADING_ENABLED=false`.

## Operations

```sh
ssh root@91.108.104.102
docker ps                                   # all 14 containers should be Up/healthy
docker logs -f autotradex-app               # or autotradex-worker, caddy, supabase-auth
docker exec -it supabase-db psql -U supabase_admin -d postgres
ssh -L 8000:127.0.0.1:8000 root@91.108.104.102   # then http://localhost:8000 for Studio (DASHBOARD_* in /opt/supabase/.env)
```

Restore a backup: `docker exec -i supabase-db pg_restore -U supabase_admin -d postgres --clean --if-exists < /opt/backups/<date>/postgres.dump`.

## Migration record (8 October 2026)

Schema, data, auth users (with existing password hashes), the `auth.users` triggers, the storage policy, the realtime publication, Vault secrets and cron jobs were copied from Supabase cloud project `itvcmfvvfemzykwtzvqd`. Every application table count matched before cutover. A local copy of the cloud dumps is in `~/evo-iilf-backups/2026-10-08-cloud/` on the owner's Mac. The cloud project's three cron jobs were paused (`cron.alter_job(..., active := false)`), not deleted; re-enable them only to roll back. Self-hosted Supabase uses a new JWT secret, so existing sessions ended and users sign in again with unchanged passwords. Public sign-up is disabled.

The public home page is `/`; the dashboard moved from `/` to `/dashboard`.
