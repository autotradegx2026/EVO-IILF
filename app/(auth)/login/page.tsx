'use client'

import { PERSONAL_ACCOUNT_EMAIL, isPersonalAccount } from '@/lib/supabase/personal-access'
import { Activity, ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { email: PERSONAL_ACCOUNT_EMAIL, password: '' } })

  async function onSubmit(data: LoginForm) {
    setServerError(null)
    if (!isPersonalAccount(data.email)) { setServerError('This is a private workspace. Use the configured account.'); return }
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })

    if (error) {
      setServerError(error.message)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  const field = 'w-full rounded-xl border border-[var(--line-strong)] bg-[var(--ink-2)] px-4 py-3 text-[15px] text-[var(--paper)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--long)] read-only:text-[var(--muted)]'
  const label = 'font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]'

  return (
    <div className="w-full max-w-sm">
      <div className="mb-10">
        <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--paper)] text-[var(--ink)] lg:hidden"><Activity className="size-5" strokeWidth={2.5} /></span>
        <h1 className="mt-6 font-[family-name:var(--font-display)] text-5xl leading-none lg:mt-0">Sign in</h1>
        <p className="mt-3 text-[var(--muted)]">Your personal AutotradeX workspace.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        {serverError && (
          <div role="alert" className="rounded-xl border border-[rgba(255,107,87,0.4)] bg-[rgba(255,107,87,0.08)] px-4 py-3 text-sm text-[var(--short)]">
            {serverError}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="email" className={label}>Email</label>
          <input id="email" type="email" readOnly autoComplete="email" className={field} {...register('email')} />
          {errors.email && <p className="text-xs text-[var(--short)]">{errors.email.message}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="password" className={label}>Password</label>
          <input id="password" type="password" placeholder="••••••••" autoComplete="current-password" autoFocus className={field} {...register('password')} />
          {errors.password && <p className="text-xs text-[var(--short)]">{errors.password.message}</p>}
        </div>

        <button type="submit" disabled={isSubmitting} className="group mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-[var(--long)] px-6 py-3.5 text-[15px] font-semibold text-[var(--ink)] outline-none transition-all hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--long)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ink)] disabled:translate-y-0 disabled:opacity-60">
          {isSubmitting ? 'Signing in…' : <>Sign in <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></>}
        </button>
        <p className="text-center font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Private workspace · Single account access</p>
      </form>
    </div>
  )
}
