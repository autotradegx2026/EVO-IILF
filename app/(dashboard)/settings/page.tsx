'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'
import type { Settings } from '@/types/database'

type SettingsForm = Omit<Settings, 'id' | 'user_id' | 'updated_at'>

function toForm(s: Settings): SettingsForm {
  return {
    adx_length: s.adx_length ?? 14, atr_length: s.atr_length ?? 14, delta_length: s.delta_length ?? 14, swing_lookback: s.swing_lookback ?? 10, session_timezone: s.session_timezone ?? 'Asia/Kolkata',
    trend_ema_length:     s.trend_ema_length,
    fast_ema_length:      s.fast_ema_length,
    htf_ema_length:       s.htf_ema_length,
    htf_timeframe:        s.htf_timeframe,
    adx_threshold:        s.adx_threshold,
    volume_multiplier:    s.volume_multiplier,
    atr_multiplier:       s.atr_multiplier,
    min_confluence_score: s.min_confluence_score,
    risk_percent:         s.risk_percent,
    rr_ratio:             s.rr_ratio,
    cooldown_bars:        s.cooldown_bars,
    max_trades_per_day:   s.max_trades_per_day,
    max_daily_loss_pct:   s.max_daily_loss_pct,
    vwap_enabled:         s.vwap_enabled,
    delta_enabled:        s.delta_enabled,
    fvg_enabled:          s.fvg_enabled,
    ob_enabled:           s.ob_enabled,
    session_start:        s.session_start,
    session_end:          s.session_end,
    webhook_secret:       s.webhook_secret,
    kill_switch_active:   s.kill_switch_active,
  }
}

