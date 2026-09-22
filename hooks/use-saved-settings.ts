'use client'

import { useEffect, useState } from 'react'
import type { Settings } from '@/types/database'

/** Read-only reference panels refresh without overwriting editable form drafts. */
export function useSavedSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    async function refresh() {
      if (pending) return
      pending = true
      try {
        const response = await fetch('/api/settings', { cache: 'no-store', signal: controller.signal })
        const json = await response.json()
        if (!response.ok || !json.data) throw new Error('Saved settings unavailable')
        if (!controller.signal.aborted) {
          setSettings(previous => JSON.stringify(previous) === JSON.stringify(json.data) ? previous : json.data)
          setCheckedAt(new Date().toISOString()); setError(null)
        }
      } catch {
        if (!controller.signal.aborted) setError('Saved settings could not be refreshed. Any displayed values are from the last successful read.')
      } finally { pending = false; if (!controller.signal.aborted) setLoading(false) }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 15000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  return { settings, loading, error, checkedAt }
}
