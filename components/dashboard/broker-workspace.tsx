'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Environment, Execution } from '@/lib/execution/model'
import { sessionLabel } from '@/lib/trading/session'

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
type BrokerName = 'binance' | 'angelone' | 'mt5'
type Bridge = { account_id: string; login: number | null; server: string | null; company: string | null; trade_mode: string | null; margin_mode: string | null; currency: string | null; balance: number | null; equity: number | null; margin_free: number | null; leverage: number | null; trade_allowed: boolean; connected: boolean; untracked_positions: number; heartbeat_at: string | null; last_error: string | null }
type Account = { id: string; broker: BrokerName; environment: Environment; label: string; connected: boolean; last_checked_at: string | null; error: string | null }
type AutomationData = {
  accounts: Account[]
  settings: { account_id: string | null; auto_enabled: boolean; max_price_drift_bps: number; updated_at?: string; started_at?: string | null; stopped_at?: string | null }
  executions: Execution[]
  worker: { heartbeat_at: string | null; last_error: string | null; enabled_environments: Environment[] } | null
  gates: { testnet: boolean; live: boolean }
  bridges?: Bridge[]
  configuration: { kill_switch_active: boolean; signal_delivery_mode: string; screener_symbols: string[]; screener_timeframe:string; session_start: string; session_end: string; session_timezone: string } | null
}
const EMPTY_CREDENTIALS = { apiKey: '', apiSecret: '', password: '', totpSecret: '', clientCode: '', localIp: '', publicIp: '' }
const MT5_SYMBOL = /^[A-Z0-9_]+:[A-Z0-9._]+$/
const DEFAULT_LABEL: Record<BrokerName, string> = { binance: 'Binance Spot testnet', angelone: 'Angel One live', mt5: 'XM MT5 demo' }
const inputClass = 'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const buttonClass = 'rounded-md border border-border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40'
const number = (value: number) => Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 12 }) : 'Unavailable'
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded'
const fees = (values: Record<string, number>) => Object.entries(values).map(([currency, value]) => `${number(value)} ${currency}`).join(', ') || 'None recorded'
function EnvironmentBadge({ environment, broker }: { environment: Environment; broker?: BrokerName }) {
  const test = broker === 'mt5' ? 'DEMO · test funds' : 'TESTNET · test funds'
  return <span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${environment === 'live' ? 'bg-red-500/10 text-red-600' : 'bg-blue-500/10 text-blue-600'}`}>{environment === 'live' ? 'LIVE · real funds' : test}</span>
}
function BridgeStatus({ bridge, now }: { bridge: Bridge | undefined; now: number }) {
  const beat = Date.parse(bridge?.heartbeat_at ?? '')
  const fresh = Number.isFinite(beat) && now - beat <= 10000
  if (!bridge || !Number.isFinite(beat)) return <p className="mt-2 text-xs text-amber-600">MT5 bridge has not connected yet. Install the token in the terminal and attach the AutotradeX Bridge EA.</p>
  return <div className="mt-2 space-y-1 text-xs text-muted-foreground">
    <p><span className={fresh ? 'text-green-600' : 'text-amber-600'}>{fresh ? '● Bridge online' : '● Bridge offline'}</span> · last report {time(bridge.heartbeat_at)}</p>
    <p>{bridge.company ?? 'Broker'} · {bridge.server} · login {bridge.login} · {bridge.trade_mode} · {bridge.margin_mode} · 1:{bridge.leverage}</p>
    <p>Balance {number(bridge.balance ?? NaN)} · Equity {number(bridge.equity ?? NaN)} · Free margin {number(bridge.margin_free ?? NaN)} {bridge.currency}</p>
    {!bridge.connected && <p className="text-amber-600">Terminal is not connected to the broker server.</p>}
    {!bridge.trade_allowed && <p className="text-amber-600">Algo Trading is off in the terminal or not permitted for this account.</p>}
    {bridge.untracked_positions > 0 && <p className="text-red-600">{bridge.untracked_positions} open position(s) carry the bridge&apos;s magic number but are not in the ledger. New entries are blocked until reviewed.</p>}
    {bridge.last_error && <p className="text-red-600">{bridge.last_error}</p>}
  </div>
}

export function BrokerWorkspace({ view, onRunChange }: { view: 'credentials' | 'control' | 'ledger'; onRunChange?:(symbol:string|null)=>void }) {
  const apiSettings = view === 'credentials'
  const [data, setData] = useState<AutomationData | null>(null)
  const [loading, setLoading] = useState(!DEMO), [busy, setBusy] = useState('')
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now())
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [accountId, setAccountId] = useState(''), [drift, setDrift] = useState(50), [acknowledged, setAcknowledged] = useState(false)
  const [runSymbol,setRunSymbol]=useState(''),[runTimeframe,setRunTimeframe]=useState('')
  const [ledgerEnvironment, setLedgerEnvironment] = useState<Environment>('live')
  const [broker, setBroker] = useState<BrokerName>('binance'), [platform, setPlatform] = useState<'XM' | 'Vantage' | 'Other'>('XM'), [issuedToken, setIssuedToken] = useState<{ label: string; token: string } | null>(null), [environment, setEnvironment] = useState<Environment>('testnet')
  const [label, setLabel] = useState('Binance Spot testnet'), [credentials, setCredentials] = useState(EMPTY_CREDENTIALS)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const pending = useRef(false), draftChanged = useRef(false), mounted = useRef(true), revision = useRef(0), mutating = useRef(false)

  const refresh = useCallback(async (force = false) => {
    if (DEMO || mutating.current || (pending.current && !force)) return
    const version = ++revision.current
    pending.current = true
    try {
      const response = await fetch('/api/automation', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.data) throw new Error(json.error ?? 'AUTOMATION_UNAVAILABLE')
      if (!mounted.current || version !== revision.current) return
      const next = json.data as AutomationData
      setData(next); setCheckedAt(new Date().toISOString()); setLoadError('')
      if (!draftChanged.current || next.settings.auto_enabled) {
        setAccountId(next.settings.account_id ?? next.accounts[0]?.id ?? '')
        setDrift(next.settings.max_price_drift_bps)
        setRunSymbol(next.configuration?.screener_symbols[0]??'')
        setRunTimeframe(next.configuration?.screener_timeframe??'')
      }
    } catch (cause) {
      if (mounted.current && version === revision.current) setLoadError(cause instanceof Error ? cause.message : 'AUTOMATION_UNAVAILABLE')
    } finally { if (version === revision.current) { pending.current = false; if (mounted.current) setLoading(false) } }
  }, [])

  useEffect(() => {
    mounted.current = true
    if (!DEMO) void refresh()
    const timer = setInterval(() => { setNow(Date.now()); void refresh() }, 5000)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [refresh])

  const selected = data?.accounts.find(account => account.id === accountId)
  const ledgerExecutions = data?.executions.filter(e => e.environment === ledgerEnvironment) ?? []
  const activeExecutions = !!data?.executions.some(execution => !['CLOSED', 'REJECTED'].includes(execution.state))
  const heartbeat = Date.parse(data?.worker?.heartbeat_at ?? '')
  const freshWorker = !loadError && Number.isFinite(heartbeat) && now - heartbeat <= 15000 && now - heartbeat >= -5000
  const environmentEnabled = !!selected && !!data?.gates[selected.environment] && !!data?.worker?.enabled_environments.includes(selected.environment)
  const strategyReady = !!data?.configuration && !data.configuration.kill_switch_active && !!runTimeframe && !!selected && (selected.broker==='binance'?/^BINANCE:[A-Z0-9]+USDT$/.test(runSymbol):selected.broker==='mt5'?MT5_SYMBOL.test(runSymbol)&&!/^(NSE|BSE|BINANCE):/.test(runSymbol):/^(NSE|BSE):[A-Z0-9&.-]+-EQ$/.test(runSymbol))
  const running = !!data?.settings.auto_enabled
  useEffect(()=>{onRunChange?.(running?data?.configuration?.screener_symbols[0]??null:null)},[running,data?.configuration?.screener_symbols[0],onRunChange])
  const canEnable = strategyReady && !!selected?.connected && freshWorker && environmentEnabled && !data?.worker?.last_error && !loadError && (running || !activeExecutions)
  const changeDraft = () => { draftChanged.current = true; setAcknowledged(false); setMessage('') }

  async function post(action: string, payload: Record<string, unknown>, success: string): Promise<{ data?: Record<string, unknown> } | false> {
    if (DEMO || mutating.current) return false
    mutating.current = true; revision.current += 1
    setBusy(action); setError(''); setMessage('')
    try {
      const response = await fetch('/api/automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? json.code ?? 'AUTOMATION_REQUEST_FAILED')
      setMessage(success)
      if ((action === 'configure' || action === 'stop')) { draftChanged.current = false; setAcknowledged(false) }
      mutating.current = false
      await refresh(true)
      return json
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'AUTOMATION_REQUEST_FAILED'); return false }
    finally { mutating.current = false; setBusy('') }
  }
  function replaceCredentials(account: Account) {
    setEditingAccountId(account.id); setBroker(account.broker); setEnvironment(account.environment)
    setLabel(account.label); setCredentials(EMPTY_CREDENTIALS); setError(''); setMessage('')
    document.getElementById('broker-credentials')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function cancelReplacement() {
    setEditingAccountId(null); setBroker('binance'); setEnvironment('testnet')
    setLabel(DEFAULT_LABEL.binance); setCredentials(EMPTY_CREDENTIALS)
  }
  async function rotateToken(account: Account) {
    if (!window.confirm(`Issue a new bridge token for ${account.label}? The current token stops working and automatic entries for this account are stopped.`)) return
    const result = await post('bridge_token', { account_id: account.id }, 'New bridge token issued. Install it in the terminal; it is shown once.')
    const token = result && typeof result.data?.bridge_token === 'string' ? result.data.bridge_token : null
    if (token) setIssuedToken({ label: account.label, token })
  }
  async function connect(event: React.FormEvent) {
    event.preventDefault()
    const secretFields = broker === 'mt5' ? { platform } : broker === 'binance' ? { apiKey: credentials.apiKey, apiSecret: credentials.apiSecret } : {
      apiKey: credentials.apiKey, password: credentials.password, totpSecret: credentials.totpSecret,
      clientCode: credentials.clientCode, localIp: credentials.localIp, publicIp: credentials.publicIp,
    }
    try {
      const completed = await post('connect', { broker, environment, label: label.trim(), credentials: secretFields, ...(editingAccountId ? { account_id: editingAccountId } : {}) }, editingAccountId ? 'Credentials replaced and verified for this saved account. Automatic entries remain disabled; explicitly enable them when ready.' : 'Connection request completed. Check the saved account verification status below.')
      const token = completed && typeof completed.data?.bridge_token === 'string' ? completed.data.bridge_token : null
      if (token) setIssuedToken({ label: label.trim(), token })
      if (completed && editingAccountId) cancelReplacement()
    } finally {
      setCredentials(EMPTY_CREDENTIALS)
      if (editingAccountId) { draftChanged.current = false; setAcknowledged(false); await refresh() }
    }
  }
  async function configure() {
    if (!canEnable || !acknowledged) { setError('A verified account, fresh worker, enabled environment, and acknowledgement are required.'); return }
    if (!Number.isFinite(drift) || drift < 1 || drift > 500) { setError('Price drift must be between 1 and 500 basis points.'); return }
    await post('configure', { account_id: accountId, auto_enabled: true, max_price_drift_bps: drift, symbol:runSymbol, timeframe:runTimeframe, acknowledgement: 'ENABLE_BROKER_AUTOMATION' }, 'Automatic broker trading started. Orders require qualified signals and all entry checks to pass.')
  }

  return <div className="mx-auto flex max-w-6xl flex-col gap-6">
    {view !== 'control' && <header><p className="text-xs font-semibold uppercase tracking-widest text-blue-500">AutotradeX</p><h1 className="mt-1 text-2xl font-bold">{apiSettings ? 'Broker API Settings' : 'Broker Orders'}</h1><p className="mt-2 text-sm text-muted-foreground">{apiSettings ? 'Connect and verify credentials. Connecting a broker does not start trading.' : 'Actual broker order states, confirmed fills and position protection. Paper simulations are on their own page.'}</p><Link href="/dashboard" className="mt-3 inline-block text-sm underline">Open live trading controls</Link></header>}
    {DEMO && <p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm">Read-only demo. Broker connections, automation, and execution history become available after signing in outside demo mode. No account or broker acceptance is simulated here.</p>}
    {loading && <p className="text-sm text-muted-foreground">Loading broker automation…</p>}
    {apiSettings && !loading && data && !data.accounts.some(account => account.connected) && <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5" aria-labelledby="connect-broker-notice"><h2 id="connect-broker-notice" className="font-semibold">Connect broker credentials to begin</h2><p className="mt-2 text-sm text-muted-foreground">No verified execution account is available. Add your Binance or Angel One credentials in Broker API Settings. Automatic orders require verified credentials, your explicit enable action, and a running execution worker. Credentials can be added later through these dashboard API settings.</p><a href={apiSettings ? "#broker-credentials" : "/broker"} className="mt-3 inline-block rounded-md border border-border bg-background px-3 py-2 text-sm">Connect a broker</a></section>}
    {(loadError || error) && <div role="alert" className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">{loadError && <p>Refresh failed: {loadError}. Displayed data may be stale.</p>}{error && <p>{error}</p>}<button type="button" className="underline" onClick={() => void refresh()}>Retry refresh</button></div>}
    {message && <p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm">{message}</p>}

    {apiSettings && <section id="broker-credentials" className="scroll-mt-5 rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">{editingAccountId ? 'Replace saved broker credentials' : 'Broker API credentials'}</h2>
      <p className="mt-2 text-sm text-muted-foreground">Binance defaults to Spot testnet. Angel One uses live cash-equity execution. MetaTrader 5 (XM, Vantage) connects through a bridge in a server-hosted terminal, demo or real. Enter credentials directly in this dashboard; no locally configured broker keys are needed. Connecting an account does not enable automatic entries.</p>
      {editingAccountId && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">Replacing credentials preserves this account and its execution history. The broker and environment stay fixed. New automatic entries are disabled before replacement; all existing executions must be closed or rejected. Failed verification keeps the old credentials and requires a connection recheck.</p>}
      <form onSubmit={connect} autoComplete="off" className="mt-4">
        <fieldset disabled={DEMO || !!busy} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">Broker<select disabled={!!editingAccountId} className={inputClass} value={broker} onChange={event => { const value = event.target.value as BrokerName; setBroker(value); setEnvironment(value === 'angelone' ? 'live' : 'testnet'); setLabel(DEFAULT_LABEL[value]); setCredentials(EMPTY_CREDENTIALS) }}><option value="binance">Binance Spot</option><option value="angelone">Angel One</option><option value="mt5">MetaTrader 5 (XM, Vantage)</option></select></label>
          <label className="text-sm">Environment<select disabled={!!editingAccountId} className={inputClass} value={environment} onChange={event => setEnvironment(event.target.value as Environment)}>{broker === 'binance' && <option value="testnet">Testnet — test funds</option>}{broker === 'mt5' && <option value="testnet">Demo account — test funds</option>}<option value="live">{broker === 'mt5' ? 'Real account — real funds' : 'Live — real funds'}</option></select></label>
          <label className="text-sm">Account label<input className={inputClass} value={label} maxLength={80} required onChange={event => setLabel(event.target.value)} /></label>
          {broker === 'mt5' && <label className="text-sm">Broker platform<select className={inputClass} value={platform} onChange={event => { const value = event.target.value as 'XM' | 'Vantage' | 'Other'; setPlatform(value); setLabel(`${value === 'Other' ? 'MT5' : value} MT5 ${environment === 'live' ? 'real' : 'demo'}`) }}><option value="XM">XM</option><option value="Vantage">Vantage</option><option value="Other">Other MT5 broker</option></select></label>}
          {broker !== 'mt5' && <label className="text-sm">API key<input className={inputClass} type="password" autoComplete="new-password" value={credentials.apiKey} required onChange={event => setCredentials({ ...credentials, apiKey: event.target.value })} /></label>}
          {broker !== 'mt5' && (broker === 'binance' ? [{ key: 'apiSecret', label: 'API secret', secret: true }] : [
            { key: 'clientCode', label: 'Client code', secret: false }, { key: 'password', label: 'Password / PIN', secret: true }, { key: 'totpSecret', label: 'TOTP secret', secret: true }, { key: 'localIp', label: 'Configured local IP', secret: false }, { key: 'publicIp', label: 'Configured public IP', secret: false },
          ]).map(field => <label key={field.key} className="text-sm">{field.label}<input className={inputClass} type={field.secret ? 'password' : 'text'} autoComplete={field.secret ? 'new-password' : 'off'} required value={credentials[field.key as keyof typeof credentials]} onChange={event => setCredentials({ ...credentials, [field.key]: event.target.value })} /></label>)}
          {broker === 'mt5' && <p className="text-xs text-muted-foreground md:col-span-2">MT5 has no API keys. Your MT5 login and password are entered only inside the MetaTrader terminal on the AutotradeX server and are never stored here. Saving issues a one-time bridge token for that terminal&apos;s AutotradeX Bridge Expert Advisor.</p>}
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-3"><EnvironmentBadge environment={environment} broker={broker} /><button disabled={DEMO || !!busy || !label.trim()} className={buttonClass} type="submit">{busy === 'connect' ? 'Verifying…' : editingAccountId ? 'Replace and verify credentials' : 'Connect and verify'}</button>{editingAccountId && <button type="button" disabled={!!busy} onClick={cancelReplacement} className={buttonClass}>Cancel replacement</button>}</div>
        <p className="mt-2 text-xs text-muted-foreground">Use keys for the selected environment. Credential fields clear after the request and are never included in the account listing.</p>
      </form>
      {issuedToken && <div role="status" className="mt-4 rounded-lg border border-green-500/30 bg-green-500/5 p-4 text-sm"><p className="font-semibold">Bridge token for {issuedToken.label}</p><p className="mt-1 text-xs text-muted-foreground">Shown once. Install it as MQL5/Files/autotradex_token.txt in this account&apos;s MT5 terminal. Anyone holding it can act as this account&apos;s bridge, so keep it private.</p><div className="mt-3 flex flex-wrap items-center gap-2"><code className="break-all rounded bg-background px-2 py-1 text-xs">{issuedToken.token}</code><button type="button" className={buttonClass} onClick={() => void navigator.clipboard?.writeText(issuedToken.token)}>Copy</button><button type="button" className={buttonClass} onClick={() => setIssuedToken(null)}>I have saved it</button></div></div>}
      {activeExecutions && <p className="mt-4 text-xs text-muted-foreground">Credential replacement is unavailable while any execution is active or needs attention. Resolve those executions first so their broker access stays intact.</p>}
      <div className="mt-5 space-y-3">{data?.accounts.map(account => <div key={account.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{account.label}</strong><EnvironmentBadge environment={account.environment} broker={account.broker} /></div><p className="mt-2 text-xs text-muted-foreground">{account.broker === 'mt5' ? 'MetaTrader 5' : account.broker} · {account.connected ? 'Verified connection' : 'Connection not verified'} · Checked {time(account.last_checked_at)}</p>{account.error && <p className="mt-2 text-xs text-red-600">{account.error}</p>}{account.broker === 'mt5' && <BridgeStatus bridge={data.bridges?.find(b => b.account_id === account.id)} now={now} />}</div><div className="flex flex-wrap gap-2"><button disabled={DEMO || !!busy} className={buttonClass} onClick={() => void post('verify', { account_id: account.id }, 'Verification request completed. Review the latest connection status.')}>Verify connection</button>{account.broker === 'mt5' ? <button disabled={DEMO || !!busy || activeExecutions} title={activeExecutions ? 'Close all active executions before rotating the token' : 'Issue a new bridge token for this terminal'} className={buttonClass} onClick={() => void rotateToken(account)}>New bridge token</button> : <button disabled={DEMO || !!busy || activeExecutions} title={activeExecutions ? 'Close all active executions before replacing credentials' : 'Replace credentials while retaining this account history'} className={buttonClass} onClick={() => replaceCredentials(account)}>Replace credentials</button>}</div></div>)}{data && !data.accounts.length && <p className="text-sm text-muted-foreground">No execution accounts connected.</p>}</div>
    </section>}

    {view === 'control' && <section aria-label="Broker trading controls" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{selected?.environment === 'testnet' ? 'Testnet trading' : 'Live trading'}</h2><span role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${running && canEnable ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>{loadError || !data ? 'Status unavailable' : running ? canEnable ? 'ON · waiting for qualified signals' : 'ON · entry checks blocked' : 'OFF · new automatic entries stopped'}</span></div>
      <p className="mt-2 text-sm text-muted-foreground">Start authorizes automatic orders for the selected broker account. Stop prevents new automatic entries; existing orders and positions continue reconciliation and protection.</p>
      <fieldset disabled={DEMO || loading || !!busy || running || !data} className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm">Execution account<select className={inputClass} value={accountId} onChange={event => { setAccountId(event.target.value); changeDraft() }}><option value="">Select a connected account</option>{data?.accounts.map(account => <option key={account.id} value={account.id}>{account.label} · {account.environment.toUpperCase()}</option>)}</select></label>
        <label className="text-sm">Trading symbol<input className={inputClass} placeholder={selected?.broker==='angelone'?'NSE:RELIANCE-EQ':selected?.broker==='mt5'?'OANDA:EURUSD':'BINANCE:BTCUSDT'} value={runSymbol} onChange={event=>{setRunSymbol(event.target.value.trim().toUpperCase());changeDraft()}}/><span className="mt-1 block text-xs text-muted-foreground">This symbol is locked until you stop trading.</span></label>
        <label className="text-sm">Candle timeframe<select className={inputClass} value={runTimeframe} onChange={event=>{setRunTimeframe(event.target.value);changeDraft()}}><option value="">Select timeframe</option><option value="1m">1 minute</option><option value="5m">5 minutes</option><option value="15m">15 minutes</option><option value="1h">1 hour</option></select></label>
        <label className="text-sm">Maximum entry price drift (basis points)<input className={inputClass} type="number" min={1} max={500} step={1} value={Number.isNaN(drift) ? '' : drift} onChange={event => { setDrift(event.target.valueAsNumber); changeDraft() }} /><span className="mt-1 block text-xs text-muted-foreground">100 basis points = 1% from the signal price.</span></label>
        {!running && selected && <label className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm md:col-span-2"><input className="mt-1" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I authorize automatic orders in this {selected.environment === 'live' ? 'LIVE account using real money' : 'TESTNET account using test funds'} for {runSymbol || 'the selected symbol'} on {runTimeframe || 'the selected timeframe'} when strategy and risk checks pass.</span></label>}
      </fieldset>
      {selected && <div className="mt-4"><EnvironmentBadge environment={selected.environment} /></div>}
      {!canEnable && <p className="mt-3 text-sm text-amber-600">{!selected?.connected ? 'Connect and verify a broker account to start trading.' : activeExecutions && !running ? 'Resolve existing broker positions before starting a new run.' : !strategyReady ? 'Select a compatible trading symbol and timeframe. Release any global entry pause in Risk.' : !environmentEnabled ? 'This environment is disabled on the server or execution worker.' : 'The execution worker must be healthy and report a heartbeat within 15 seconds.'}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button size="lg" disabled={DEMO || loading || !!busy || running || !canEnable || !acknowledged} onClick={() => void configure()}>{busy === 'configure' ? 'Starting…' : selected?.environment === 'testnet' ? 'Start testnet trading' : 'Start live trading'}</Button>
        <Button size="lg" variant="destructive" disabled={DEMO || !!busy || (!!data && !running && !loadError)} onClick={() => void post('stop', {}, 'Automatic broker entries stopped. Existing positions remain monitored.')}>{busy === 'stop' ? 'Stopping…' : selected?.environment === 'testnet' ? 'Stop testnet trading' : 'Stop live trading'}</Button>
        <Button asChild variant="outline" size="lg"><Link href="/broker">Broker API Settings</Link></Button>
        <Button asChild variant="outline" size="lg"><Link href="/automation">View broker orders</Link></Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Last started: {time(data?.settings.started_at ?? null)} · Last stopped: {time(data?.settings.stopped_at ?? null)}. Switching account requires stopping first. Starting does not force a trade.</p>
      <p className="mt-2 text-xs text-muted-foreground">Broker watchlist: {data?.configuration?.screener_symbols.join(', ') || 'Not configured'} · Session: {data?.configuration ? `${sessionLabel(data.configuration.session_start, data.configuration.session_end)} (${data.configuration.session_timezone})` : 'Unavailable'}. <Link href="/screener" className="underline">Edit strategy and watchlist</Link>.</p>
      <p className="mt-2 text-xs text-muted-foreground">Binance Spot scans long setups and places a broker stop/target OCO. Angel One requires TradingView alerts and a continuous execution worker. The worker continues while this page is closed.</p>
    </section>}

    {view === 'control' && <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold">Active broker positions and orders</h2>
      <p className="mt-2 text-xs text-muted-foreground">Selected account · recent 100 execution records. Full details and close controls are in <Link href="/automation" className="underline">Broker Orders</Link>.</p>
      {!data || loadError ? <p className="mt-3 text-sm text-muted-foreground">{loading ? 'Loading broker positions…' : 'Broker positions unavailable.'}</p> : !data.executions.some(e=>e.broker_account_id===accountId && !['CLOSED','REJECTED'].includes(e.state)) ? <p className="mt-3 text-sm text-muted-foreground">No active executions in the loaded records for this account.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2">{data.executions.filter(e=>e.broker_account_id===accountId && !['CLOSED','REJECTED'].includes(e.state)).map(e=><div key={e.id} className="rounded-xl border border-border p-4"><p className="font-semibold">{e.symbol} · {e.direction}</p><p className="mt-2 text-sm">{e.environment.toUpperCase()} · {e.state}</p><p className="mt-2 text-xs text-muted-foreground">Filled {number(e.entry_quantity)} · Remaining {number(e.residual_quantity)} · Stop {number(e.stop_loss)} / Target {number(e.take_profit)} {e.currency}</p>{e.error && <p className="mt-2 text-xs text-destructive">{e.error}</p>}</div>)}</div>}
    </section>}

    {view === 'control' && <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Execution worker</h2><span className={`rounded px-2 py-1 text-xs ${freshWorker && !data?.worker?.last_error ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'}`}>{loading ? 'Loading worker status…' : loadError ? 'Worker status unavailable' : DEMO ? 'Not connected in demo' : !freshWorker ? 'Heartbeat missing or stale' : data?.worker?.last_error ? 'Worker reported an error' : 'Heartbeat current'}</span></div>
      <p className="mt-3 text-xs text-muted-foreground">Last heartbeat: {time(data?.worker?.heartbeat_at ?? null)}. Data checked: {time(checkedAt)}. Enabling new entries requires a heartbeat within 15 seconds. This page refreshes every five seconds.</p>
      <p className="mt-2 text-xs text-muted-foreground">Environment gates: testnet {loadError || !data ? 'unknown' : data.gates.testnet ? 'enabled' : 'disabled'} · live {loadError || !data ? 'unknown' : data.gates.live ? 'enabled' : 'disabled'}. Worker environments: {data?.worker?.enabled_environments.join(', ') || 'none reported'}.</p>
      {data?.worker?.last_error && <p role="alert" className="mt-3 text-sm text-red-600">{data.worker.last_error}</p>}
    </section>}

    {view === 'ledger' && <section className="space-y-4">
      <div><h2 className="text-lg font-semibold">Broker execution ledger</h2><p className="mt-1 text-sm text-muted-foreground">Accepted requests are not fill confirmations. Amounts retain their original currencies.</p></div>
      <label className="block text-sm">Order environment<select className="ml-3 rounded-lg border border-border bg-background px-3 py-2" value={ledgerEnvironment} onChange={e=>setLedgerEnvironment(e.target.value as Environment)}><option value="live">Live · real funds</option><option value="testnet">Testnet · test funds</option></select></label>
      {data && !ledgerExecutions.length && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No {ledgerEnvironment} broker executions recorded.</div>}
      {ledgerExecutions.map(execution => {
        const executionBroker = data?.accounts.find(account => account.id === execution.broker_account_id)?.broker
        const feesAvailable = executionBroker === 'binance'
        return <article key={execution.id} className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{execution.symbol} · {execution.direction}</h3><EnvironmentBadge environment={execution.environment} /><span className={`rounded px-2 py-1 text-xs ${execution.state === 'ATTENTION' || execution.state === 'REJECTED' ? 'bg-red-500/10 text-red-600' : 'bg-muted text-muted-foreground'}`}>{execution.state}</span></div><p className="mt-2 text-xs text-muted-foreground">Opened {time(execution.created_at)} · Updated {time(execution.updated_at)}</p></div>{!['CLOSED', 'REJECTED'].includes(execution.state) && <button disabled={DEMO || !!busy || execution.closing_requested} className={buttonClass} onClick={() => void post('close', { execution_id: execution.id }, 'Close requested. The worker will reconcile existing orders and fills; follow the ledger for completion.')}>{execution.closing_requested ? 'Close requested' : 'Request close'}</button>}</div>
        {execution.error && <p role="alert" className="mt-3 rounded-md bg-red-500/10 p-3 text-sm text-red-600">{execution.error}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          {[
            ['Requested quantity', number(execution.requested_quantity)], ['Entry filled / average', `${number(execution.entry_quantity)} / ${execution.entry_quantity > 0 ? number(execution.entry_price) + ' ' + execution.currency : 'No fill yet'}`],
            ['Exit filled / average', `${number(execution.exit_quantity)} / ${execution.exit_quantity > 0 ? number(execution.exit_price) + ' ' + execution.currency : 'No fill yet'}`], ['Residual quantity', number(execution.residual_quantity)],
            ['Gross PnL (before fees)', `${number(execution.gross_pnl)} ${execution.currency}`], ['Quote fees', feesAvailable ? `${number(execution.quote_fees)} ${execution.currency}` : 'Unknown — not reported'],
            ['Other-asset fees', feesAvailable ? fees(execution.other_fees) : 'Unknown — not reported'], ['Stop / target', `${number(execution.stop_loss)} / ${number(execution.take_profit)} ${execution.currency}`],
            ['Close reason', execution.close_reason ?? 'Not closed'], ['Holding deadline', time(execution.deadline_at)],
          ].map(([title, value]) => <div key={title}><dt className="text-xs text-muted-foreground">{title}</dt><dd className="mt-1 break-words font-mono text-xs">{value}</dd></div>)}
        </dl>
        {!feesAvailable && <p className="mt-4 text-xs text-amber-600">{executionBroker === 'angelone' ? 'Angel One fees and taxes are not available in this ledger. ' : 'Fee data is unavailable for this execution account. '}Reported PnL is gross only; zero stored fee values must not be interpreted as free trading.</p>}
        <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-sm">Order intents and confirmed fills ({execution.intents.length})</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground">{['Purpose / side', 'Permanent client ID', 'Submission / broker state', 'Filled / requested', 'Average fill', 'Fees', 'Broker order ID'].map(title => <th className="whitespace-nowrap px-2 py-2 font-medium" key={title}>{title}</th>)}</tr></thead><tbody>{execution.intents.map(intent => <tr key={intent.clientId} className="border-b border-border/50"><td className="whitespace-nowrap px-2 py-3">{intent.purpose} · {intent.side}</td><td className="px-2 py-3 font-mono">{intent.clientId}</td><td className="whitespace-nowrap px-2 py-3">{intent.state} / {intent.snapshot?.state ?? 'Awaiting reconciliation'}</td><td className="whitespace-nowrap px-2 py-3">{intent.snapshot ? number(intent.snapshot.filled) : 'Unconfirmed'} / {number(intent.quantity)}</td><td className="whitespace-nowrap px-2 py-3">{intent.snapshot?.filled ? `${number(intent.snapshot.averagePrice)} ${execution.currency}` : '—'}</td><td className="min-w-48 px-2 py-3">{!feesAvailable ? 'Unknown — PnL is gross only' : intent.snapshot ? <>{number(intent.snapshot.quoteFee)} {execution.currency} · {number(intent.snapshot.baseFee)} base units<div className="mt-1 text-muted-foreground">Other: {fees(intent.snapshot.otherFees)}</div></> : 'Unconfirmed'}</td><td className="px-2 py-3 font-mono">{intent.snapshot?.orderId ?? intent.orderId ?? 'Not acknowledged'}</td></tr>)}</tbody></table></div><p className="mt-3 break-all font-mono text-[10px] text-muted-foreground">Execution ID: {execution.id}</p></details>
      </article>})}
    </section>}
  </div>
}