export default function SettingsPage() {
  const [form, setForm]         = useState<SettingsForm | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [appOrigin, setAppOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL ?? '')
  const [userId, setUserId]     = useState<string | null>(null)

  useEffect(() => {
    setAppOrigin(window.location.origin)
    const supabase = createClient()
    void (async () => {
      try {
        const { data, error: authError } = await supabase.auth.getUser()
        if (authError || !data.user) throw new Error('Sign in to load your settings.')
        setUserId(data.user.id)
        const { data: settings, error: settingsError } = await supabase.from('settings').select('*').eq('user_id', data.user.id).single()
        if (settingsError || !settings) throw new Error('Your saved settings could not be loaded. Please retry.')
        setForm(toForm(settings as Settings))
        setSavedAt(settings.updated_at)
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Settings unavailable.') }
      finally { setLoading(false) }
    })()
  }, [])

  function set<K extends keyof SettingsForm>(key: K, val: SettingsForm[K]) {
    setDirty(true)
    setForm(prev => prev ? ({ ...prev, [key]: val }) : prev)
  }

  async function handleSave() {
    if (!userId || !form) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Save failed')
      } else {
        setForm(toForm(json.data))
        setSavedAt(json.data.updated_at)
        setDirty(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading settings…</div>
      </div>
    )
  }

  if (!form) return <div role="alert" className="rounded-2xl border border-border bg-card p-6"><p>{error ?? 'Saved settings unavailable.'}</p><button className="mt-3 underline" onClick={() => window.location.reload()}>Retry loading settings</button></div>

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Strategy Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure AutotradeX strategy parameters</p>
          <p className="mt-1 text-xs text-muted-foreground">{dirty ? 'Unsaved changes · ' : 'Saved configuration · '}Last saved: {savedAt ? new Date(savedAt).toLocaleString() : 'Not recorded'}. Form values apply only after saving.</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-xs text-green-400 font-medium">Saved ✓</span>
          )}
          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* EMA Parameters */}
      <Section title="EMA Parameters">
        <Row label="Trend EMA Length" hint="Primary trend filter">
          <NumInput value={form.trend_ema_length} min={5} max={500} onChange={v => set('trend_ema_length', v)} />
        </Row>
        <Row label="Fast EMA Length" hint="Entry timing">
          <NumInput value={form.fast_ema_length} min={3} max={200} onChange={v => set('fast_ema_length', v)} />
        </Row>
        <Row label="HTF EMA Length" hint="Higher timeframe bias">
          <NumInput value={form.htf_ema_length} min={20} max={1000} onChange={v => set('htf_ema_length', v)} />
        </Row>
        <Row label="HTF Timeframe">
          <select
            value={form.htf_timeframe}
            onChange={e => set('htf_timeframe', e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {['1H','2H','4H','1D','1W'].map(tf => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </Row>
      </Section>

      {/* Signal Filters */}
      <Section title="Signal Filters">
        <Row label="ADX Threshold" hint="Min trend strength (14–60)">
          <NumInput value={form.adx_threshold} min={10} max={60} onChange={v => set('adx_threshold', v)} />
        </Row>
        <Row label="Volume Multiplier" hint="Multiplier above avg volume">
          <NumInput value={form.volume_multiplier} min={0.5} max={5} step={0.1} onChange={v => set('volume_multiplier', v)} />
        </Row>
        <Row label="ATR Multiplier" hint="SL/TP distance in ATR units">
          <NumInput value={form.atr_multiplier} min={0.5} max={5} step={0.1} onChange={v => set('atr_multiplier', v)} />
        </Row>
        <Row label="Min Confluence Score" hint="0–7 factors required">
          <NumInput value={form.min_confluence_score} min={1} max={7} onChange={v => set('min_confluence_score', v)} />
        </Row>
      </Section>

      {/* Account & Security */}
      {(
        <Section title="Account & Security">
          <ChangePassword />
        </Section>
      )}

      {/* Confluence Toggles */}
      <Section title="Confluence Factors">
        <Row label="VWAP Filter">
          <Toggle checked={form.vwap_enabled} onChange={v => set('vwap_enabled', v)} />
        </Row>
        <Row label="Delta Filter">
          <Toggle checked={form.delta_enabled} onChange={v => set('delta_enabled', v)} />
        </Row>
        <Row label="Fair Value Gap (FVG)">
          <Toggle checked={form.fvg_enabled} onChange={v => set('fvg_enabled', v)} />
        </Row>
        <Row label="Order Block (OB)">
          <Toggle checked={form.ob_enabled} onChange={v => set('ob_enabled', v)} />
        </Row>
      </Section>

      {/* Risk Parameters */}
      <Section title="Risk Management">
        <Row label="Risk Per Trade (%)" hint="% of account risked per trade">
          <NumInput value={form.risk_percent} min={0.1} max={10} step={0.1} onChange={v => set('risk_percent', v)} />
        </Row>
        <Row label="Reward:Risk Ratio" hint="Minimum R:R to qualify signal">
          <NumInput value={form.rr_ratio} min={0.5} max={10} step={0.5} onChange={v => set('rr_ratio', v)} />
        </Row>
        <Row label="Max Trades Per Day">
          <NumInput value={form.max_trades_per_day} min={1} max={20} onChange={v => set('max_trades_per_day', v)} />
        </Row>
        <Row label="Max Daily Loss (%)" hint="Lock trading after this daily loss">
          <NumInput value={form.max_daily_loss_pct} min={0.5} max={20} step={0.5} onChange={v => set('max_daily_loss_pct', v)} />
        </Row>
        <Row label="Cooldown Bars" hint="Bars to wait after a trade">
          <NumInput value={form.cooldown_bars} min={0} max={100} onChange={v => set('cooldown_bars', v)} />
        </Row>
      </Section>

      {/* Session */}
      <Section title={`Trading Session (${form.session_timezone ?? 'Asia/Kolkata'})`}>
        <Row label="Session Start">
          <TimeInput value={form.session_start} onChange={v => set('session_start', v)} />
        </Row>
        <Row label="Session End">
          <TimeInput value={form.session_end} onChange={v => set('session_end', v)} />
        </Row>
      </Section>

      {/* Kill Switch */}
      <Section title="Controls">
        <Row label="Kill Switch" hint="Disable all executions globally">
          <Toggle checked={form.kill_switch_active ?? false} onChange={v => set('kill_switch_active', v)} />
        </Row>
      </Section>

      {/* Webhook */}
      <Section title="Webhook Configuration">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-foreground">Your Personalized Webhook URL</label>
            <div className="flex items-center gap-2">
              <input 
                readOnly
                value={userId ? `${appOrigin}/api/webhook?uid=${userId}` : 'Loading...'}
                className="bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono text-muted-foreground w-full select-all"
              />
              <button 
                onClick={() => {
                  if (userId) navigator.clipboard.writeText(`${appOrigin}/api/webhook?uid=${userId}`)
                }}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap"
              >
                Copy URL
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Configure your signing relay to forward signals to this URL. Qualified signals wait for your confirmation on the dashboard.
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <label className="text-sm font-semibold text-foreground">Your Paper Trading Webhook URL</label>
            <div className="flex items-center gap-2">
              <input 
                readOnly
                value={userId ? `${appOrigin}/api/webhook/paper?uid=${userId}` : 'Loading...'}
                className="bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono text-muted-foreground w-full select-all"
              />
              <button 
                onClick={() => {
                  if (userId) navigator.clipboard.writeText(`${appOrigin}/api/webhook/paper?uid=${userId}`)
                }}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap"
              >
                Copy URL
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Use this endpoint through your signing relay for simulated trades. Paper fills use the signal price and a simulated capital of ₹100,000.
            </p>
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-4">
            <label className="text-xs text-muted-foreground font-medium">Security: Webhook Secret (HMAC-SHA256)</label>
            <input
              type="password"
              value={form.webhook_secret ?? ''}
              onChange={e => set('webhook_secret', e.target.value || null)}
              placeholder="e.g. grindx_whk_..."
              className="bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary w-full max-w-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Required: configure at least 32 characters, then Save Settings. A trusted relay must sign the raw JSON with HMAC-SHA256 and send the X-Webhook-Signature header. TradingView’s alert form does not configure this signature.
            </p>
          </div>


        </div>
      </Section>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <div className="text-sm text-foreground">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function NumInput({
  value, min, max, step = 1, onChange,
}: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => {
        const v = parseFloat(e.target.value)
        if (!isNaN(v)) onChange(v)
      }}
      className="bg-background border border-border rounded-md px-3 py-1.5 text-sm w-24 text-right focus:outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value.slice(0, 5)}
      onChange={e => onChange(e.target.value)}
      className="bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

function ChangePassword() {
  const [loading, setLoading] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  async function handleUpdatePassword() {
    if (newPassword.length < 6) {
      setMessage({ text: 'Password must be at least 6 characters', type: 'error' })
      return
    }
    setLoading(true)
    setMessage(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    
    if (error) {
      setMessage({ text: error.message, type: 'error' })
    } else {
      setMessage({ text: 'Password updated successfully', type: 'success' })
      setNewPassword('')
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col gap-3 max-w-sm">
      <label className="text-xs text-muted-foreground font-medium">Update Password</label>
      <div className="flex gap-2">
        <input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-full"
        />
        <button
          disabled={loading || !newPassword}
          onClick={handleUpdatePassword}
          className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-4 py-2 rounded-md transition-colors disabled:opacity-50 shrink-0 flex items-center justify-center min-w-[80px]"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update'}
        </button>
      </div>
      {message && (
        <p className={`text-xs ${message.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
