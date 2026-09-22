'use client'

import { useEffect, useState } from 'react'

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
const ENVIRONMENTS = ['paper', 'testnet', 'live', 'system', 'legacy'] as const
const TYPES = ['LONG_ENTRY', 'SHORT_ENTRY', 'SL_HIT', 'TP_HIT', 'EXECUTION_SUCCESS', 'ORDER_REJECTED', 'DAILY_LOSS_LOCK', 'SESSION_END', 'COOLDOWN_START', 'SYSTEM'] as const
type Environment = typeof ENVIRONMENTS[number]
type AlertType = typeof TYPES[number]
type AlertRow = { id: string; type: AlertType; title: string; message: string; is_read: boolean; created_at: string; environment: Environment; currency: string | null; source_id: string | null }
type Feed = { data: AlertRow[]; count: number; page: number; limit: number; currencies: string[] }
const EMPTY: Feed = { data: [], count: 0, page: 1, limit: 25, currencies: [] }
const button = 'rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
const select = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm'
const ENVIRONMENT_LABELS: Record<Environment, string> = { paper: 'Paper simulation', testnet: 'Broker testnet', live: 'Live broker', system: 'System', legacy: 'Legacy / unclassified' }
const ENVIRONMENT_COLORS: Record<Environment, string> = { paper: 'border-blue-500/30 text-blue-500', testnet: 'border-amber-500/30 text-amber-500', live: 'border-red-500/30 text-red-500', system: 'border-border text-muted-foreground', legacy: 'border-border text-muted-foreground' }

function dateTime(value: string) {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Time unavailable'
}

