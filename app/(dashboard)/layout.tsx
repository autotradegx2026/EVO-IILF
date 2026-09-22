import { isPersonalAccount } from '@/lib/supabase/personal-access'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  // Use getSession() — reads JWT from cookie, no network call.
  // Middleware already ran getUser() (network-verified) before reaching here,
  // so trusting the cookie JWT here is safe and avoids the double-auth-check
  // that caused spurious logouts when the second getUser() returned null.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !isPersonalAccount(session.user.email)) redirect('/login')
  const userEmail = session.user.email ?? ''

  const defaultOpen = cookies().get('sidebar_state')?.value !== 'false'
  return <DashboardShell userEmail={userEmail} defaultOpen={defaultOpen}>{children}</DashboardShell>
}
