'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCurrentSignal, useRecentSignals } from '@/hooks/use-signal'
import { useActiveChart } from '@/hooks/use-active-chart'
import { BrokerWorkspace } from '@/components/dashboard/broker-workspace'
import { ChartSelector } from '@/components/dashboard/chart-selector'
import { StrategyAnalysis } from '@/components/dashboard/strategy-analysis'
import { TradeDetails } from '@/components/dashboard/trade-details'
import { RecentSignals } from '@/components/dashboard/recent-signals'
export default function DashboardPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const [userId, setUserId] = useState<string | undefined>()
  const [executing, setExecuting] = useState(false)
  const [execError, setExecError] = useState<string | null>(null)
  const [execSuccess, setExecSuccess] = useState<string | null>(null)
  const [brokerAccountId, setBrokerAccountId] = useState<string | null>(null)
  const [lockedSymbol,setLockedSymbol]=useState<string|null>(null)
  const { activeChart, setActiveChart, isLoaded } = useActiveChart()

  // Read only authenticated account records.
  const { signal: liveSignal, loading: signalLoading, error: signalError } = useCurrentSignal(userId, lockedSymbol??activeChart)
  const { signals: liveRecentSignals, loading: recentLoading, error: recentError } = useRecentSignals(userId)

  const signal = liveSignal
  const recentSignals = liveRecentSignals

  useEffect(() => {
    let active = true
    async function refresh() {
      const auth = await createClient().auth.getUser()
      if (active && auth.data.user) setUserId(auth.data.user.id)
      try {
        const response = await fetch('/api/automation', {cache:'no-store'})
        const json = await response.json()
        if (!response.ok) throw new Error('Unavailable')
        const selected = json.data.accounts.find((a: {id:string;connected:boolean}) => a.id === json.data.settings.account_id)
        if (active) setBrokerAccountId(selected?.connected ? selected.id : null)
      } catch { if (active) setBrokerAccountId(null) }
    }
    void refresh()
    const timer = setInterval(() => void refresh(),5000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  async function handleExecute(signalId: string) {
    if (!brokerAccountId) {
      setExecError('Connect a broker in Broker API Settings and select it in the trading controls.')
      return
    }
    setExecuting(true)
    setExecError(null)
    setExecSuccess(null)
    try {
      const res = await fetch('/api/trades/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal_id: signalId, broker_account_id: brokerAccountId, confirm: true }),
      })
      const json = await res.json()
      if (!res.ok) {
        setExecError(json.error ?? 'Execution failed')
      } else {
        setExecSuccess(`Trade queued. Follow fills and protection in Broker Orders. ID: ${json.data?.tradeId}`)
      }
    } catch {
      setExecError('Network error during execution')
    } finally {
      setExecuting(false)
    }
  }

  if (!mounted) return <p className="text-sm text-muted-foreground">Loading dashboard…</p>

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <h1 className="text-xl font-bold">Live Strategy Dashboard</h1>
          {isLoaded && !lockedSymbol && (
            <ChartSelector activeChart={activeChart} setActiveChart={setActiveChart} />
          )}
        </div>
      </div>
      <BrokerWorkspace view="control" onRunChange={setLockedSymbol} />
      <p className="text-sm text-muted-foreground">For simulated trading with its own Start/Stop control and history, open <Link href="/backtest" className="underline">Paper Trading</Link>.</p>
      {execError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {execError}
        </div>
      )}
      {execSuccess && (
        <div className="rounded-lg border border-green-400/30 bg-green-400/10 px-4 py-2 text-sm text-green-400">
          {execSuccess}
        </div>
      )}

      {/* Signal hero + trade details */}
      <div className="grid grid-cols-1 gap-5">
        <div className="flex flex-col gap-5">
          <StrategyAnalysis symbol={lockedSymbol??activeChart} scope="broker" />
        </div>
        <div className="flex flex-col gap-5">
          <h2 className="text-sm font-semibold">Latest received signal for this symbol</h2>
          {signalError && <p role="alert" className="text-sm text-destructive">{signalError}</p>}
          {signalLoading ? <p className="text-sm text-muted-foreground">Loading signal records…</p> : <TradeDetails key={signal?.id} signal={signal} onExecute={handleExecute} executing={executing} />}

        </div>
      </div>

      {/* Active positions & Alerts */}
      <div className="flex flex-col gap-5">
        <div className="mt-4">
          <h2 className="text-lg font-bold mb-3 border-b border-border pb-2">Trade Alerts Log</h2>
          <RecentSignals signals={recentSignals} loading={recentLoading} error={recentError} />
        </div>
      </div>
    </div>
  )
}
