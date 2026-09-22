'use client'

import { useState, type FormEvent } from 'react'
import type { LedgerRow } from '@/lib/reporting/model'

function viewableScreenshot(value: string | null) {
  if (!value) return null
  if (/^\/api\/(?:reporting|trades)\//.test(value)) return value
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null
  } catch { return null }
}

export function LedgerNotes({ row, onSaved }: { row: LedgerRow; onSaved: () => void }) {
  // The parent keys this editor by ledger ID. Polling must not overwrite a draft.
  const [notes, setNotes] = useState(row.notes ?? '')
  const [savedNotes, setSavedNotes] = useState(row.notes ?? '')
  const [uploadedScreenshot, setUploadedScreenshot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const busy = saving || uploading
  const dirty = notes !== savedNotes
  const screenshot = viewableScreenshot(uploadedScreenshot ?? row.screenshot)
  const identity = `${row.environment}-${row.id}`

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !dirty) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/reporting', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: row.environment, id: row.id, notes }),
      })
      const result = await response.json()
      if (!response.ok || result.data?.id !== row.id || result.data?.notes !== notes) {
        throw new Error(response.status === 401 ? 'Your session expired. Sign in again to save notes.' : 'Notes could not be saved. Your draft is still here; please retry.')
      }
      setSavedNotes(notes)
      setNotice('Notes saved.')
      onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Notes could not be saved. Please retry.')
    } finally { setSaving(false) }
  }

  async function upload(file: File) {
    if (busy) return
    setError('')
    setNotice('')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) {
      setError('Choose a PNG, JPEG, or WebP screenshot between 1 byte and 5 MB.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`/api/reporting/${encodeURIComponent(row.id)}/screenshot?environment=${row.environment}`, { method: 'POST', body: form })
      const result = await response.json()
      if (!response.ok || result.data?.id !== row.id || typeof result.data?.screenshot_url !== 'string' || !viewableScreenshot(result.data.screenshot_url)) {
        throw new Error(response.status === 401 ? 'Your session expired. Sign in again to upload screenshots.' : 'Screenshot could not be uploaded. Please choose the file again to retry.')
      }
      setUploadedScreenshot(result.data.screenshot_url)
      setNotice('Screenshot uploaded. Any unsaved notes remain in the editor.')
      onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Screenshot could not be uploaded. Please retry.')
    } finally { setUploading(false) }
  }

  return <form onSubmit={save} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
    <div className="space-y-1"><label htmlFor={`notes-${identity}`} className="text-xs font-medium">Trade notes</label><textarea id={`notes-${identity}`} value={notes} maxLength={5000} rows={4} disabled={busy} onChange={event => { setNotes(event.target.value); setNotice('') }} placeholder="Record your trade analysis and observations…" className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50" /><p className="text-right text-xs text-muted-foreground">{notes.length}/5000{dirty ? ' · Unsaved changes' : ''}</p></div>
    <div className="space-y-2"><label htmlFor={`screenshot-${identity}`} className="block text-xs font-medium">Chart screenshot</label><input id={`screenshot-${identity}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary disabled:opacity-50" /><p className="text-xs text-muted-foreground">PNG, JPEG, or WebP · up to 5 MB. Choosing a file uploads it immediately to private storage and replaces the saved attachment.</p>{uploading && <p role="status" className="text-xs text-muted-foreground">Uploading screenshot…</p>}{screenshot && <a href={screenshot} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-primary underline">View saved screenshot ↗</a>}</div>
    <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={busy || !dirty} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save notes'}</button>{dirty && <button type="button" disabled={busy} onClick={() => { setNotes(savedNotes); setError(''); setNotice('') }} className="text-xs text-muted-foreground disabled:opacity-50">Discard draft changes</button>}</div>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}{notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
  </form>
}