export default function AlertsPage() {
  const [environment, setEnvironment] = useState<Environment>('paper')
  const [currency, setCurrency] = useState('')
  const [type, setType] = useState<AlertType | ''>('')
  const [unread, setUnread] = useState(false)
  const [page, setPage] = useState(1)
  const [feed, setFeed] = useState<Feed>(EMPTY)
  const [loading, setLoading] = useState(!DEMO_MODE)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (DEMO_MODE) return
    const controller = new AbortController()
    let inFlight = false
    setFeed(EMPTY)
    setCheckedAt(null)
    setLoading(true)
    setError('')
    async function load() {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      setRefreshing(true)
      try {
        const params = new URLSearchParams({ environment, page: String(page), limit: '25', unread: unread ? '1' : '0' })
        if (currency) params.set('currency', currency)
        if (type) params.set('type', type)
        const response = await fetch(`/api/alerts?${params}`, { cache: 'no-store', signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error('Unable to load alerts. Please retry.')
        if (!Array.isArray(result.data) || !Array.isArray(result.currencies) || !Number.isInteger(result.count)) throw new Error('The alert response was incomplete. Please retry.')
        if (controller.signal.aborted) return
        const pages = Math.max(1, Math.ceil(result.count / 25))
        if (page > pages) { setPage(pages); return }
        setFeed(result as Feed)
        setCheckedAt(new Date().toISOString())
        setError('')
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load alerts. Please retry.')
      } finally {
        inFlight = false
        if (!controller.signal.aborted) { setLoading(false); setRefreshing(false) }
      }
    }
    void load()
    const interval = window.setInterval(() => void load(), 5000)
    return () => { controller.abort(); window.clearInterval(interval) }
  }, [environment, currency, type, unread, page, revision])

  async function markRead(ids?: string[]) {
    if (DEMO_MODE || busy || loading || refreshing) return
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const response = await fetch('/api/alerts', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment, ...(currency ? { currency } : {}), ...(type ? { type } : {}), ...(ids ? { ids } : { mark_all: true }) }),
      })
      const result = await response.json()
      if (!response.ok || !Number.isInteger(result.count)) throw new Error('Read status could not be saved. Please retry.')
      setNotice(`${result.count} alert${result.count === 1 ? '' : 's'} marked read.`)
      // Reload from the server only after a confirmed write; never claim an optimistic read.
      setRevision(value => value + 1)
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Read status could not be saved. Please retry.') }
    finally { setBusy(false) }
  }

  const pages = Math.max(1, Math.ceil(feed.count / 25))
  const currencyOptions = Array.from(new Set([...feed.currencies, ...(currency ? [currency] : [])])).sort()
  return <div className="mx-auto flex max-w-4xl flex-col gap-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-bold">Alerts</h1><p className="mt-2 text-sm text-muted-foreground">Execution updates and strategy events, separated by environment and currency.</p></div><button className={button} disabled={DEMO_MODE || busy || refreshing} onClick={() => setRevision(value => value + 1)}>{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
    {DEMO_MODE && <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">Read-only demo. No account alerts are loaded and no execution events are simulated here.</div>}
    <fieldset disabled={busy || DEMO_MODE} className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
      <label className="text-xs text-muted-foreground">Environment<select className={select} value={environment} onChange={event => { setEnvironment(event.target.value as Environment); setCurrency(''); setPage(1); setNotice(''); setActionError('') }}>{ENVIRONMENTS.map(value => <option key={value} value={value}>{ENVIRONMENT_LABELS[value]}</option>)}</select></label>
      <label className="text-xs text-muted-foreground">Currency<select className={select} value={currency} onChange={event => { setCurrency(event.target.value); setPage(1); setNotice('') }}><option value="">All currencies</option>{currencyOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="text-xs text-muted-foreground">Event type<select className={select} value={type} onChange={event => { setType(event.target.value as AlertType | ''); setPage(1); setNotice('') }}><option value="">All event types</option>{TYPES.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="flex items-center gap-2 text-xs sm:col-span-3"><input type="checkbox" checked={unread} onChange={event => { setUnread(event.target.checked); setPage(1) }} />Unread only</label>
    </fieldset>
    <p className="text-xs leading-relaxed text-muted-foreground">{environment === 'paper' ? 'Paper events describe simulated trades. Amounts and fee assumptions are stated in each event.' : environment === 'testnet' ? 'Testnet events concern the broker’s test environment and do not represent live funds.' : environment === 'live' ? 'Live events refer to broker executions. Gross PnL excludes fees; unknown fees are not treated as zero.' : environment === 'legacy' ? 'Earlier alerts without reliable environment attribution are kept here, separate from paper and broker activity.' : 'Account and platform notices appear here.'} Currency options cover all alerts in this environment. Amounts are never combined across currencies.</p>
    {(error || actionError) && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm"><span>{actionError || error}{error && feed.data.length > 0 ? ' Previously loaded alerts remain visible.' : ''}</span><button className={button} disabled={busy || refreshing} onClick={() => { setActionError(''); setRevision(value => value + 1) }}>Retry loading</button></div>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{loading ? 'Loading…' : error ? 'Alert counts unavailable' : `${feed.count} matching alerts · Page ${page} of ${pages}`} · Refreshes every 5 seconds · Last successful read: {checkedAt ? dateTime(checkedAt) : 'Not recorded'}</p><button className={button} disabled={DEMO_MODE || busy || loading || refreshing || !!error || feed.count === 0} onClick={() => void markRead()}>{busy ? 'Saving…' : 'Mark matching alerts read'}</button></div>
    {loading ? <div className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground">Loading alerts…</div> : feed.data.length === 0 ? <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{error ? 'Alerts are unavailable until the request succeeds.' : 'No alerts match these filters.'}</div> : <div className="flex flex-col gap-3">{feed.data.map(alert => <article key={alert.id} className={`rounded-xl border p-4 ${alert.is_read ? 'border-border bg-card' : 'border-primary/30 bg-primary/5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className={`rounded border px-2 py-1 text-[10px] font-semibold uppercase ${ENVIRONMENT_COLORS[alert.environment] ?? ENVIRONMENT_COLORS.system}`}>{ENVIRONMENT_LABELS[alert.environment] ?? alert.environment}</span><span className="rounded border border-border px-2 py-1 text-[10px] font-semibold">{alert.type.replaceAll('_', ' ')}</span><span className="text-xs text-muted-foreground">{alert.currency ?? 'Currency not specified'}</span>{!alert.is_read && <span className="text-xs font-medium text-primary">Unread</span>}</div><time dateTime={alert.created_at} className="text-xs text-muted-foreground">{dateTime(alert.created_at)}</time></div>
      <h2 className="mt-3 text-sm font-medium">{alert.title}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{alert.message}</p>
      {!alert.is_read && <button className={`${button} mt-3`} disabled={DEMO_MODE || busy || loading || refreshing || !!error} onClick={() => void markRead([alert.id])}>Mark read</button>}
    </article>)}</div>}
    <div className="flex items-center justify-between"><button className={button} disabled={DEMO_MODE || busy || loading || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span className="text-xs text-muted-foreground">Page {page} / {pages}</span><button className={button} disabled={DEMO_MODE || busy || loading || page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div>
  </div>
}
