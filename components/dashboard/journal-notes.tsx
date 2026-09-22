'use client'

import { useState } from 'react'
import type { Trade } from '@/types/database'

type Annotation = Pick<Trade, 'notes' | 'screenshot_url'>

export function JournalNotes({ trade, onSaved }: {
  trade: Trade
  onSaved: (annotation: Annotation) => void
}) {
  const [notes, setNotes] = useState(trade.notes ?? '')
  const [screenshot, setScreenshot] = useState(trade.screenshot_url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const busy = saving || uploading
  const dirty = notes !== (trade.notes ?? '') || screenshot.trim() !== (trade.screenshot_url ?? '')
  const attachment = trade.screenshot_url && /^https?:\/\//i.test(trade.screenshot_url)
    ? trade.screenshot_url : null

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaved(false)
    setUploaded(false)
    const screenshotUrl = screenshot.trim()
    if (screenshotUrl) {
      try {
        const url = new URL(screenshotUrl)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol')
      } catch {
        setError('Enter a valid HTTP or HTTPS screenshot URL.')
        return
      }
    }
    setSaving(true)
    try {
      const annotation: Annotation = { notes, screenshot_url: screenshotUrl || null }
      {
        const response = await fetch(`/api/trades/${encodeURIComponent(trade.id)}/notes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(annotation),
        })
        if (!response.ok) {
          throw new Error(response.status === 401
            ? 'Your session expired. Sign in again to save your notes.'
            : 'Could not save your notes. Please try again.')
        }
      }
      onSaved(annotation)
      setScreenshot(screenshotUrl)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your notes.')
    } finally {
      setSaving(false)
    }
  }

  async function upload(file: File) {
    setError('')
    setSaved(false)
    setUploaded(false)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPEG, or WebP screenshot.')
      return
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError('Choose a screenshot between 1 byte and 5 MB.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`/api/trades/${encodeURIComponent(trade.id)}/screenshot`, { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok || !body.data) throw new Error(response.status === 401
        ? 'Your session expired. Sign in again to upload your screenshot.'
        : body.error ?? 'Could not upload your screenshot. Please try again.')
      const annotation = body.data as Annotation
      onSaved(annotation)
      setScreenshot(annotation.screenshot_url ?? '')
      // Keep any unsaved notes in the editor; the upload only saves the attachment.
      setUploaded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not upload your screenshot.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3">
      <div className="space-y-1">
        <label htmlFor={`notes-${trade.id}`} className="text-xs font-medium">Trade notes</label>
        <textarea
          id={`notes-${trade.id}`} value={notes} maxLength={2000} rows={3} disabled={busy}
          onChange={event => { setNotes(event.target.value); setSaved(false); setUploaded(false) }}
          placeholder="What worked, what changed, and what to improve next time…"
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
        />
        <p className="text-right text-[11px] text-muted-foreground">{notes.length}/2000</p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`screenshot-${trade.id}`} className="text-xs font-medium">Screenshot URL</label>
        <input
          id={`screenshot-${trade.id}`} type="url" value={screenshot} disabled={busy}
          onChange={event => { setScreenshot(event.target.value); setSaved(false); setUploaded(false) }}
          placeholder="https://…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
        />
        <p className="text-[11px] text-muted-foreground">Paste a link to your chart screenshot. Clear the field to remove it.</p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`upload-${trade.id}`} className="text-xs font-medium">Upload chart screenshot</label>
        <input
          id={`upload-${trade.id}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
          onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary disabled:opacity-50"
        />
        <p className="text-[11px] text-muted-foreground">
          PNG, JPEG, or WebP · up to 5 MB · choosing a file uploads it immediately. Only you can open the saved screenshot.
        </p>
        {uploading && <p role="status" className="text-xs text-muted-foreground">Uploading screenshot…</p>}
      </div>
      {attachment && <a href={attachment} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-primary underline">View saved screenshot ↗</a>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !dirty} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {saving ? 'Saving…' : 'Save notes'}
        </button>
        {dirty && <button type="button" disabled={busy} onClick={() => { setNotes(trade.notes ?? ''); setScreenshot(trade.screenshot_url ?? ''); setError(''); setSaved(false); setUploaded(false) }} className="text-xs text-muted-foreground hover:text-foreground">Discard changes</button>}
        {uploaded && <span role="status" className="text-xs text-green-400">Screenshot uploaded{dirty ? ' · notes still unsaved' : ''}</span>}
        {saved && <span role="status" className="text-xs text-green-400">Saved</span>}
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </form>
  )
}
