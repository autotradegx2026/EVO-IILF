'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ProfilePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    async function loadUser() {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.getUser()
      if (authError || !data.user) setError('Profile unavailable. Reload to retry.')
      if (data.user) {
        setEmail(data.user.email ?? '')
        setName(data.user.user_metadata?.full_name ?? '')
      }
      setLoading(false)
    }
    void loadUser().catch(() => { setError('Profile unavailable. Reload to retry.'); setLoading(false) })
  }, [])

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)

    if (password && password !== passwordConfirm) {
      setError('Passwords do not match')
      setSaving(false)
      return
    }

    const supabase = createClient()
    const updates: { data: { full_name: string }; password?: string } = { data: { full_name: name } }
    
    if (password) updates.password = password

    const { error: updateError } = await supabase.auth.updateUser(updates)

    if (updateError) {
      setError(updateError.message)
    } else {
      setSuccess('Profile updated successfully.')
      setPassword('')
      setPasswordConfirm('')
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading profile...</div>
      </div>
    )
  }

  if (!email) return <p role="alert" className="text-sm text-amber-600">{error ?? 'Profile unavailable. Reload to retry.'}</p>

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Profile</h1>
        <p className="text-muted-foreground">Manage your account details and security.</p>
      </div>

      <Card className="bg-card/50 backdrop-blur border-border shadow-sm">
        <form onSubmit={handleUpdateProfile}>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
            <CardDescription>Update your personal information and change your password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-500">
                {success}
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                className="bg-background"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                readOnly
                aria-describedby="personal-email-note"
                className="bg-background"
              />
              <p id="personal-email-note" className="text-xs text-muted-foreground">This workspace uses a single fixed login account.</p>
            </div>

            <div className="pt-4 border-t border-border mt-4">
              <h3 className="text-sm font-medium mb-4">Change Password</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="passwordConfirm">Confirm New Password</Label>
                  <Input
                    id="passwordConfirm"
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    placeholder="Confirm new password"
                    className="bg-background"
                  />
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end pt-4 border-t border-border bg-muted/20">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving changes...' : 'Save Changes'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
