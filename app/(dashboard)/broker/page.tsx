'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BrokerWorkspace } from '@/components/dashboard/broker-workspace'
import { createClient } from '@/lib/supabase/client'

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

/** Credentials and delivery endpoints only; trading controls live on the dashboard. */
export default function BrokerApiPage() {
  const [userId, setUserId] = useState(''), [origin, setOrigin] = useState('')
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => {
    setOrigin(window.location.origin)
    if (DEMO) return
    let active = true
    void createClient().auth.getUser().then(({ data, error: authError }) => {
      if (!active) return
      if (authError || !data.user) setError('Sign in to view your webhook endpoints.')
      else setUserId(data.user.id)
    }).catch(() => { if (active) setError('Could not verify your session for webhook access.') })
    return () => { active = false }
  }, [])
  const endpoint = (path: string) => userId && origin && !DEMO ? `${origin}${path}?uid=${encodeURIComponent(userId)}` : ''
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setError(''); setMessage('Webhook endpoint copied.') }
    catch { setError('Could not copy automatically. Select and copy the endpoint field.') }
  }
  const field = (label: string, path: string) => {
    const url = endpoint(path)
    return <label className="block text-sm" key={path}>{label}<span className="mt-2 flex gap-2"><input aria-label={label} readOnly value={url} placeholder={DEMO ? 'Unavailable in demo mode' : 'Sign in to view this endpoint'} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs" /><button type="button" disabled={!url} onClick={() => void copy(url)} className="rounded-md border border-border px-3 py-2 text-xs disabled:opacity-40">Copy</button></span></label>
  }
  return <div className="flex flex-col gap-6">
    <BrokerWorkspace view="credentials" />
    <section className="mx-auto w-full max-w-6xl rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">Webhook delivery settings</h2>
      <p className="mb-4 mt-2 text-sm text-muted-foreground">Use the TradingView endpoint with your private delivery token and confirmed-candle alerts. <Link href="/screener" className="underline">Create the token and configure your strategy in Strategy & Screener</Link>.</p>
      {field('TradingView candle and signal endpoint', '/api/webhook/tradingview')}
      <details className="mt-5 border-t border-border pt-4"><summary className="cursor-pointer text-sm">Existing HMAC signing integrations</summary><div className="mt-4 space-y-4">{field('Signed strategy signals', '/api/webhook')}{field('Signed paper entries', '/api/webhook/paper')}<p className="text-xs text-muted-foreground">These endpoints require the X-Webhook-Signature HMAC header from a signing relay. TradingView cannot generate that header directly. New setups should use the token-based TradingView endpoint above; paper exits require ongoing candle delivery.</p></div></details>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {message && <p role="status" className="mt-3 text-sm text-blue-600">{message}</p>}
    </section>
  </div>
}
